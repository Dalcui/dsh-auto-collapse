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
 */

declare const require: (id: string) => any

/** 单回合指标。 */
export interface TurnMetricsData {
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  tokensPerSecond?: number
}

/** 模块级：turn 号 → 指标。 */
const metricsByTurn = new Map<number, TurnMetricsData>()

/** 发布指标（组件计算完成后调用）。 */
export function publishTurnMetrics(turn: number, metrics: TurnMetricsData | null): void {
  if (metrics === null) {
    metricsByTurn.delete(turn)
  } else {
    metricsByTurn.set(turn, metrics)
  }
}

/** 读取某回合指标；未知返回 undefined。 */
export function readTurnMetrics(turn: number): TurnMetricsData | undefined {
  return metricsByTurn.get(turn)
}

/** 计算整回合指标（照抄 Winter-And-You-Gone/dsh-turn-fold.computeTurnMetrics）。 */
export function computeTurnMetrics(
  turn: number | undefined,
  nodes: Map<string, any> | undefined,
  locations: { getTurn(t: number): string[] | undefined } | undefined,
  turnTimings: Map<number, { startTime?: number; endTime?: number }> | undefined,
): TurnMetricsData | null {
  if (turn === undefined || !nodes || !locations || !turnTimings) return null
  const keys = locations.getTurn(turn) || []
  let durationMs: number | undefined
  const timing = turnTimings.get(turn)
  if (timing && typeof timing.startTime === 'number' && typeof timing.endTime === 'number') {
    durationMs = Math.max(0, timing.endTime - timing.startTime)
  }
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let reasoning = 0
  let tokensPerSecond: number | undefined
  for (const key of keys) {
    const n = nodes.get(key)
    if (!n) continue
    if (n.kind === 'assistant-step' && n.data && n.data.usage) {
      const u = n.data.usage
      if (typeof u.inputTokens === 'number' && isFinite(u.inputTokens)) input += u.inputTokens
      if (typeof u.outputTokens === 'number' && isFinite(u.outputTokens)) output += u.outputTokens
      if (typeof u.cacheReadTokens === 'number' && isFinite(u.cacheReadTokens)) cacheRead += u.cacheReadTokens
      if (typeof u.cacheWriteTokens === 'number' && isFinite(u.cacheWriteTokens)) cacheWrite += u.cacheWriteTokens
      if (typeof u.reasoningTokens === 'number' && isFinite(u.reasoningTokens)) reasoning += u.reasoningTokens
    } else if (n.kind === 'turn-tail' && n.data && typeof n.data.tokensPerSecond === 'number') {
      tokensPerSecond = n.data.tokensPerSecond
    }
  }
  return {
    durationMs,
    inputTokens: input > 0 ? input : undefined,
    outputTokens: output > 0 ? output : undefined,
    cacheReadTokens: cacheRead > 0 ? cacheRead : undefined,
    cacheWriteTokens: cacheWrite > 0 ? cacheWrite : undefined,
    reasoningTokens: reasoning > 0 ? reasoning : undefined,
    tokensPerSecond,
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
  const locations = useSession((s: any) => s.chat?.locations)
  const turnTimings = useSession((s: any) => s.turnTimings)
  const turn = turnNumber(node)
  const metrics = useMemo(
    () => computeTurnMetrics(turn, nodes as any, locations as any, turnTimings as any),
    [turn, nodes, locations, turnTimings],
  )
  const ref = useRef(null)

  useEffect(() => {
    if (turn === undefined) return
    publishTurnMetrics(turn, metrics)
    const el = ref.current
    if (el && typeof el.setAttribute === 'function') {
      if (metrics) {
        el.setAttribute('data-dshcf-turn-metrics', JSON.stringify(metrics))
        el.setAttribute('data-dshcf-turn', String(turn))
      } else {
        el.removeAttribute('data-dshcf-turn-metrics')
      }
    }
  }, [turn, metrics])

  return React.createElement(
    'div',
    { ref, 'data-dshcf-turn-metrics-host': String(turn ?? ''), style: { display: 'contents' } },
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
