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
  /** 首 token 时延（ms，来自 turn-tail.data.ttftMs，rc.1 权威字段）。 */
  timeToFirstToken?: number
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

/** M3：Map 只增不减会随会话数/回合数无限增长，查询退化为线性。这里按
 * 会话+段上限裁剪：每会话最多保留最近 128 个段、最多保留 8 个会话（超限
 * 淘汰最老）。readPreviousTurnLastInput 只往回看一段，128 段/会话对任何
 * 真实会话都绰绰有余；老会话被裁后读取返回 undefined，与「不存在更早段」
 * 语义一致（调用方据此取基线 0）。 */
const MAX_PUBLISHED_KEYS_PER_SESSION = 128
const MAX_PUBLISHED_SESSIONS = 8
/** 会话 → 该会话的段 key 列表（插入序），支撑 O(1) 裁剪与删除。 */
const publishedKeysBySession = new Map<string, string[]>()

/** P3（REMAINING_ISSUES）：per-session 的「turn → 该 turn 已发布的最大
 * segOrdinal」索引——readPreviousTurnLastInput 的「上一回合末段」查询从
 * 全表线性扫描降为 O(该会话 turn 数)。与 metricsByTurn 同步维护。 */
const lastSegBySession = new Map<string, Map<number, number>>()

function removePublishedKey(sessionId: string, key: string): void {
  const keys = publishedKeysBySession.get(sessionId)
  if (keys === undefined) return
  const index = keys.indexOf(key)
  if (index >= 0) keys.splice(index, 1)
}

/** 同步 lastSegBySession 索引：写入/覆盖时更新最大段；删除时若删的是该
 * turn 的最大段则重扫该会话找新最大（罕见路径）。 */
function syncLastSegIndex(sessionId: string, turn: number, segOrdinal: number, removed: boolean): void {
  let byTurn = lastSegBySession.get(sessionId)
  if (byTurn === undefined) {
    byTurn = new Map()
    lastSegBySession.set(sessionId, byTurn)
  }
  const current = byTurn.get(turn)
  if (!removed) {
    if (current === undefined || segOrdinal > current) byTurn.set(turn, segOrdinal)
    return
  }
  if (current !== segOrdinal) return
  // 重扫该 turn 剩余段找新最大；无则移除索引项
  let best = -1
  const prefix = `${sessionId}:${turn}:`
  for (const k of metricsByTurn.keys()) {
    if (!k.startsWith(prefix)) continue
    const s = Number(k.slice(prefix.length))
    if (Number.isFinite(s) && s > best) best = s
  }
  if (best < 0) byTurn.delete(turn)
  else byTurn.set(turn, best)
}

/** 发布指标（组件计算完成后调用），按会话+段隔离。 */
export function publishTurnMetrics(sessionId: string, turn: number, segOrdinal: number, metrics: TurnMetricsData | null): void {
  const key = `${sessionId}:${turn}:${segOrdinal}`
  if (metrics === null) {
    metricsByTurn.delete(key)
    removePublishedKey(sessionId, key)
    syncLastSegIndex(sessionId, turn, segOrdinal, true)
    return
  }
  const isNew = !metricsByTurn.has(key)
  metricsByTurn.set(key, metrics)
  syncLastSegIndex(sessionId, turn, segOrdinal, false)
  if (!isNew) return // 覆盖已有 key：插入序不变，无需裁剪
  let keys = publishedKeysBySession.get(sessionId)
  if (keys === undefined) {
    keys = []
    publishedKeysBySession.set(sessionId, keys)
    while (publishedKeysBySession.size > MAX_PUBLISHED_SESSIONS) {
      // 淘汰最老会话（Map 迭代序 = 插入序）；末段索引一并清理
      const oldest = publishedKeysBySession.keys().next().value as string
      for (const k of publishedKeysBySession.get(oldest) ?? []) metricsByTurn.delete(k)
      publishedKeysBySession.delete(oldest)
      lastSegBySession.delete(oldest)
    }
  }
  keys.push(key)
  while (keys.length > MAX_PUBLISHED_KEYS_PER_SESSION) {
    const oldest = keys.shift()
    if (oldest !== undefined) {
      metricsByTurn.delete(oldest)
      // 最老段被裁：同步末段索引（key = sessionId:turn:seg——按 sessionId
      // 长度切片取 turn:seg，sessionId 自身含冒号也不会取错分隔点）
      const rest = oldest.slice(sessionId.length + 1)
      const colon = rest.lastIndexOf(':')
      const t = Number(rest.slice(0, colon))
      const s = Number(rest.slice(colon + 1))
      if (Number.isFinite(t) && Number.isFinite(s)) syncLastSegIndex(sessionId, t, s, true)
    }
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
  // segOrdinal=0：取「小于 turn 的最近已发布回合」的最后一段（P3 索引化：
  // 遍历该会话的 turn 索引 ≤128 项，不再全表扫描 metricsByTurn ≤1024 项；
  // 空档跳过语义不变——turn-1 未发布时往前找最近的）。
  const byTurn = lastSegBySession.get(sessionId)
  if (byTurn === undefined) return undefined
  let bestTurn = -1
  let bestSeg = -1
  for (const [t, seg] of byTurn) {
    if (t < turn && (t > bestTurn || (t === bestTurn && seg > bestSeg))) {
      bestTurn = t
      bestSeg = seg
    }
  }
  if (bestTurn < 0) return undefined
  return readTurnMetrics(sessionId, bestTurn, bestSeg)?.lastModelInputTokens
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
  /** rc.1 的 ChatNodeStore 在 upsert 后重建 values() 数组——免费的内容纪元，
   * 供帧级缓存识别「原地可变存储」的内容变化；旧版 Map 也有 values()（每次
   * 返回新迭代器 → 缓存永久 miss → 自动禁用，安全兜底）。 */
  values?(): unknown
}

/** 单次模型调用的总输入 token（prompt 总量，含缓存命中）。
 *
 * 精确口径 = totalTokens - outputTokens：dsh-llm mapUsage 会在
 * prompt/completion 计数有效时附带精确 totalTokens，而缓存桶
 * （cacheReadTokens/cacheWriteTokens）任一 attempt 缺失就会在
 * dsh-token-meter aggregateAttempts 里整体变 undefined——此时
 * uncached + cacheRead + cacheWrite 的 DISJOINT 求和会偏小（只统计到
 * 未命中缓存的部分）。因此精确总量可用时优先用之（与内置 TurnUsagePanel
 * 的 cacheHit 分母 totalTokens - outputTokens 同源），缺失时回退三桶求和。
 */
function promptTokensOf(usage: any): number | undefined {
  if (usage === null || typeof usage !== 'object') return undefined
  const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)
  const inputT = num(usage.inputTokens)
  const outputT = num(usage.outputTokens)
  const totalT = num(usage.totalTokens)
  if (totalT !== undefined && outputT !== undefined && totalT >= outputT) return totalT - outputT
  if (inputT === undefined) return undefined
  return inputT
    + (num(usage.cacheReadTokens) ?? 0)
    + (num(usage.cacheWriteTokens) ?? 0)
}

/** 分组作用域标识：整回合分组——「折叠指标行覆盖整回合」时（原生
 * turn-process 行 / 回合内只有一个分组）指标按整回合聚合。与段序号共用
 * `sessionId:turn:seg` 键空间：-1 恒小于任何真实段号，因此不会被
 * readPreviousTurnLastInput 的「上一回合末段」索引选中（它只认真实段）。 */
export const TURN_SCOPE_SEG = -1

/** 单个分组（= 一条折叠指标行覆盖的范围）的累计量。 */
interface GroupAccumulator {
  toolCalls: number
  modelCalls: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  /** 该分组内最后一次模型调用的输入总量（含缓存命中，末次 attempt 真实规模）。 */
  lastModelInput?: number
  /** 该分组内最早的首 token 时间（分组计时切分与首 token 时延归属用）。 */
  firstTokenTime?: number
  /** 该分组内最早的 step 起点（AssistantTiming.stepStartTime，可为 null）。
   * 分组计时切分的首选起点：比首 token 时间更接近「本分组开始工作」的时刻。 */
  firstStepStart?: number
  /** 该分组内最早的事件时刻（node.time，源会话事件时间戳）：分组计时切分的
   * 兜底起点——段内没有带 timing 的 assistant-step 时（如只有工具调用），
   * 仍能给出「本分组何时开始」。 */
  firstEventTime?: number
  /** 该分组是否含「内容节点」（工具调用 / 已 settled 的 assistant-step）。
   * 只有含内容的分组才算一个真正的分组——与折叠层 buildSegments「有内容的段」
   * 口径对齐（只含 model-retry 状态行的段两侧都不算分组，否则单/多分组判定
   * 会相反：折叠层按整回合读、指标层按段切分）。 */
  hasContent: boolean
  /** 已结算步骤的 decode 时长与输出 token（运行中 tok/s 推导，按分组累计）。 */
  liveDecodeMs: number
  liveOutputTokens: number
}

function newGroupAccumulator(): GroupAccumulator {
  return {
    toolCalls: 0, modelCalls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    reasoning: 0, liveDecodeMs: 0, liveOutputTokens: 0, hasContent: false,
  }
}

/** 把一个节点的贡献累计到一个分组累加器（模块级纯函数：无闭包捕获，
 * 便于 V8 内联；分组与整回合两份累计量共用同一实现，避免口径漂移）。
 * turn-tail 的回合级捕获（tokensPerSecond / ttftMs / tokenUsage）不在这里做，
 * 由调用方在遍历时单独处理（只需一次，与分组无关）。 */
function accumulateNode(n: any, acc: GroupAccumulator): void {
  if (typeof n.time === 'number' && isFinite(n.time)) {
    if (acc.firstEventTime === undefined || n.time < acc.firstEventTime) acc.firstEventTime = n.time
  }
  if (n.kind === 'tool-call') {
    acc.toolCalls++
    acc.hasContent = true
    return
  }
  if (n.kind === 'model-retry') {
    // DSH 重试不新建 assistant-step 节点，而是独立 model-retry 节点
    // （data.attempts 为全部重试尝试）。只统计已实际发起的重试
    // （retryState === 'started'；scheduled/cancelled 未产生模型调用），
    // 与 tokenUsage 跨 attempt 求和的 input/output 口径对齐。
    const attempts = n.data?.attempts
    if (Array.isArray(attempts)) {
      acc.modelCalls += attempts.filter((a: any) => a !== null && typeof a === 'object' && a.retryState === 'started').length
    }
    return
  }
  if (n.kind !== 'assistant-step') return
  // 对齐 DSH 原生 tailData：只取有 finalNode 的 step（已 finalized）。
  // 中断的 step 若有 finalNode（finalized 前缀）仍计入；running/aborted
  // 无 finalNode 的跳过，避免 partial usage 污染累计值。
  if (!n.data || n.data.finalNode === undefined) return
  acc.modelCalls++
  acc.hasContent = true
  const stepTiming = n.data.finalNode?.timing ?? n.data.timing ?? n.timing
  // 分组计时切分与首 token 时延归属：记录该分组内最早的首 token 时间。
  const firstToken = stepTiming !== null && typeof stepTiming === 'object' && typeof stepTiming.firstTokenTime === 'number' && isFinite(stepTiming.firstTokenTime)
    ? stepTiming.firstTokenTime
    : undefined
  if (firstToken !== undefined && (acc.firstTokenTime === undefined || firstToken < acc.firstTokenTime)) {
    acc.firstTokenTime = firstToken
  }
  const stepStart = typeof stepTiming?.stepStartTime === 'number' && isFinite(stepTiming.stepStartTime)
    ? stepTiming.stepStartTime
    : undefined
  if (stepStart !== undefined && (acc.firstStepStart === undefined || stepStart < acc.firstStepStart)) {
    acc.firstStepStart = stepStart
  }
  if (n.data.usage === null || typeof n.data.usage !== 'object') return
  const u = n.data.usage
  // 总输入（prompt 总量，含缓存命中）用 promptTokensOf 的精确口径：
  // 内置精确总量 totalTokens - outputTokens 优先（缓存桶缺失时 DISJOINT
  // 求和会偏小——正是「只统计到未命中缓存」的根因）；精确总量缺失时
  // 回退 uncached + cacheRead + cacheWrite 三桶求和。
  const stepPrompt = promptTokensOf(u)
  if (stepPrompt !== undefined) acc.input += stepPrompt
  // 运行中 tok/s：单步 decode 时长 = 首个 token → 消息完成。必须要求 settled：
  // usage 会随 live-chunk 提前到达，而 firstTokenTime 在首个 token delta 就写入、
  // completedTime 要等 assistant/message 结算——在「已有 usage 但尚未结算」时采样
  // 会算出远低于真实值的假速率。内置 deriveTurnMetrics 只喂 finalized 节点，对齐它。
  const stepStatus = n.data.status
  const settled = stepStatus === 'settled' || stepStatus === 'interrupted'
  if (settled && stepTiming !== null && typeof stepTiming === 'object') {
    const completed = stepTiming.completedTime
    const stepOut = u.outputTokens
    if (
      firstToken !== undefined
      && typeof completed === 'number' && isFinite(completed)
      && typeof stepOut === 'number' && isFinite(stepOut) && stepOut >= 0
      // 严格大于：0 时长既无意义又会把分母稀释成假速率
      && completed > firstToken
    ) {
      acc.liveDecodeMs += completed - firstToken
      acc.liveOutputTokens += stepOut
    }
  }
  if (typeof u.cacheReadTokens === 'number' && isFinite(u.cacheReadTokens)) acc.cacheRead += u.cacheReadTokens
  if (typeof u.cacheWriteTokens === 'number' && isFinite(u.cacheWriteTokens)) acc.cacheWrite += u.cacheWriteTokens
  if (typeof u.outputTokens === 'number' && isFinite(u.outputTokens)) acc.output += u.outputTokens
  if (typeof u.reasoningTokens === 'number' && isFinite(u.reasoningTokens)) acc.reasoning += u.reasoningTokens
  // 记录「最后一次模型调用」的输入 token 总量（含缓存命中），供跨分组上下文
  // 增量计算：本分组新增上下文 = 本分组末输入 - 上一分组末输入。
  if (stepPrompt !== undefined && stepPrompt > 0) acc.lastModelInput = stepPrompt
}

/** 分组的数值合计 → 指标条目。billed 只在「该分组覆盖整回合」时传入
 * （turn-tail 的 tokenUsage 是跨 attempt 求和的回合级总量，套用到段级分组会把
 * 前段用量重复计入后段）；tokensPerSecond 缺失时按已结算步骤实时推导。 */
function finalizeGroupMetrics(
  acc: GroupAccumulator,
  durationMs: number | undefined,
  turnStartTime: number | undefined,
  turnEndTime: number | undefined,
  billed: { usage: any; tokensPerSecond?: number; timeToFirstToken?: number },
): TurnMetricsData {
  let input = acc.input
  let output = acc.output
  let cacheRead = acc.cacheRead
  let cacheWrite = acc.cacheWrite
  let reasoning = acc.reasoning
  const tu = billed.usage
  if (tu !== undefined && tu !== null) {
    const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)
    const outputT = num(tu.outputTokens)
    if (outputT !== undefined) {
      // 缓存/推理桶只在聚合值存在时覆盖：内置 aggregateAttempts 在任一
      // attempt 缺该桶时整体置 undefined——此时保留 per-step 累加值，
      // 不得 ?? 0 清零（否则「输入含缓存命中、命中字段却消失」自相矛盾）。
      const cacheReadT = num(tu.cacheReadTokens)
      const cacheWriteT = num(tu.cacheWriteTokens)
      const totalT = num(tu.totalTokens)
      if (totalT !== undefined && totalT >= outputT) {
        input = totalT - outputT
      } else {
        const uncached = num(tu.uncachedInputTokens)
        if (uncached !== undefined) input = uncached + (cacheReadT ?? 0) + (cacheWriteT ?? 0)
      }
      output = outputT
      if (cacheReadT !== undefined) cacheRead = cacheReadT
      if (cacheWriteT !== undefined) cacheWrite = cacheWriteT
      const reasoningT = num(tu.reasoningTokens)
      if (reasoningT !== undefined) reasoning = reasoningT
    }
  }
  // 运行中 fallback：turn-tail 尚未建出（回合进行中）时，用本分组已 finalized
  // 的 assistant-step 实测值推导 tok/s（与内置 deriveTurnMetrics 同口径）。
  let tokensPerSecond = billed.tokensPerSecond
  if (tokensPerSecond === undefined && acc.liveDecodeMs > 0) {
    tokensPerSecond = acc.liveOutputTokens / (acc.liveDecodeMs / 1e3)
  }
  return {
    durationMs,
    toolCalls: acc.toolCalls > 0 ? acc.toolCalls : undefined,
    modelCalls: acc.modelCalls > 0 ? acc.modelCalls : undefined,
    inputTokens: input > 0 ? input : undefined,
    outputTokens: output > 0 ? output : undefined,
    cacheReadTokens: cacheRead > 0 ? cacheRead : undefined,
    cacheWriteTokens: cacheWrite > 0 ? cacheWrite : undefined,
    reasoningTokens: reasoning > 0 ? reasoning : undefined,
    tokensPerSecond,
    timeToFirstToken: billed.timeToFirstToken,
    lastModelInputTokens: acc.lastModelInput,
    turnStartTime,
    turnEndTime,
  }
}

/** 一次 O(回合节点数) 的「分组级」聚合：把整回合节点按**分组**（= 一条折叠
 * 指标行覆盖的范围）分桶，一趟遍历同时产出
 *   - 每个段作用域分组（seg → 指标）：自建一级行 / 实时摘要行的作用域；
 *   - 整回合作用域分组（TURN_SCOPE_SEG → 指标）：原生 turn-process
 *     折叠指标行的作用域（compact 模式下该行覆盖整个回合）。
 * 分组定义 =「按折叠指标行所在位置分割分组」：行覆盖整回合 → 该回合就是一个
 * 分组；否则每个段各是一个分组。两者共用同一趟遍历与同一份帧级缓存（对齐上次
 * 提交的「批次级派生 + 帧级缓存」实践：不再每个 (nodeKey, 作用域) 各扫一遍回合）。
 * 统计口径：每个分组只统计自己范围内的节点（各自独立、互不重复）；turn-tail 的
 * billed 数据（tokenUsage）只归属覆盖整回合的分组。
 * 返回值恒含 TURN_SCOPE_SEG 一条（order/nodes 有效时）——fold 侧发布链路依赖该
 * 非 null 形状。 */
function buildTurnGroupMetrics(
  turn: number | undefined,
  order: string[] | undefined,
  nodes: ChatNodeStoreLike | undefined,
  turnTimings: Map<number, { startTime?: number; endTime?: number }> | undefined,
): Map<number, TurnMetricsData> {
  if (turn === undefined || !order || !nodes) return new Map<number, TurnMetricsData>()
  return buildGroupsFromIndex(turn, getTurnSegIndex(order, nodes), nodes, turnTimings)
}

/** buildTurnGroupMetrics 的主体：段归属索引由调用方给出（一次派生，多次复用）。
 * computeTurnMetrics 需要同时用索引取 nodeKey 的段号与产出全部分组，走这里可以
 * 避免对同一 order 派生两遍索引（无 values() 的旧版存储上是实打实的双倍 O(N)）。 */
function buildGroupsFromIndex(
  turn: number,
  segIndex: TurnSegIndex,
  nodes: ChatNodeStoreLike,
  turnTimings: Map<number, { startTime?: number; endTime?: number }> | undefined,
): Map<number, TurnMetricsData> {
  const result = new Map<number, TurnMetricsData>()
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
  const bucket = segIndex.keysByTurn.get(turn)
  const groups = new Map<number, GroupAccumulator>()
  let turnTailUsage: any
  let turnTailTps: number | undefined
  let turnTailTtft: number | undefined
  // 单个节点累计到一个分组累加器（模块级 accumulateNode：分组与整回合共用同一
  // 实现）。turn-tail 的回合级捕获（tokensPerSecond / ttftMs / tokenUsage）与分组
  // 无关，在下方遍历里就地处理。
  const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)
  // 上一个节点所属分组 → 累加器（同段连续节点占绝大多数）：省掉逐节点 Map.get，
  // 这是「一趟遍历产出全部分组」相对旧实现唯一的额外逐节点成本。
  let lastSeg = -1
  let lastAcc: GroupAccumulator | null = null
  if (bucket !== undefined) for (const key of bucket) {
    const n = nodes.get(key)
    if (!n || !n.location) continue
    if (n.kind === 'turn-tail' && n.data) {
      const tps = num(n.data.tokensPerSecond)
      if (tps !== undefined) turnTailTps = tps
      // rc.1 首 token 时延权威字段（deriveTurnMetrics 计算，回合内首步时延）。
      if (typeof n.data.ttftMs === 'number' && isFinite(n.data.ttftMs) && n.data.ttftMs > 0) {
        turnTailTtft = n.data.ttftMs
      }
      const tu = n.data.tokenUsage
      if (tu !== null && typeof tu === 'object') turnTailUsage = tu
    }
    const seg = segIndex.segOf.get(key) ?? 0
    let acc: GroupAccumulator
    if (seg === lastSeg && lastAcc !== null) {
      acc = lastAcc
    } else {
      const existing = groups.get(seg)
      if (existing === undefined) {
        acc = newGroupAccumulator()
        groups.set(seg, acc)
      } else {
        acc = existing
      }
      lastSeg = seg
      lastAcc = acc
    }
    accumulateNode(n, acc)
  }
  // 只把「含内容的分组」当作真正的分组（与折叠层的 contentNodeCount 同口径）：
  // 只含 model-retry 等状态行的段不算分组，否则两侧单/多分组判定会相反。
  const segs = [...groups.keys()].sort((a, b) => a - b).filter(seg => (groups.get(seg) as GroupAccumulator).hasContent)
  const groupCount = segs.length
  // 整回合作用域累加量：回合唯一分组时**就是**那个分组的累计量（常见路径零额外
  // 成本——不再对每个节点写两份，实测这是本次改动唯一的性能风险点）；多分组回合
  // 才再走一趟汇总全回合节点（与旧实现「每个段各扫一趟」同阶成本，且只会发生在
  // 有插话的回合）。单分组复用同一累加器也保证两条键的数值绝不漂移。
  let turnAcc: GroupAccumulator
  if (groupCount <= 1) {
    turnAcc = segs.length === 1 ? (groups.get(segs[0]) as GroupAccumulator) : newGroupAccumulator()
  } else {
    // 多分组：把各段累加量按段序（= DOM/节点顺序）合并出整回合累计量——与再扫
    // 一遍回合节点逐字段等价（求和 + 首 token 取最早 + 末次输入取最后一个有值的
    // 分组），但只花 O(分组数)，不重复遍历节点（上一版实现在这里多扫一趟，
    // 基准实测整帧慢 ~30%）。
    turnAcc = newGroupAccumulator()
    for (const seg of segs) {
      const g = groups.get(seg) as GroupAccumulator
      turnAcc.toolCalls += g.toolCalls
      turnAcc.modelCalls += g.modelCalls
      turnAcc.input += g.input
      turnAcc.output += g.output
      turnAcc.cacheRead += g.cacheRead
      turnAcc.cacheWrite += g.cacheWrite
      turnAcc.reasoning += g.reasoning
      turnAcc.liveDecodeMs += g.liveDecodeMs
      turnAcc.liveOutputTokens += g.liveOutputTokens
      // 累计量的 firstTokenTime/firstStepStart 只服务于「分组计时切分」，整回合
      // 条目用的是记录级 turnStart/turnEnd，无需合并（保持无死代码）。
      if (g.lastModelInput !== undefined) turnAcc.lastModelInput = g.lastModelInput
    }
  }
  // 分组计时切分：首分组起点 = 回合起点（记录级），其余分组的起点 = 该分组内
  // 最早的首 token 时间；分组终点 = 下一分组起点 / 回合终点。切分互不重叠，
  // 且各分组耗时之和 = 回合耗时（对齐「各自独立、统计结果不重复」）。
  const groupStart = (index: number): number | undefined => {
    if (index === 0) return turnStartTime
    const g = groups.get(segs[index])
    // 首选 step 起点（step/start 记录时刻），回退首 token 时间，再回退该分组最早
    // 事件时刻（只有工具调用的段也能定界）。
    return g?.firstStepStart ?? g?.firstTokenTime ?? g?.firstEventTime
  }
  for (let index = 0; index < segs.length; index++) {
    const acc = groups.get(segs[index]) as GroupAccumulator
    // 覆盖整回合的分组（回合唯一分组）：整回合计时 + 回合级 billed 数据归属它。
    // 多分组回合：按分组切分计时，且**不**套用回合级 billed（否则前段用量会被
    // 重复计入本段）。
    const coversTurn = groupCount <= 1
    let groupDurationMs = durationMs
    if (!coversTurn) {
      const start = groupStart(index)
      // 分组终点 = 下一分组起点；下一分组起点不可得时用**回合终点**收尾（而不是
      // 让本分组也变成「无耗时」）——代价是末两段的边界并入后一段，但保证
      // 「各分组耗时之和 = 回合耗时」，不会出现整段耗时集体消失。
      const end = index < groupCount - 1 ? (groupStart(index + 1) ?? turnEndTime) : turnEndTime
      groupDurationMs = start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined
    }
    result.set(segs[index], finalizeGroupMetrics(acc, groupDurationMs, turnStartTime, turnEndTime, {
      usage: coversTurn ? turnTailUsage : undefined,
      tokensPerSecond: coversTurn ? turnTailTps : undefined,
      // 首 token 时延是回合首次模型调用的时延，归属持有首个分组的那个分组。
      timeToFirstToken: index === 0 ? turnTailTtft : undefined,
    }))
  }
  // 整回合作用域条目（原生折叠指标行 / 覆盖整回合的唯一分组）。单分组回合里它与
  // 段作用域条目逐字段相同 → 复用同一对象（少一次分配，也保证两条键不会漂移）。
  if (groupCount <= 1 && segs.length === 1) {
    result.set(TURN_SCOPE_SEG, result.get(segs[0]) as TurnMetricsData)
  } else {
    result.set(TURN_SCOPE_SEG, finalizeGroupMetrics(turnAcc, durationMs, turnStartTime, turnEndTime, {
      usage: turnTailUsage,
      tokensPerSecond: turnTailTps,
      timeToFirstToken: turnTailTtft,
    }))
  }
  return result
}

/** 计算整回合（或回合内某段）指标（保留既有签名：单作用域调用与测试用）。
 * nodeKey 所属段的分组条目；该段无条目时回退「仅计时」形状（与旧实现逐字段
 * 一致——fold 侧发布链路依赖该非 null 形状）。 */
export function computeTurnMetrics(
  turn: number | undefined,
  order: string[] | undefined,
  nodes: ChatNodeStoreLike | undefined,
  turnTimings: Map<number, { startTime?: number; endTime?: number }> | undefined,
  nodeKey?: string,
): TurnMetricsData | null {
  if (turn === undefined || !order || !nodes) return null
  // 索引只派生一次：既用于产出全部分组，也用于解析 nodeKey 的段号。
  const segIndex = getTurnSegIndex(order, nodes)
  const groups = buildGroupsFromIndex(turn, segIndex, nodes, turnTimings)
  const targetSeg = nodeKey === undefined ? 0 : (segIndex.segOf.get(nodeKey) ?? 0)
  const hit = groups.get(targetSeg)
  if (hit !== undefined) return hit
  const scope = groups.get(TURN_SCOPE_SEG)
  if (scope === undefined) return null
  return { durationMs: scope.durationMs, turnStartTime: scope.turnStartTime, turnEndTime: scope.turnEndTime }
}

/** 帧级分组聚合缓存条目：记录上次计算时的全部输入指纹。一份条目承载该回合
 * **全部分组**（段作用域 + 整回合作用域）——分组已由「折叠指标行作用域」统一
 * 定义，同一回合的全部分组共享一趟 O(回合节点数) 派生（对齐上次提交的批次级
 * 派生实践；旧实现按 (turn, seg) 分键、每个段各扫一遍回合）。 */
interface TurnMetricsCacheEntry {
  /** order 结构引用（仅结构变化才换数组，原地追加不换）。 */
  order: unknown
  /** nodes 内容纪元（values() 返回的引用）。宿主 ChatNodeStore 原地可变且
   * snapshot 恒返回同一 store 引用——单靠引用比较永远命中、会返回过期
   * 指标；values() 在 upsert 后重建数组，是免费的内容变化信号。 */
  valuesEpoch: unknown
  /** 本回合计时端点：turnTimings 引用不变但计时更新（running→ok）时，
   * 单靠引用比较会命中脏缓存——端点值也参与指纹。 */
  turnStart: number | undefined
  turnEnd: number | undefined
  /** 分组作用域 → 指标（含 TURN_SCOPE_SEG）。 */
  groups: Map<number, TurnMetricsData>
}

/** (sessionId:turn) → 缓存条目。LRU 上限防长期运行无限增长（Map 迭代序 =
 * 插入序，超限淘汰最老；覆盖已有 key 先 delete 再 set 刷新顺序）。 */
const metricsCache = new Map<string, TurnMetricsCacheEntry>()
const METRICS_CACHE_MAX = 512

/** 带帧级缓存的回合分组指标聚合。输入指纹未变时直接返回上次结果；
 * 指纹变化才重建该回合的全部分组。export 供 metrics-unit 直接测缓存失效
 * 矩阵（指纹分支此前零覆盖）。 */
export function cachedTurnMetrics(
  sessionId: string | undefined,
  turn: number | undefined,
  segOrdinal: number,
  order: string[] | undefined,
  nodes: ChatNodeStoreLike | undefined,
  turnTimings: Map<number, { startTime?: number; endTime?: number }> | undefined,
  nodeKey: string | undefined,
): TurnMetricsData | null {
  // sessionId/turn 缺失时禁用缓存：否则全部共享 "undefined:undefined" 键空间
  // 互踩抖动（指纹仍保证值正确，只是去重失效）。
  if (sessionId === undefined || sessionId === null || sessionId === '' || turn === undefined) {
    return computeTurnMetrics(turn, order, nodes, turnTimings, nodeKey)
  }
  // 无 values() 的存储无法取得内容纪元，原地可变时缓存会脏命中——禁用缓存，
  // 每次重建分组表（返回值身份不共享，与旧实现「直调 compute 每次新对象」一致）。
  if (nodes === undefined || typeof nodes.values !== 'function') {
    // 分组号由调用方给出（段作用域 = 段号；整回合作用域 = TURN_SCOPE_SEG），
    // 必须按它取数——旧写法这里直调 computeTurnMetrics(..., nodeKey)，会忽略
    // 调用方请求的作用域（整回合槽位被写成 nodeKey 所在段的数字，原生折叠指标
    // 行显示段级值）。该分组无条目（不存在的分组号 / 两侧分组漂移）时返回 null：
    // 宁可这一行不显示指标，也不把别的分组的数字当自己的。
    if (order === undefined) return computeTurnMetrics(turn, order, nodes, turnTimings, nodeKey)
    return buildTurnGroupMetrics(turn, order, nodes, turnTimings).get(segOrdinal) ?? null
  }
  const timing = turnTimings?.get(turn)
  const turnStart = timing?.startTime
  const turnEnd = timing?.endTime
  const valuesEpoch = nodes.values()
  // 键 = sessionId:turn，不含 segOrdinal/nodeKey：同回合的全部分组由同一趟派生
  // 产出，同帧 S 个 step 的查询全部命中（nodeKey 只决定分组号，分组号已由
  // segOrdinal/TURN_SCOPE_SEG 表达）。
  const key = sessionId + ':' + turn
  const hit = metricsCache.get(key)
  if (
    hit !== undefined
    && hit.order === order
    && hit.valuesEpoch === valuesEpoch
    && hit.turnStart === turnStart
    && hit.turnEnd === turnEnd
  ) {
    return hit.groups.get(segOrdinal) ?? null
  }
  const groups = buildTurnGroupMetrics(turn, order, nodes, turnTimings)
  metricsCache.delete(key)
  metricsCache.set(key, { order, valuesEpoch, turnStart, turnEnd, groups })
  if (metricsCache.size > METRICS_CACHE_MAX) {
    metricsCache.delete(metricsCache.keys().next().value as string)
  }
  return groups.get(segOrdinal) ?? null
}

/** A4：cachedSegOrdinal 不再维护独立 nodeKey→seg 的 LRU 缓存（旧
 * SEG_ORDINAL_CACHE_MAX=512：键孤立、结构变化批次全部 miss 后各自 O(N)
 * 重扫，超 512 键还触发 LRU 悬崖额外抖动）。段归属统一走 getTurnSegIndex
 * 的批次级索引：同帧第一次 O(N) 派生、其余 O(1) 查表，帧内天然去重，
 * 且「键数 > 512」不再有行为差异。签名与语义（nodeKey 缺失 → 0；缺失
 * values() 的存储安全回退）保持不变，export 供 metrics-unit 测矩阵。 */
export function cachedSegOrdinal(
  nodeKey: string | undefined,
  order: string[] | undefined,
  nodes: ChatNodeStoreLike | undefined,
): number {
  return computeSegOrdinal(nodeKey, order, nodes)
}

/** 取节点所属回合号。loc.turn 缺失（数据异常/运行态节点）时返回 undefined。 */
function turnNumber(node: any): number | undefined {
  if (!node || !node.location) return undefined
  const loc = node.location
  if (loc.kind !== 'turn' && loc.kind !== 'step') return undefined
  if (!loc.turn) return undefined
  return loc.turn.turn
}

/** A1：批次级派生索引——一次遍历 order 产出两张表：
 *  - segOf:      nodeKey → 该节点所在回合内的段序号（segOrdinal）
 *  - keysByTurn: turn → 该回合全部节点键（按 order 序；steering 以其
 *    「后插话段」归属入桶，聚合循环对 kind==='steering' 无分支、天然跳过）
 *
 * 缓存键 = order 数组引用（宿主仅结构变化才换引用，内容流式保持），值再以
 * WeakMap 挂 order——order 被宿主丢弃时索引随之回收，不占额外生命周期。
 * 索引内的 valuesEpoch 参与命中判定：原地可变存储的内容纪元变化即重建
 * （「重建」= 派生三张表，order 未变时复用桶数组骨架也无必要——派生本身
 * 已是 O(N) 一次）。回退分支：无 values() 的存储（旧 Map）无法判定内容
 * 变化，退化为每次调用重建（与旧 computeSegOrdinal 每调用 O(N) 同价，
 * 不引入脏命中）。
 *
 * 段状态机与旧 computeSegOrdinal 的迭代语义逐键等价：
 *   对每个 key：先看回合边界（step/turn 节点的 location.turn.turn 变化 →
 *   seg 归 0），再记录该 key 的 (turn, seg)，最后 steering → seg++。
 *   steering 自身归属「后插话段」（seg 已 ++ 后的值）——与旧
 *   computeTurnMetrics 聚合循环中 steering 节点 continue 不参与聚合、
 *   后续节点 seg 已 ++ 的口径对齐。
 *
 * segOf 对「回合边界前」的节点归属 currentTurnAtKey——即旧算法里
 * 「先判边界、后归属」的同一时序：user（step location）开新回合时该
 * user 自身归属新回合 seg 0。 */
interface TurnSegIndex {
  segOf: Map<string, number>
  keysByTurn: Map<number, string[]>
}

const turnSegIndexCache = new WeakMap<string[], { valuesEpoch: unknown; index: TurnSegIndex }>()

function buildTurnSegIndex(order: string[], nodes: ChatNodeStoreLike): TurnSegIndex {
  const segOf = new Map<string, number>()
  const keysByTurn = new Map<number, string[]>()
  let seg = 0
  let currentTurn: number | undefined
  for (const key of order) {
    const n = nodes.get(key)
    // 节点不存在（order 引用了未知键）：旧算法 n 短路、既不判边界也不 seg++。
    if (n === undefined || n === null) continue
    const loc = n.location
    // 回合边界：与旧 computeSegOrdinal 逐条一致——只看带 turn 的 step/turn
    // location；steering 的 seg++ 不受 location 影响（location 缺失或
    // session 形态的 steering 仍推进段号——parity fuzz 实测约束）。
    if (loc !== undefined && loc !== null && (loc.kind === 'turn' || loc.kind === 'step') && loc.turn) {
      const t = loc.turn.turn
      if (currentTurn !== undefined && t !== currentTurn) seg = 0
      currentTurn = t
    }
    if (n.kind === 'steering') {
      // steering 键也记录 segOf（旧实现对任意 steering 键返回「当前 seg
      // 状态」——location 形态无关）。生产组件只对 assistant-step 查段号，
      // 该记录只为 computeSegOrdinal 语义逐键等价；聚合循环对 steering
      // 无分支，入桶与否不影响任何指标值。
      segOf.set(key, seg)
      if (currentTurn !== undefined) {
        let bucket = keysByTurn.get(currentTurn)
        if (bucket === undefined) {
          bucket = []
          keysByTurn.set(currentTurn, bucket)
        }
        bucket.push(key)
      }
      seg++
    } else {
      // 非 steering：旧实现 key===nodeKey 时无条件返回当前 seg（location
      // 形态无关）；segOf 覆盖全部存在节点。入桶仍只限带 turn 的
      // step/turn 定位节点（聚合要求 loc.turn.turn === turn）。
      segOf.set(key, seg)
      if (loc !== undefined && loc !== null && (loc.kind === 'turn' || loc.kind === 'step') && loc.turn && currentTurn !== undefined) {
        let bucket = keysByTurn.get(currentTurn)
        if (bucket === undefined) {
          bucket = []
          keysByTurn.set(currentTurn, bucket)
        }
        bucket.push(key)
      }
    }
  }
  return { segOf, keysByTurn }
}

function getTurnSegIndex(order: string[], nodes: ChatNodeStoreLike): TurnSegIndex {
  // 无 values() 的存储无法取内容纪元（旧版 Map 每次 values() 都是新迭代器）：
  // 缓存会脏命中（原地 upsert 不换 order 引用），退化为每次重建——与旧版
  // 每调用 O(N) 的成本持平，正确性优先。
  if (typeof (nodes as ChatNodeStoreLike).values !== 'function') {
    return buildTurnSegIndex(order, nodes)
  }
  const valuesEpoch = (nodes as ChatNodeStoreLike).values!()
  const hit = turnSegIndexCache.get(order)
  if (hit !== undefined && hit.valuesEpoch === valuesEpoch) return hit.index
  const index = buildTurnSegIndex(order, nodes)
  turnSegIndexCache.set(order, { valuesEpoch, index })
  return index
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
  // A1：同帧共用批次级派生索引（一次 O(N)），键级查询 O(1)。
  // 旧实现是每调用 O(N) 扫 order——S 个可见 step 的结构变化批次为 O(S×N)。
  const index = getTurnSegIndex(order, nodes)
  return index.segOf.get(nodeKey) ?? 0
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
  // 检测已存在的 assistant-step 条目，避让同 priority 冲突并沉到最低位。
  // SlotCore 规则：priority 升序、最低者渲染，同 key 同 priority 才抛错
  // （内置 assistant-step 未声明 priority → 默认 0，我们取 -1 即可 shadow）。
  // 但「只找负值」的旧逻辑假设内置恒为 0：若上游将来给内置显式赋值、或另一
  // 阴影插件占用了某个负值，避让基准就会失真。改为取所有同 key 条目的最小
  // priority 再减 1，无论两侧怎么变都能稳定占住最低位。
  // 注：下限 clamp 到 -1 是有意的例外——若既有条目全为更小负数（如 -5），
  // Math.min(-1, -6) = -1 并不严格低于 lowest；此时我们与内置同处 -1，
  // 靠 SlotCore「最低者渲染 + 同 key 不同 priority 不抛错」仍能正常 shadow。
  let priority = -1
  try {
    const entries = slotsService.entries('conversation.chat.node')
    let lowest: number | undefined
    for (const e of entries) {
      if (e && e.options && e.options.key === 'assistant-step') {
        const p = e.options.priority ?? 0
        if (lowest === undefined || p < lowest) lowest = p
      }
    }
    if (lowest !== undefined) priority = Math.min(-1, lowest - 1)
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
  // P1：段号计算走帧级缓存（同帧同节点 O(1)），消除残留的 O(S×N) 扫描。
  const segOrdinal = useMemo(
    () => cachedSegOrdinal(nodeKey, order as any, nodes as any),
    [nodeKey, order, nodes],
  )
  // R2：帧级聚合缓存。流式期间 React 快照的 order/nodes 引用每帧变化，
  // 每个可见 assistant-step 的 useMemo 都失效并各自重算同一回合的聚合——
  // S 个可见 step × N 个 order 节点 = O(S×N)。cachedTurnMetrics 按
  // (sessionId:turn) 记住输入引用与计时端点与该回合**全部分组**，同帧只有
  // 第一个 step 真正派生（一趟 O(回合节点数)），其余 O(1) 命中；已完结回合
  // 引用稳定，全程 O(1)。
  const metrics = useMemo(
    () => cachedTurnMetrics(sessionId, turn, segOrdinal, order as any, nodes as any, turnTimings as any, nodeKey),
    [turn, order, nodes, turnTimings, nodeKey],
  )
  // 整回合作用域分组（TURN_SCOPE_SEG）：原生 turn-process 折叠指标行覆盖整回合
  // （compact 模式）时折叠层读这一条——分组 = 折叠指标行所在位置，与段作用域
  // 严格互斥、互不重复。与上一行的 useMemo 共享同一份批次缓存（无额外派生成本）。
  // 只在「本回合存在可折叠的原生 turn-process 折叠指标行」时才派生/发布整回合
  // 作用域条目：宿主每节点下发 owner.turnProcess = {spec, foldable, ...}，foldable
  // 为真即该回合有原生行（其作用域 = 整回合）。没有原生行时折叠层永远按段作用域
  // 取值，白算一份整回合聚合纯属浪费（常见路径占一半帧成本）。
  // 旧版 DSH 无该 prop（undefined）→ 不派生；折叠层若因其它条件按整回合取值，
  // 仍可从段条目按段序合并兜底（两侧同口径）。
  const nativeRowFoldable = props.turnProcess?.foldable === true
  const turnScopeMetrics = useMemo(
    () => (nativeRowFoldable
      ? cachedTurnMetrics(sessionId, turn, TURN_SCOPE_SEG, order as any, nodes as any, turnTimings as any, nodeKey)
      : null),
    [nativeRowFoldable, turn, order, nodes, turnTimings, nodeKey],
  )
  // 整回合作用域 DOM 属性的唯一落点（每个回合恰一个 host：答案步）。回合被中断、
  // 无答案步时不写该属性——折叠层仍有模块级 Map 主路径可读。
  const scopeSpec = props.turnProcess?.spec
  const nodeStep = node?.data?.step
  const isTurnScopeHost = scopeSpec !== undefined && scopeSpec !== null
    && typeof nodeStep === 'number' && scopeSpec.answerStep === nodeStep
  const ref = useRef(null)

  useEffect(() => {
    if (turn === undefined || sessionId === undefined || sessionId === null || sessionId === '') return
    // metrics 为 null 表示 order/nodes 快照临时缺失（computeTurnMetrics 返回 null）。
    // 此时不删除已发布的数据——否则 running 流式高频重渲染的某个窗口会短暂清空
    // 指标，折叠层实时指标行「时不时消失」。保留旧值直到下个有效 metrics 覆盖。
    if (metrics === null) return
    publishTurnMetrics(sessionId, turn, segOrdinal, metrics)
    if (turnScopeMetrics !== null && turnScopeMetrics !== undefined) {
      publishTurnMetrics(sessionId, turn, TURN_SCOPE_SEG, turnScopeMetrics)
    }
    const el = ref.current
    if (el && typeof el.setAttribute === 'function') {
      el.setAttribute('data-dshcf-turn-metrics', JSON.stringify(metrics))
      if (isTurnScopeHost && turnScopeMetrics !== null && turnScopeMetrics !== undefined) {
        el.setAttribute('data-dshcf-turn-scope-metrics', JSON.stringify(turnScopeMetrics))
      }
    }
  }, [turn, segOrdinal, metrics, turnScopeMetrics, sessionId, isTurnScopeHost])

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
export function installTurnMetricsInjector(ctx: any): () => void {
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
  // R1：返回卸载函数。宿主 slots 服务不随插件 bundle 重建而重置，没有这条
  // 卸载路径时每次 HMR stop→start 都会在宿主 slots 残留一个 assistant-step
  // shadow entry（priority -1 → -2 → … 只增不减），旧 shadow 渲染器闭包
  // 继续引用旧 bundle 模块、重复写 DOM 属性。调用方（client.ts cleanup）必须
  // 与 watchdog/scope 清理并列调用本函数，保证 HMR 完全可逆。
  return disposeTurnMetricsInjector
}

/** 卸载指标注入器（R1）：dispose shadow 注册并重置模块级状态。
 * 幂等、可重复调用；调用后注入器回到「未安装」状态，可再次 install。 */
export function disposeTurnMetricsInjector(): void {
  if (typeof shadowDispose === 'function') {
    try { shadowDispose() } catch (error) {
      console.error('[dsh-auto-collapse] metrics shadow dispose failed', error)
    }
    shadowDispose = null
  }
  slotsService = null
  builtinAssistantComponent = null
  builtinAssistantLocale = undefined
  registeredLocale = undefined
  localeFixScheduled = false
}
