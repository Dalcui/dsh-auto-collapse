/**
 * dsh-auto-collapse — 回合指标注入器。
 *
 * 纯 DOM 方案拿不到单回合 token 数据（数据在 React 内部 node.data.usage）。
 * 本模块照抄 Winter-And-You-Gone/dsh-turn-fold 的思路：
 *   用 priority:-1 覆盖（shadow）内置 conversation.chat.node 渲染器（assistant-step），
 *   在渲染器组件里通过 props.useSession 订阅会话快照，直接从
 *   s.chat.nodes / s.chat.turnTimings 计算每回合指标（耗时 / input·output·
 *   cacheRead·cacheWrite tokens / tok/s），然后发布到模块级存储 + 写入 DOM 的
 *   data-dshcf-turn-metrics 属性，供既有 DOM 折叠层读取展示。
 *
 * 存储按 sessionId:turn 隔离——main↔subagent 各会话 turn 号都从 1 起，
 * 仅按 turn 编号会跨会话串扰（需求5/8）。turnStartTime/turnEndTime 从
 * turnTimings（记录级）透出，供折叠层复现耗时、切换会话计时不归零。
 */

declare const require: (id: string) => any

/** 单回合指标。 */
export interface TurnMetricsData {
  durationMs?: number
  toolCalls?: number
  modelCalls?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  tokensPerSecond?: number
  /** 本回合最后一次模型调用（finalStep）的输入 token 总量（含缓存读/写）。 */
  lastModelInputTokens?: number
  /** 回合开始时间（ms，来自会话快照 turnTimings，记录级、可复现）。 */
  turnStartTime?: number
  /** 回合结束时间（ms；进行中回合无该值）。 */
  turnEndTime?: number
}

/** 模块级：`sessionId:turn` → 指标。 */
const metricsByTurn = new Map<string, TurnMetricsData>()

/** 发布指标（组件计算完成后调用），按会话隔离。 */
export function publishTurnMetrics(sessionId: string, turn: number, metrics: TurnMetricsData | null): void {
  const key = `${sessionId}:${turn}`
  if (metrics === null) {
    metricsByTurn.delete(key)
  } else {
    metricsByTurn.set(key, metrics)
  }
}

/** 读取某会话某回合指标；未知返回 undefined。 */
export function readTurnMetrics(sessionId: string, turn: number): TurnMetricsData | undefined {
  return metricsByTurn.get(`${sessionId}:${turn}`)
}

/** 读取同一会话里比 turn 更早、最近一个已发布回合的 lastModelInputTokens
 * （上下文增量用）。返回 undefined 表示没有更早的回合或其值缺失。 */
export function readPreviousTurnLastInput(sessionId: string, turn: number): number | undefined {
  let bestTurn = -1
  let value: number | undefined
  const prefix = `${sessionId}:`
  for (const [key, m] of metricsByTurn) {
    if (!key.startsWith(prefix)) continue
    const t = Number(key.slice(prefix.length))
    if (t < turn && t > bestTurn) {
      bestTurn = t
      value = m.lastModelInputTokens
    }
  }
  return value
}

/** 计算整回合指标。
 *
 * 对齐 CH4ACKO3/dsh-turn-fold 的 __ch4acko3DshTurnFoldPlanMetrics：
 * 以 node.location.turn.turn 严格归属轮次——遍历 order 中所有节点，
 * 只处理 loc.turn.turn === turn 的节点，逐节点累计 tool-call（toolCalls）/ 
 * assistant-step（modelCalls + token usage）/ turn-tail（tokensPerSecond），
 * 绝不跨回合累加，从根上避免「多个轮次显示相同统计结果」的重复 bug。
 *
 * 不再依赖 locations.getTurn（语义不可靠且可能返回跨回合节点），
 * 也不强依赖 turnTimings（缺失时仅跳过 duration，仍计算其余指标）。 */
export function computeTurnMetrics(
  turn: number | undefined,
  order: string[] | undefined,
  nodes: Map<string, any> | undefined,
  turnTimings: Map<number, { startTime?: number; endTime?: number }> | undefined,
): TurnMetricsData | null {
  if (turn === undefined || !order || !nodes) return null
  let durationMs: number | undefined
  let turnStartTime: number | undefined
  let turnEndTime: number | undefined
  const timing = turnTimings?.get(turn)
  if (timing) {
    if (typeof timing.startTime === 'number') turnStartTime = timing.startTime
    if (typeof timing.endTime === 'number') turnEndTime = timing.endTime
  }
  if (turnStartTime !== undefined && turnEndTime !== undefined) {
    durationMs = Math.max(0, turnEndTime - turnStartTime)
  }
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let reasoning = 0
  let toolCalls = 0
  let modelCalls = 0
  let lastModelInput: number | undefined
  let tokensPerSecond: number | undefined
  for (const key of order) {
    const n = nodes.get(key)
    if (!n || !n.location) continue
    const loc = n.location
    // 严格按轮次归属：只处理 location.turn.turn === turn 的节点
    if ((loc.kind !== 'turn' && loc.kind !== 'step') || !loc.turn || loc.turn.turn !== turn) continue
    if (n.kind === 'tool-call') {
      toolCalls++
    } else if (n.kind === 'assistant-step') {
      // 对齐 DSH 原生 tailData：只取有 finalNode 的 step（已 finalized）。
      // 中断的 step 若有 finalNode（finalized 前缀）仍计入；running/aborted
      // 无 finalNode 的跳过，避免 partial usage 污染累计值。
      if (n.data && n.data.finalNode === undefined) continue
      modelCalls++
      if (n.data && n.data.usage) {
        const u = n.data.usage
        // DSH 的 usage.inputTokens 是「未缓存输入」(uncached only)，缓存部分单独
        // 报告为 cacheReadTokens / cacheWriteTokens（DISJOINT，见 dsh-llm 的
        // TokenUsage 与 dsh-llm-deepseek mapUsage）。总输入需三者相加，与 DSH
        // 官方 dsh-token-meter 的 pressureFrom = input + cacheRead + cacheWrite
        // 一致。这里把 input 累成总输入；cacheRead/cacheWrite 另行累加作明细。
        if (typeof u.inputTokens === 'number' && isFinite(u.inputTokens)) input += u.inputTokens
        if (typeof u.cacheReadTokens === 'number' && isFinite(u.cacheReadTokens)) {
          cacheRead += u.cacheReadTokens
          input += u.cacheReadTokens
        }
        if (typeof u.cacheWriteTokens === 'number' && isFinite(u.cacheWriteTokens)) {
          cacheWrite += u.cacheWriteTokens
          input += u.cacheWriteTokens
        }
        if (typeof u.outputTokens === 'number' && isFinite(u.outputTokens)) output += u.outputTokens
        if (typeof u.reasoningTokens === 'number' && isFinite(u.reasoningTokens)) reasoning += u.reasoningTokens
        // 记录「最后一次模型调用」的输入 token 总量（含缓存读/写），供跨回合
        // 上下文增量计算：本轮新增上下文 = 本回合末输入 - 上一回合末输入。
        const stepTotal = (typeof u.inputTokens === 'number' && isFinite(u.inputTokens) ? u.inputTokens : 0)
          + (typeof u.cacheReadTokens === 'number' && isFinite(u.cacheReadTokens) ? u.cacheReadTokens : 0)
          + (typeof u.cacheWriteTokens === 'number' && isFinite(u.cacheWriteTokens) ? u.cacheWriteTokens : 0)
        if (stepTotal > 0) lastModelInput = stepTotal
      }
    } else if (n.kind === 'turn-tail' && n.data && typeof n.data.tokensPerSecond === 'number') {
      tokensPerSecond = n.data.tokensPerSecond
    }
  }
  return {
    durationMs,
    toolCalls: toolCalls > 0 ? toolCalls : undefined,
    modelCalls: modelCalls > 0 ? modelCalls : undefined,
    inputTokens: input > 0 ? input : undefined,
    outputTokens: output > 0 ? output : undefined,
    cacheReadTokens: cacheRead > 0 ? cacheRead : undefined,
    cacheWriteTokens: cacheWrite > 0 ? cacheWrite : undefined,
    reasoningTokens: reasoning > 0 ? reasoning : undefined,
    tokensPerSecond,
    lastModelInputTokens: lastModelInput,
    turnStartTime,
    turnEndTime,
  }
}

/** 取节点所属回合号。 */
function turnNumber(node: any): number | undefined {
  if (!node || !node.location) return undefined
  const loc = node.location
  return (loc.kind === 'turn' || loc.kind === 'step') ? loc.turn.turn : undefined
}

/** 委托渲染内置 assistant-step 组件。 */
let slotsService: any = null
function builtinAssistant(props: any): any {
  if (!slotsService) return null
  const entries = slotsService.entries('conversation.chat.node')
  for (const e of entries) {
    if (e.options && e.options.key === 'assistant-step' && (e.options.priority || 0) === 0) {
      const React = require('react')
      return React.createElement(e.component, props)
    }
  }
  return null
}

/** Shadow 渲染器：计算指标 → 发布 + 写 DOM；原样委托内置渲染。 */
export function TurnMetricsNodeView(props: any): any {
  const React = require('react')
  const { useMemo, useEffect, useRef } = React
  const node = props.node
  const useSession = props.useSession as (selector: (s: any) => any) => any
  if (typeof useSession !== 'function') return builtinAssistant(props)
  const order = useSession((s: any) => s.chat?.order)
  const nodes = useSession((s: any) => s.chat?.nodes)
  const turnTimings = useSession((s: any) => s.turnTimings)
  const sessionId = useSession((s: any) => s.sessionId)
  const turn = turnNumber(node)
  const metrics = useMemo(
    () => computeTurnMetrics(turn, order as any, nodes as any, turnTimings as any),
    [turn, order, nodes, turnTimings],
  )
  const ref = useRef(null)

  useEffect(() => {
    if (turn === undefined || sessionId === undefined || sessionId === null || sessionId === '') return
    publishTurnMetrics(sessionId, turn, metrics)
    const el = ref.current
    if (el && typeof el.setAttribute === 'function') {
      if (metrics) {
        el.setAttribute('data-dshcf-turn-metrics', JSON.stringify(metrics))
      } else {
        el.removeAttribute('data-dshcf-turn-metrics')
      }
    }
  }, [turn, metrics, sessionId])

  return React.createElement(
    'div',
    {
      ref,
      'data-dshcf-turn-metrics-host': String(turn ?? ''),
      'data-dshcf-session': String(sessionId ?? ''),
      'data-dshcf-turn': String(turn ?? ''),
      style: { display: 'contents' },
    },
    builtinAssistant(props),
  )
}

/** 安装指标注入器：注册 shadow 渲染器。
 * 动态选择 priority：若已有同 key 的 shadow（如 Winter dsh-turn-fold 也注册了
 * assistant-step priority -1），同 priority 二次注册会抛错——此时降到 -2，
 * 让我们的注入器 shadow 在最前（DSH entries 按 priority 升序，最低优先渲染）。
 */
export function installTurnMetricsInjector(ctx: any): void {
  ctx.inject(['slots', 'connection'], (scope: any) => {
    slotsService = scope.slots
    const connection = scope.connection
    const hostDescriptionInject = function () {
      return { hooks: { hostDescription: connection.hostDescription } }
    }
    // 检测已存在的 assistant-step shadow（priority < 0），避免同 priority 冲突
    let priority = -1
    try {
      const entries = scope.slots.entries('conversation.chat.node')
      for (const e of entries) {
        if (e && e.options && e.options.key === 'assistant-step' && (e.options.priority ?? 0) < 0) {
          priority = (e.options.priority ?? 0) - 1
          break
        }
      }
    } catch { /* entries 不可用时保持 -1 */ }
    scope.slots.inject('conversation.chat.node', () => {
      return scope.slots.register({
        name: 'conversation.chat.node',
        key: 'assistant-step',
        priority,
        locale: 'conversation',
        inject: hostDescriptionInject,
      }, TurnMetricsNodeView)
    })
  })
}
