/**
 * dsh-auto-collapse — 回合指标注入器。
 *
 * 纯 DOM 方案拿不到单回合 token 数据（数据在 React 内部 node.data.usage）。
 * 本模块照抄 Winter-And-You-Gone/dsh-turn-fold 的思路：
 *   用 priority:-1 覆盖（shadow）内置 conversation.chat.node 渲染器（assistant-step），
 *   在渲染器组件里通过 props.useSession / props.useChat 订阅会话快照，直接从
 *   快照 order/nodes/turnTimings 计算每回合指标（耗时 / input·output·
 *   cacheRead·cacheWrite tokens / tok/s），然后发布到模块级存储 + 写入 DOM 的
 *   data-dshcf-turn-metrics 属性，供既有 DOM 折叠层读取展示。
 *
 * DSH 0.1.2-rc.1 适配（2026-09）：
 *   - token 权威源迁到 turn-tail.data.tokenUsage（uncachedInputTokens 等，
 *     含重试的全回合聚合）；assistant-step.data.usage 类型为 unknown，仅作回退；
 *   - nodes 从 Map 变为 ChatNodeStore 接口（get 兼容，不再强转 Map）；
 *   - connection.hostDescription 已移除：不再给 shadow entry 声明 inject 面；
 *   - locale NS 跟随内置 entry（rc.1='chat'，旧版='conversation'）。
 * 快照形状按能力自适应（tokenUsage 优先 / usage 回退），不依赖版本字符串分支。
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

/** 模块级：`sessionId:turn:segOrdinal` → 指标。segOrdinal 是回合内被
 * steering（插话）切分的段序号（0=首轮段、1=首次插话后、…）。无插话的
 * 回合只有一个段（segOrdinal=0），行为与旧 `sessionId:turn` 等价。 */
const metricsByTurn = new Map<string, TurnMetricsData>()

/** 发布指标（组件计算完成后调用），按会话+段隔离。 */
export function publishTurnMetrics(sessionId: string, turn: number, segOrdinal: number, metrics: TurnMetricsData | null): void {
  const key = `${sessionId}:${turn}:${segOrdinal}`
  if (metrics === null) {
    metricsByTurn.delete(key)
  } else {
    metricsByTurn.set(key, metrics)
  }
}

/** 读取某会话某回合某段指标；未知返回 undefined。 */
export function readTurnMetrics(sessionId: string, turn: number, segOrdinal = 0): TurnMetricsData | undefined {
  return metricsByTurn.get(`${sessionId}:${turn}:${segOrdinal}`)
}

/** 读取当前段的上一个段的 lastModelInputTokens（上下文增量用）。
 * segOrdinal>0 时取同回合上一段；segOrdinal=0 时取上一回合最后一段。
 * 返回 undefined 表示没有更早的段或其值缺失。 */
export function readPreviousTurnLastInput(sessionId: string, turn: number, segOrdinal = 0): number | undefined {
  if (segOrdinal > 0) {
    const prev = readTurnMetrics(sessionId, turn, segOrdinal - 1)
    return prev?.lastModelInputTokens
  }
  // segOrdinal=0：取上一回合的最后一段（segOrdinal 最大的）
  let bestTurn = -1
  let bestSeg = -1
  let value: number | undefined
  const prefix = `${sessionId}:`
  for (const [key, m] of metricsByTurn) {
    if (!key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    const colon = rest.lastIndexOf(':')
    const t = Number(rest.slice(0, colon))
    const s = colon >= 0 ? Number(rest.slice(colon + 1)) : 0
    if (t < turn && (t > bestTurn || (t === bestTurn && s > bestSeg))) {
      bestTurn = t
      bestSeg = s
      value = m.lastModelInputTokens
    }
  }
  return value
}

/** 计算整回合（或回合内某段）指标。
 *
 * 以 node.location.turn.turn 严格归属轮次——遍历 order 中所有节点，
 * 只处理 loc.turn.turn === turn 的节点，逐节点累计 tool-call（toolCalls）/
 * assistant-step（modelCalls + token usage）/ turn-tail（tokensPerSecond），
 * 绝不跨回合累加，从根上避免「多个轮次显示相同统计结果」的重复 bug。
 *
 * **按段（segOrdinal）切分（issue #1）**：当 nodeKey 提供时，按 order 中
 * steering（插话）节点将回合切分为段，只聚合 nodeKey 所在段的节点。这样
 * 插话前后的段各自显示自己的指标，不再「完全相同」。无插话时只有一段
 * （segOrdinal=0），行为与旧版一致。turnTimings 的 durationMs/startTime/
 * endTime 仍是回合级的（段级无独立计时源），但 fold.ts 对运行中段会用段
 * 起点（steering 时间或 runningSince）覆盖实时耗时。
 *
 * 不再依赖 locations.getTurn（语义不可靠且可能返回跨回合节点），
 * 也不强依赖 turnTimings（缺失时仅跳过 duration，仍计算其余指标）。 */
/** ChatNodeStore 兼容视图：rc.1 起 nodes 不再是 Map，只承诺 get(key)。
 * 旧版 DSH 的 Map 也满足该形状，因此两版共用一个读取面。 */
export interface ChatNodeStoreLike {
  get(key: string): any
}

export function computeTurnMetrics(
  turn: number | undefined,
  order: string[] | undefined,
  nodes: ChatNodeStoreLike | undefined,
  turnTimings: Map<number, { startTime?: number; endTime?: number }> | undefined,
  nodeKey?: string,
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
  // 确定 nodeKey 所在段：遍历 order，遇到 steering（插话）节点则段号 +1，
  // 回合切换时归 0（与 fold.ts buildSegments 对齐）。无 nodeKey 时 targetSeg=0。
  let targetSeg = 0
  if (nodeKey !== undefined) {
    let seg = 0
    let currentTurn: number | undefined
    for (const key of order) {
      const n = nodes.get(key)
      // 先处理回合边界，再判断是否到达 nodeKey（nodeKey 是新回合首节点时先归 0）
      if (n && n.location && (n.location.kind === 'turn' || n.location.kind === 'step') && n.location.turn) {
        const t = n.location.turn.turn
        if (currentTurn !== undefined && t !== currentTurn) seg = 0
        currentTurn = t
      }
      if (key === nodeKey) { targetSeg = seg; break }
      if (n && n.kind === 'steering') seg++
    }
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
  /** rc.1 权威 token 计费：turn-tail.data.tokenUsage（整回合含重试聚合）。
   * 只在聚合段 === turn-tail 所在段时覆盖 token 字段，避免插话多段时
   * 整回合总量重复计入每一段。 */
  let turnTailUsage: any
  let turnTailSeg: number | undefined
  let seg = 0
  let currentTurn: number | undefined
  for (const key of order) {
    const n = nodes.get(key)
    if (!n || !n.location) continue
    // steering 节点是段边界：段号 +1，不计入指标（回合切换时归 0，与 targetSeg 对齐）
    if (n.kind === 'steering') {
      seg++
      continue
    }
    // 追踪回合号：回合切换时归 0（与 buildSegments / computeSegOrdinal 一致）
    if ((n.location.kind === 'turn' || n.location.kind === 'step') && n.location.turn) {
      const t = n.location.turn.turn
      if (currentTurn !== undefined && t !== currentTurn) seg = 0
      currentTurn = t
    }
    const loc = n.location
    // 严格按轮次归属：只处理 location.turn.turn === turn 的节点
    if ((loc.kind !== 'turn' && loc.kind !== 'step') || !loc.turn || loc.turn.turn !== turn) continue
    // 只聚合 nodeKey 所在段的节点（无 nodeKey 时 targetSeg=0，聚合第一段）
    if (seg !== targetSeg) continue
    if (n.kind === 'tool-call') {
      toolCalls++
    } else if (n.kind === 'assistant-step') {
      // 对齐 DSH 原生 tailData：只取有 finalNode 的 step（已 finalized）。
      // 中断的 step 若有 finalNode（finalized 前缀）仍计入；running/aborted
      // 无 finalNode 的跳过，避免 partial usage 污染累计值。
      if (n.data && n.data.finalNode === undefined) continue
      modelCalls++
      if (n.data && n.data.usage !== null && typeof n.data.usage === 'object') {
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
        // 记录「最后一次模型调用」的输入 token 总量（含缓存读/写），供跨段
        // 上下文增量计算：本段新增上下文 = 本段末输入 - 上一段末输入。
        const stepTotal = (typeof u.inputTokens === 'number' && isFinite(u.inputTokens) ? u.inputTokens : 0)
          + (typeof u.cacheReadTokens === 'number' && isFinite(u.cacheReadTokens) ? u.cacheReadTokens : 0)
          + (typeof u.cacheWriteTokens === 'number' && isFinite(u.cacheWriteTokens) ? u.cacheWriteTokens : 0)
        if (stepTotal > 0) lastModelInput = stepTotal
      }
    } else if (n.kind === 'turn-tail' && n.data) {
      if (typeof n.data.tokensPerSecond === 'number') tokensPerSecond = n.data.tokensPerSecond
      const tu = n.data.tokenUsage
      if (tu !== null && typeof tu === 'object') {
        turnTailUsage = tu
        turnTailSeg = seg
      }
    }
  }
  // rc.1 权威计费：turn-tail.data.tokenUsage 覆盖 per-step usage 累加值（展示用 billed 总量）。
  // 语义：总输入 = uncachedInputTokens + cacheReadTokens + cacheWriteTokens（三者 DISJOINT，
  // 与 dsh-token-meter pressureFrom 一致）。
  // 注意：uncachedInputTokens 是「跨所有 attempt 求和」（见 dsh-token-meter aggregateAttempts），
  // 重试多时显著大于末次 attempt 的真实上下文规模。因此 lastModelInput（供 contextDelta
  // 上下文增量用）仍保留上方 per-step 末次 attempt 用量计算的值，不被这里的跨 attempt
  // 求和的 input 覆盖——否则「本回合新增上下文」在重试后一圈会塌成负几百 K（实际 DSH
  // 只追加上下文，除压缩外增量不应为负）。
  const tu = turnTailUsage
  if (tu !== undefined && tu !== null && turnTailSeg === targetSeg) {
    const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)
    const uncached = num(tu.uncachedInputTokens)
    const outputT = num(tu.outputTokens)
    if (uncached !== undefined && outputT !== undefined) {
      const cacheReadT = num(tu.cacheReadTokens) ?? 0
      const cacheWriteT = num(tu.cacheWriteTokens) ?? 0
      input = uncached + cacheReadT + cacheWriteT
      output = outputT
      cacheRead = cacheReadT
      cacheWrite = cacheWriteT
      reasoning = num(tu.reasoningTokens) ?? 0
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

/** 取节点所属回合号。loc.turn 缺失（数据异常/运行态节点）时返回 undefined。 */
function turnNumber(node: any): number | undefined {
  if (!node || !node.location) return undefined
  const loc = node.location
  if (loc.kind !== 'turn' && loc.kind !== 'step') return undefined
  if (!loc.turn) return undefined
  return loc.turn.turn
}

/** 取节点在回合内的段序号（segOrdinal）：nodeKey 之前的 steering（插话）
 * 节点数量（按回合内计数——遇到不同 turn 号时归 0，与 fold.ts buildSegments 对齐）。
 * 无插话时返回 0（第一段）。 */
export function computeSegOrdinal(
  nodeKey: string | undefined,
  order: string[] | undefined,
  nodes: ChatNodeStoreLike | undefined,
): number {
  if (nodeKey === undefined || !order || !nodes) return 0
  let seg = 0
  let currentTurn: number | undefined
  for (const key of order) {
    const n = nodes.get(key)
    // 先处理回合边界（从 step/turn 节点获取 turn 号），再判断是否到达 nodeKey。
    // 这样 nodeKey 是新回合首节点时，回合切换的 seg 归 0 先于返回。
    if (n && n.location && (n.location.kind === 'turn' || n.location.kind === 'step') && n.location.turn) {
      const t = n.location.turn.turn
      if (currentTurn !== undefined && t !== currentTurn) seg = 0
      currentTurn = t
    }
    if (key === nodeKey) return seg
    if (n && n.kind === 'steering') seg++
  }
  return 0
}

/** 委托渲染内置 assistant-step 组件。 */
let slotsService: any = null
let builtinAssistantComponent: any = null
/** 内置 entry 的 locale NS（rc.1 为 'chat'，旧版为 'conversation'）。
 * shadow entry 必须沿用与内置相同的 NS，否则 rc.1 词典查不到 key，
 * 委托渲染的内置组件文案退化为原始 key。 */
let builtinAssistantLocale: string | undefined
/** 当前 shadow 注册实际使用的 locale（与内置解析值对照，用于渲染期自纠）。 */
let registeredLocale: string | undefined
/** 当前 shadow 注册的 disposer（slots.inject 返回），locale 自纠时先 dispose 再重注册。 */
let shadowDispose: (() => void) | null = null
/** locale 自纠是否已调度/进行中（防重入）。 */
let localeFixScheduled = false

/** 用当前已解析的 builtinAssistantLocale 注册 shadow entry。
 * 返回 disposer（slots.inject 的返回，涵盖等待期与活动 effect）；失败返回 null。 */
function registerShadow(): (() => void) | null {
  if (!slotsService) return null
  builtinAssistantComponent = resolveBuiltinAssistant()
  const locale = builtinAssistantLocale ?? 'conversation'
  registeredLocale = locale
  // 检测已存在的 assistant-step shadow（priority < 0），避免同 priority 冲突
  let priority = -1
  try {
    const entries = slotsService.entries('conversation.chat.node')
    for (const e of entries) {
      if (e && e.options && e.options.key === 'assistant-step' && (e.options.priority ?? 0) < 0) {
        priority = (e.options.priority ?? 0) - 1
        break
      }
    }
  } catch { /* entries 不可用时保持 -1 */ }
  try {
    const disposeInject = slotsService.inject('conversation.chat.node', () => {
      return slotsService.register({
        name: 'conversation.chat.node',
        key: 'assistant-step',
        priority,
        // 与内置 entry 相同的 locale NS：rc.1 词典注册在 'chat' 下，
        // 旧版在 'conversation' 下；跟随后者可两版通吃。
        locale,
      }, TurnMetricsNodeView)
    })
    return typeof disposeInject === 'function' ? disposeInject : null
  } catch (error) {
    // 注册失败只丢指标功能，不连累调用方（G2）。
    console.error('[dsh-auto-collapse] metrics injector register failed', error)
    return null
  }
}

/** 渲染期 locale 自纠：若注册时内置 entry 尚未入表（激活顺序竞态）导致用了
 * fallback locale，而此刻已解析到内置真实 locale（rc.1='chat'），则 dispose
 * 旧注册并重注册一次。只在 timer 里执行（不触碰渲染期注册表）。 */
function ensureCorrectLocale(): void {
  if (localeFixScheduled) return
  localeFixScheduled = true
  try {
    if (builtinAssistantLocale !== undefined && builtinAssistantLocale !== registeredLocale) {
      if (typeof shadowDispose === 'function') {
        try { shadowDispose() } catch { /* dispose 失败不阻断重注册 */ }
        shadowDispose = null
      }
      registerShadow()
    }
  } finally {
    localeFixScheduled = false
  }
}

/** 读取 entry 声明的 locale NS。rc.1 起 SlotCore 把 locale 存在条目顶层
 * （h.locale，与 component/select/children 同级；只有 key/id/order/label/priority
 * 进 options）；更早版本可能把它放进 options.locale。两者都读，顶层优先——
 * 之前只读 e.options.locale 会让 builtinAssistantLocale 恒为 undefined、locale 恒
 * 退化成 'conversation'，委托渲染的内置文案（思考/已停止等）全部退化为原始
 * i18n key（message.think / message.stopped）。 */
function entryLocaleOf(e: any): string | undefined {
  if (e && typeof e.locale === 'string' && e.locale !== '') return e.locale
  if (e && e.options && typeof e.options.locale === 'string' && e.options.locale !== '') return e.options.locale
  return undefined
}

/** 解析内置 assistant-step（priority===0）渲染组件。entries() 可能因宿主结构
 * 变化不可用/抛错，一律 try/catch；找不到时返回 null，由安装期兜底决定不劫持。 */
function resolveBuiltinAssistant(): any {
  if (!slotsService) return null
  try {
    const entries = slotsService.entries('conversation.chat.node')
    for (const e of entries) {
      if (e && e.options && e.options.key === 'assistant-step' && (e.options.priority || 0) === 0) {
        const nl = entryLocaleOf(e)
        if (nl !== undefined) builtinAssistantLocale = nl
        return e.component
      }
    }
  } catch { /* entries 不可用时视为找不到，走不劫持兜底 */ }
  return null
}

function builtinAssistant(props: any): any {
  const React = require('react')
  const component = builtinAssistantComponent ?? resolveBuiltinAssistant()
  if (component !== null) {
    builtinAssistantComponent = component
    // 激活顺序竞态自纠：注册瞬间内置 renderers 可能尚未入表（locale 用了
    // fallback），渲染期已解析到真实 locale 时延后重注册，避免委托渲染的
    // 内置组件文案退化为原始 i18n key（如 message.thinkThe）。
    if (builtinAssistantLocale !== undefined && builtinAssistantLocale !== registeredLocale && !localeFixScheduled) {
      setTimeout(() => ensureCorrectLocale(), 0)
    }
    return React.createElement(component, props)
  }
  // 兜底：找不到内置渲染器时不劫持内容——children 原样直出，避免模型最终正文消失。
  return React.createElement('div', { style: { display: 'contents' } }, props.children ?? null)
}

/** Shadow 渲染器：计算指标 → 发布 + 写 DOM；原样委托内置渲染。 */
export function TurnMetricsNodeView(props: any): any {
  const React = require('react')
  const { useMemo, useEffect, useRef } = React
  const node = props.node
  const useSession = props.useSession as ((selector: (s: any) => any) => any) | undefined
  const useChat = props.useChat as ((selector: (s: any) => any) => any) | undefined
  if (typeof useSession !== 'function' && typeof useChat !== 'function') return builtinAssistant(props)
  // 快照形状兼容：旧版 DSH（0.1.1-rc.x / 0.1.2-alpha.2）chat 快照挂在 useSession 的
  // s.chat / s.turnTimings / s.sessionId 上；新版（0.1.2-alpha.3+）chat 快照独立为
  // useChat（uiSession.provide hooks:['chat']），形状 { order, nodes, locations, navigation,
  // timeline, legacy:{turnTimings, turnEnds, ...} }，sessionId 由 session 作用域 props 下发。
  // 新旧选择器按宿主能力条件调用：useSession/useChat 由 slot 系统在挂载期注入、
  // 单次挂载内引用恒定，故同一组件实例各 render 的 hook 调用序列稳定（旧版恒 4×useSession、
  // 新版恒 3×useChat 或 4+3），不触发 Rules of Hooks 崩溃；新值优先、旧值兜底。
  const legacyOrder = typeof useSession === 'function' ? useSession((s: any) => s?.chat?.order) : undefined
  const legacyNodes = typeof useSession === 'function' ? useSession((s: any) => s?.chat?.nodes) : undefined
  const legacyTimings = typeof useSession === 'function' ? useSession((s: any) => s?.turnTimings) : undefined
  const legacySessionId = typeof useSession === 'function' ? useSession((s: any) => s?.sessionId) : undefined
  const chatOrder = typeof useChat === 'function' ? useChat((s: any) => s?.order) : undefined
  const chatNodes = typeof useChat === 'function' ? useChat((s: any) => s?.nodes) : undefined
  const chatTimings = typeof useChat === 'function' ? useChat((s: any) => s?.legacy?.turnTimings) : undefined
  const order = (chatOrder ?? legacyOrder) as string[] | undefined
  const nodes = (chatNodes ?? legacyNodes) as Map<string, any> | undefined
  const turnTimings = (chatTimings ?? legacyTimings) as Map<number, { startTime?: number; endTime?: number }> | undefined
  const sessionIdProp = props.sessionId as string | undefined
  const sessionId = (typeof sessionIdProp === 'string' && sessionIdProp !== '' ? sessionIdProp : legacySessionId) as string | undefined
  const turn = turnNumber(node)
  const nodeKey: string | undefined = node?.key
  const segOrdinal = useMemo(
    () => computeSegOrdinal(nodeKey, order as any, nodes as any),
    [nodeKey, order, nodes],
  )
  const metrics = useMemo(
    () => computeTurnMetrics(turn, order as any, nodes as any, turnTimings as any, nodeKey),
    [turn, order, nodes, turnTimings, nodeKey],
  )
  const ref = useRef(null)

  useEffect(() => {
    if (turn === undefined || sessionId === undefined || sessionId === null || sessionId === '') return
    // metrics 为 null 表示 order/nodes 快照临时缺失（computeTurnMetrics 返回 null）。
    // 此时不删除已发布的数据——否则 running 流式高频重渲染的某个窗口会短暂清空
    // 指标，折叠层实时指标行「时不时消失」。保留旧值直到下个有效 metrics 覆盖。
    if (metrics === null) return
    publishTurnMetrics(sessionId, turn, segOrdinal, metrics)
    const el = ref.current
    if (el && typeof el.setAttribute === 'function') {
      el.setAttribute('data-dshcf-turn-metrics', JSON.stringify(metrics))
    }
  }, [turn, segOrdinal, metrics, sessionId])

  return React.createElement(
    'div',
    {
      ref,
      'data-dshcf-turn-metrics-host': String(turn ?? ''),
      'data-dshcf-session': String(sessionId ?? ''),
      'data-dshcf-turn': String(turn ?? ''),
      'data-dshcf-seg': String(segOrdinal ?? 0),
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
  ctx.inject(['slots'], (scope: any) => {
    slotsService = scope.slots
    // rc.1 移除了 connection.hostDescription：旧版 hostDescriptionInject 会把
    // {hooks:{hostDescription:undefined}} 交给 renderer 的 bindInjectSources，
    // observableHook(undefined) → WeakMap.set(undefined) 直接 TypeError，
    // shadow 渲染器整条崩溃、指标完全不发布。宿主从未要求 entry 必须带
    // inject 面（renderer runInject: !inject → EMPTY_INJECTED_PROPS），
    // 因此直接不再声明 inject。
    //
    // rc.1 时序修复（P0，实测断点）：内置 conversation.chat.node 的声明/注册
    // 可能晚于本插件 apply 执行，安装期 resolveBuiltinAssistant() 会落空。
    // 旧代码在此提前 return → shadow 永不注册、无日志、不重试，指标静默失效。
    // 修复：resolve 与注册全部移进 slots.inject 的声明回调——该回调在 slot
    // 声明提交后同步执行，届时内置 assistant-step entry 必已注册（内置
    // renderers 的 inject 回调先于本回调安装）。即使仍解析不到也不提前 return：
    // 渲染期 builtinAssistant() 有惰性 resolve + children 直出兜底（不劫持即
    // 直出正文，模型最终内容不会丢）。
    shadowDispose = registerShadow()
  })
}
