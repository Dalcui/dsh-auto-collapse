/**
 * metrics-unit.test.mjs — 需求 1/5/8 的纯函数单元测试。
 * 用 esbuild 把 src/turn-metrics.ts 转译后导入（不 bundle、不进 React），
 * 验证：records 按 sessionId 隔离、lastModelInputTokens 记录、
 * readPreviousTurnLastInput 找到上一回合末输入（首回合返回 undefined 供调用方取基线 0）、
 * turnStartTime/turnEndTime/durationMs 从 turnTimings 透出（记录级耗时）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'src/turn-metrics.ts'), 'utf8')
const { code } = transformSync(src, { loader: 'ts', format: 'esm' })
const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

const { publishTurnMetrics, readTurnMetrics, readPreviousTurnLastInput, computeTurnMetrics, computeSegOrdinal, cachedTurnMetrics, cachedSegOrdinal } = mod
const S = 'sess-a'

// 上一回合末输入查找（按 sessionId 隔离）
mod.publishTurnMetrics(S, 1, 0, { lastModelInputTokens: 10000 })
mod.publishTurnMetrics(S, 2, 0, { lastModelInputTokens: 15000 })
mod.publishTurnMetrics(S, 4, 0, { lastModelInputTokens: 22000 })
assert(readPreviousTurnLastInput(S, 2) === 10000, '上一回合末输入 = turn1', String(readPreviousTurnLastInput(S, 2)))
assert(readPreviousTurnLastInput(S, 4) === 15000, '跳过空档取最近已发布回合 turn2', String(readPreviousTurnLastInput(S, 4)))
assert(readPreviousTurnLastInput(S, 1) === undefined, '首回合无上一回合（调用方据此取基线 0）', String(readPreviousTurnLastInput(S, 1)))
assert(readTurnMetrics(S, 2).lastModelInputTokens === 15000, 'readTurnMetrics 透出 lastModelInputTokens')

// 会话隔离：main↔subagent 同名 turn 不串扰
mod.publishTurnMetrics('sess-b', 2, 0, { lastModelInputTokens: 99999 })
assert(readTurnMetrics(S, 2).lastModelInputTokens === 15000, '会话隔离：sess-a turn2 不被 sess-b 覆盖', String(readTurnMetrics(S, 2).lastModelInputTokens))
assert(readTurnMetrics('sess-b', 2).lastModelInputTokens === 99999, '会话隔离：sess-b 可读到自身 turn2')
assert(readPreviousTurnLastInput('sess-b', 3) === 99999, '会话隔离：sess-b 上一回合是自身 turn2', String(readPreviousTurnLastInput('sess-b', 3)))

// computeTurnMetrics 计算 lastModelInputTokens = 最后一个 step 的输入总量（含缓存），
// 并从 turnTimings 透出 turnStartTime/turnEndTime/durationMs
{
  const nodes = new Map()
  const mk = (key, kind, turn, extra = {}) => nodes.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  mk('a', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 100, outputTokens: 80 } } })
  mk('b', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 700, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 90 } } })
  mk('c', 'tool-call', 1)
  const turnTimings = new Map([[1, { startTime: 1000, endTime: 36000 }]])
  const m = computeTurnMetrics(1, ['a', 'b', 'c'], nodes, turnTimings)
  assert(m.lastModelInputTokens === 1000, '最后一次模型输入 = 700+300+0 = 1000', JSON.stringify(m.lastModelInputTokens))
  assert(m.inputTokens === 1800, '总输入 = (500+200+100)+(700+300+0) = 1800', JSON.stringify(m.inputTokens))
  assert(m.toolCalls === 1 && m.modelCalls === 2, '工具/模型调用计数', JSON.stringify({ t: m.toolCalls, m: m.modelCalls }))
  assert(m.turnStartTime === 1000 && m.turnEndTime === 36000, 'turnStartTime/turnEndTime 从 turnTimings 透出', JSON.stringify({ s: m.turnStartTime, e: m.turnEndTime }))
  assert(m.durationMs === 35000, 'durationMs = end-start = 35000', JSON.stringify(m.durationMs))
}

// 跨回合增量：turn2 末输入 15000 - turn1 末输入 10000 = 5000
{
  const delta = readTurnMetrics(S, 2).lastModelInputTokens - readPreviousTurnLastInput(S, 2)
  assert(delta === 5000, '上下文增量 = 15000 - 10000 = 5000', String(delta))
  // 首回合一：上一回合缺失 → 调用方取基线 0 → 增量 = 本回合末输入
  assert(readPreviousTurnLastInput(S, 1) === undefined, '首回合上一回合缺失，可安全取基线 0')
}


// 插话按段切分指标：同一回合内 steering 切出两段，各自独立统计
{
  const nodes = new Map()
  const mk = (key, kind, turn, extra = {}) => nodes.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  // turn 1: seg0 = step-a (input 1000), seg1 (after steering) = step-b (input 2000)
  mk('a', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 } } })
  nodes.set('steer1', { kind: 'steering', location: { kind: 'session' } })
  mk('b', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60 } } })
  const turnTimings = new Map([[1, { startTime: 1000, endTime: 5000 }]])
  // seg0: nodeKey='a' → only step-a
  const m0 = computeTurnMetrics(1, ['a', 'steer1', 'b'], nodes, turnTimings, 'a')
  assert(m0.inputTokens === 1000, 'seg0 输入=1000（不含 seg1 的 step-b）', JSON.stringify(m0.inputTokens))
  assert(m0.lastModelInputTokens === 1000, 'seg0 末输入=1000', JSON.stringify(m0.lastModelInputTokens))
  // seg1: nodeKey='b' → only step-b
  const m1 = computeTurnMetrics(1, ['a', 'steer1', 'b'], nodes, turnTimings, 'b')
  assert(m1.inputTokens === 2000, 'seg1 输入=2000（不含 seg0 的 step-a）', JSON.stringify(m1.inputTokens))
  assert(m1.lastModelInputTokens === 2000, 'seg1 末输入=2000', JSON.stringify(m1.lastModelInputTokens))
  // 发布两段，验证 readPreviousTurnLastInput 跨段查找
  mod.publishTurnMetrics(S, 1, 0, m0)
  mod.publishTurnMetrics(S, 1, 1, m1)
  // seg1 的上一段 = seg0（同回合）
  assert(readPreviousTurnLastInput(S, 1, 1) === 1000, '插话后段(seg1)的上一段末输入=seg0 的 1000', String(readPreviousTurnLastInput(S, 1, 1)))
  // seg0 首段无上一段（turn 1 是首回合）→ undefined（调用方取基线 0）
  assert(readPreviousTurnLastInput(S, 1, 0) === undefined, '插话前段(turn1 seg0)无上一回合', String(readPreviousTurnLastInput(S, 1, 0)))
  // turn 2 seg 0 的上一段 = turn 1 最后一段（seg 1）= 2000
  assert(readPreviousTurnLastInput(S, 2, 0) === 2000, 'turn2 seg0 上一段=turn1 最后段(seg1)的 2000', String(readPreviousTurnLastInput(S, 2, 0)))
}


// 多回合含插话：segOrdinal 按回合内重置（不跨回合累计）
{
  const nodes = new Map()
  const mk = (key, kind, turn, extra = {}) => nodes.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  // turn 1: stepA(seg0) → steer1 → stepB(seg1)
  mk('a1', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 100, outputTokens: 10 } } })
  nodes.set('s1', { kind: 'steering', location: { kind: 'session' } })
  mk('b1', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 200, outputTokens: 20 } } })
  // turn 2: stepC(seg0, NOT seg2) → steer2 → stepD(seg1, NOT seg3)
  mk('c2', 'assistant-step', 2, { data: { finalNode: {}, usage: { inputTokens: 300, outputTokens: 30 } } })
  nodes.set('s2', { kind: 'steering', location: { kind: 'session' } })
  mk('d2', 'assistant-step', 2, { data: { finalNode: {}, usage: { inputTokens: 400, outputTokens: 40 } } })
  const order = ['a1', 's1', 'b1', 'c2', 's2', 'd2']
  const tt = new Map([[1, {startTime:0,endTime:0}], [2, {startTime:0,endTime:0}]])
  // turn 2 seg 0 = stepC → segOrdinal should be 0 (per-turn, not global 2)
  const mc = computeTurnMetrics(2, order, nodes, tt, 'c2')
  assert(mc.inputTokens === 300, 'turn2 seg0(stepC)输入=300（segOrdinal=0，非全局累计）', JSON.stringify(mc.inputTokens))
  // turn 2 seg 1 = stepD → segOrdinal should be 1
  const md = computeTurnMetrics(2, order, nodes, tt, 'd2')
  assert(md.inputTokens === 400, 'turn2 seg1(stepD)输入=400（segOrdinal=1）', JSON.stringify(md.inputTokens))
  // computeSegOrdinal 直接验证
  assert(computeSegOrdinal('c2', order, nodes) === 0, 'computeSegOrdinal(c2)=0（回合内重置）', String(computeSegOrdinal('c2', order, nodes)))
  assert(computeSegOrdinal('d2', order, nodes) === 1, 'computeSegOrdinal(d2)=1', String(computeSegOrdinal('d2', order, nodes)))
}

// 同段不同 nodeKey 的聚合结果一致——cachedTurnMetrics 跨 step 去重的前提：
// 段号由 segOrdinal 表达、nodeKey 只决定段号，同段内结果必须与 nodeKey 无关
// （computeSegOrdinal 与 computeTurnMetrics 内 targetSeg 两处段号算法的一致性）。
{
  console.log('\n=== 同段跨 step 聚合一致性（缓存去重前提） ===')
  const nodes = new Map()
  const mk = (key, kind, turn, extra = {}) => nodes.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  mk('u1', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 50, outputTokens: 5 } } })
  mk('steer1', 'steering', 1)
  mk('b', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 200, outputTokens: 20 } } })
  mk('t1', 'tool-call', 1)
  mk('d', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 300, outputTokens: 30 } } })
  const order = ['u1', 'steer1', 'b', 't1', 'd']
  const turnTimings = new Map([[1, { startTime: 1000, endTime: 5000 }]])
  const segB = computeSegOrdinal('b', order, nodes)
  const segD = computeSegOrdinal('d', order, nodes)
  assert(segB === 1 && segD === 1, '同段（seg1）两个节点段号一致', JSON.stringify({ b: segB, d: segD }))
  const mB = computeTurnMetrics(1, order, nodes, turnTimings, 'b')
  const mD = computeTurnMetrics(1, order, nodes, turnTimings, 'd')
  assert(JSON.stringify(mB) === JSON.stringify(mD), '同段不同 nodeKey 聚合结果一致（跨 step 缓存去重前提）', JSON.stringify({ mB, mD }))
  assert(mB.modelCalls === 2 && mB.toolCalls === 1, 'seg1 聚合值正确（b+d 两个 step + 1 个工具）', JSON.stringify({ m: mB.modelCalls, t: mB.toolCalls }))
}

// DSH 0.1.2-rc.1：nodes 是 ChatNodeStore（非 Map），token 权威源在
// turn-tail.data.tokenUsage（uncachedInputTokens；cache/reasoning 可选）。
// 覆盖：store 形状读取、tokenUsage 覆盖 per-step usage、可选字段缺失、插话多段不重复计入。
{
  console.log('\n=== rc.1: ChatNodeStore + turn-tail tokenUsage 权威源 ===')
  // 用 store 形状（非 Map 实例）模拟 ChatNodeStore
  const inner = new Map()
  const store = { get: (key) => inner.get(key) }
  const mk = (key, kind, turn, extra = {}) => inner.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  mk('a', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 100, outputTokens: 80 } } })
  mk('b', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 700, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 90 } } })
  mk('c', 'tool-call', 1)
  // rc.1 turn-tail：权威聚合 + tokensPerSecond 仍在。fixture 与内置
  // deriveTurnTokenUsage 不变量一致：totalTokens = uncached + cacheRead +
  // cacheWrite + output（1000+150+50+250 = 1450）；总输入 = 1450-250 = 1200。
  mk('tt', 'turn-tail', 1, { data: { tokensPerSecond: 42, tokenUsage: { uncachedInputTokens: 1000, outputTokens: 250, totalTokens: 1450, cacheReadTokens: 150, cacheWriteTokens: 50, reasoningTokens: 30 } } })
  const turnTimings = new Map([[1, { startTime: 1000, endTime: 36000 }]])
  const m = computeTurnMetrics(1, ['a', 'b', 'c', 'tt'], store, turnTimings, 'b')
  assert(m.inputTokens === 1200, 'tokenUsage 覆盖：总输入 = totalTokens-outputTokens = 1450-250 = 1200（非 per-step 1800）', JSON.stringify(m.inputTokens))
  assert(m.outputTokens === 250, 'tokenUsage 覆盖输出 = 250', JSON.stringify(m.outputTokens))
  assert(m.cacheReadTokens === 150 && m.cacheWriteTokens === 50, 'cacheRead/cacheWrite 取自 tokenUsage', JSON.stringify({ r: m.cacheReadTokens, w: m.cacheWriteTokens }))
  assert(m.reasoningTokens === 30, 'reasoningTokens 取自 tokenUsage', JSON.stringify(m.reasoningTokens))
  // lastModelInputTokens 供「上下文增量」用，必须取末次 attempt 的真实上下文规模
  // （per-step 'b' = 700+300+0 = 1000），不能被 turn-tail 跨 attempt 求和的
  // uncachedInputTokens(1000)+cacheRead(150)+cacheWrite(50)=1200 覆盖，否则重试一圈
  // 后「新增上下文」会塌成负几百 K。
  assert(m.lastModelInputTokens === 1000, 'lastModelInput = 末次 attempt 用量 1000（不被 tokenUsage 求和覆盖）', JSON.stringify(m.lastModelInputTokens))
  assert(m.tokensPerSecond === 42, 'tokensPerSecond 仍在 turn-tail data 上', JSON.stringify(m.tokensPerSecond))
  assert(m.toolCalls === 1 && m.modelCalls === 2, '工具/模型计数仍按节点统计', JSON.stringify({ t: m.toolCalls, m: m.modelCalls }))
  assert(m.durationMs === 35000, '耗时仍从 turnTimings 透出', JSON.stringify(m.durationMs))
  // 可选字段缺失：tokenUsage 缺 cache/reasoning 桶（内置 aggregateAttempts
  // 在任一 attempt 缺桶时整体置 undefined）——此时保留 per-step 累加值
  // （cacheRead=500/cacheWrite=100），不得清零；输入仍走精确口径 360-60=300。
  mk('tt2', 'turn-tail', 1, { data: { tokenUsage: { uncachedInputTokens: 300, outputTokens: 60, totalTokens: 360 } } })
  const m2 = computeTurnMetrics(1, ['a', 'b', 'c', 'tt2'], store, turnTimings, 'b')
  assert(m2.inputTokens === 300 && m2.outputTokens === 60, '可选 cache/reasoning 缺失时输入按精确口径聚合', JSON.stringify(m2))
  assert(m2.cacheReadTokens === 500 && m2.cacheWriteTokens === 100, '缺失的 cache 桶保留 per-step 累加值（不清零）', JSON.stringify({ r: m2.cacheReadTokens, w: m2.cacheWriteTokens }))
  assert(m2.lastModelInputTokens === 1000, 'm2 lastModelInput 仍为末次 attempt 1000（可选字段缺失不影响到它）', JSON.stringify(m2.lastModelInputTokens))
  // 无 tokenUsage 时回退 per-step usage（运行态/旧版形状）
  mk('tt3', 'turn-tail', 1, { data: { tokensPerSecond: 7 } })
  const m3 = computeTurnMetrics(1, ['a', 'b', 'c', 'tt3'], store, turnTimings, 'b')
  assert(m3.inputTokens === 1800, '无 tokenUsage 回退 per-step usage 累加 = 1800', JSON.stringify(m3.inputTokens))
  assert(m3.lastModelInputTokens === 1000, 'm3 lastModelInput 仍为末次 attempt 1000（无 tokenUsage 不例外）', JSON.stringify(m3.lastModelInputTokens))
}

// 核心 bug 回归（inputTokens 只统计到未命中缓存）：
// 缓存桶（cacheReadTokens/cacheWriteTokens）任一 attempt 缺失时，内置
// aggregateAttempts 会整体丢弃缓存桶，但 totalTokens 恒为精确值——
// 总输入必须取 totalTokens - outputTokens（含缓存命中），不能退化成
// uncachedInputTokens（只等于未命中缓存部分）。
{
  console.log('\n=== 回归：缓存桶缺失时总输入仍含缓存命中（内置精确总量） ===')
  const inner = new Map()
  const store = { get: (key) => inner.get(key) }
  const mk = (key, kind, turn, extra = {}) => inner.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  mk('a', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 1000, outputTokens: 50 } } })
  // 内置精确口径：totalTokens=1400、output=250 → 总输入=1150（其中 150 是
  // 缓存命中但缓存桶缺失未报）。旧公式 uncached(1000)+0+0=1000 会偏小。
  mk('tt', 'turn-tail', 1, { data: { tokenUsage: { uncachedInputTokens: 1000, outputTokens: 250, totalTokens: 1400 } } })
  const tt = new Map([[1, { startTime: 0, endTime: 1000 }]])
  const m = computeTurnMetrics(1, ['a', 'tt'], store, tt, 'a')
  assert(m.inputTokens === 1150, '缓存桶缺失：总输入 = 1400-250 = 1150（非 uncached 1000）', JSON.stringify(m.inputTokens))
  assert(m.cacheReadTokens === undefined && m.cacheWriteTokens === undefined, '缺失的缓存桶字段不出现', JSON.stringify({ r: m.cacheReadTokens, w: m.cacheWriteTokens }))
  // per-step usage 带 totalTokens 但缺 cacheReadTokens：step 总输入同样取精确口径
  const inner2 = new Map()
  const store2 = { get: (key) => inner2.get(key) }
  inner2.set('s', { kind: 'assistant-step', location: { kind: 'step', turn: { turn: 1 } }, data: { finalNode: {}, usage: { inputTokens: 700, outputTokens: 90, totalTokens: 1090 } } })
  const m2 = computeTurnMetrics(1, ['s'], store2, new Map([[1, { startTime: 0, endTime: 1000 }]]))
  assert(m2.inputTokens === 1000, 'per-step 精确口径：1090-90 = 1000（含未报的缓存命中）', JSON.stringify(m2.inputTokens))
  assert(m2.lastModelInputTokens === 1000, 'lastModelInput 同精确口径 = 1000', JSON.stringify(m2.lastModelInputTokens))
}

// rc.1 + 插话分段：turn-tail 在最后段，tokenUsage 只覆盖该段，不污染前段
{
  console.log('\n=== rc.1: tokenUsage 只在 turn-tail 所在段生效（插话多段） ===')
  const inner = new Map()
  const store = { get: (key) => inner.get(key) }
  const mk = (key, kind, turn, extra = {}) => inner.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  mk('a', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 } } })
  inner.set('steer1', { kind: 'steering', location: { kind: 'session' } })
  mk('b', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60 } } })
  mk('tt', 'turn-tail', 1, { data: { tokenUsage: { uncachedInputTokens: 3500, outputTokens: 200, totalTokens: 3700 } } })
  const turnTimings = new Map([[1, { startTime: 1000, endTime: 5000 }]])
  // seg0（nodeKey='a'）：turn-tail 在 seg1，不应被 tokenUsage 覆盖
  const m0 = computeTurnMetrics(1, ['a', 'steer1', 'b', 'tt'], store, turnTimings, 'a')
  assert(m0.inputTokens === 1000, 'seg0 保持 per-step 值 1000（tokenUsage 不跨段污染）', JSON.stringify(m0.inputTokens))
  // seg1（nodeKey='b'）：turn-tail 同在 seg1，tokenUsage 覆盖
  const m1 = computeTurnMetrics(1, ['a', 'steer1', 'b', 'tt'], store, turnTimings, 'b')
  assert(m1.inputTokens === 3500, 'seg1（turn-tail 所在段）展示输入由 tokenUsage 覆盖 = 3500', JSON.stringify(m1.inputTokens))
  assert(m1.lastModelInputTokens === 2000, 'seg1 lastModelInput = 末次 attempt 2000（不被 tokenUsage 求和覆盖）', JSON.stringify(m1.lastModelInputTokens))
}

// ── P1：帧级缓存失效矩阵（cachedTurnMetrics / cachedSegOrdinal）──
{
  console.log('\n=== 帧级缓存失效矩阵 ===')
  const inner = new Map()
  // 模拟 rc.1 ChatNodeStore：get 读内容，values() 返回「内容纪元」引用——
  // upsert 后重建数组（引用变化），未变更时引用恒定（原地可变存储的防脏命中关键）。
  let epochObj = { epoch: 0 }
  const store = {
    get: (key) => inner.get(key),
    values: () => epochObj,
  }
  const mk = (key, kind, turn, extra = {}) => inner.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  mk('a', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 100, outputTokens: 10 } } })
  mk('c', 'tool-call', 1)
  const order = ['a', 'c']
  const timings = new Map([[1, { startTime: 1000, endTime: 5000 }]])

  const m1 = cachedTurnMetrics('s', 1, 0, order, store, timings, 'a')
  const m2 = cachedTurnMetrics('s', 1, 0, order, store, timings, 'a')
  assert(m1 === m2, '同输入二次调用命中缓存（同一对象引用）')
  // 内容原地变化（valuesEpoch 引用更新）→ 必须重算，否则脏命中
  epochObj = { epoch: 1 }
  const m3 = cachedTurnMetrics('s', 1, 0, order, store, timings, 'a')
  assert(m3 !== m2, 'valuesEpoch 变化触发重算（原地可变 store 防脏命中）')
  // 计时端点更新（running→ok，Map 引用不变）→ 必须重算
  epochObj = { epoch: 1 } // 纪元不变，端点变化
  timings.set(1, { startTime: 1000, endTime: 8000 })
  const m4 = cachedTurnMetrics('s', 1, 0, order, store, timings, 'a')
  assert(m4 !== m3 && m4 !== null && m4.durationMs === 7000, 'turnEnd 端点更新触发重算', String(m4 && m4.durationMs))
  // 不同 segOrdinal 是不同键（互不覆盖）
  const m5 = cachedTurnMetrics('s', 1, 1, order, store, timings, 'a')
  assert(m5 !== m4, 'segOrdinal 不同键互不覆盖')
  // cachedSegOrdinal：命中 + 纪元失效重算
  const s1 = cachedSegOrdinal('a', order, store)
  const s2 = cachedSegOrdinal('a', order, store)
  assert(s1 === s2 && s2 === 0, 'segOrdinal 缓存命中且值正确', String(s2))
  epochObj = { epoch: 2 }
  const s3 = cachedSegOrdinal('a', order, store)
  assert(s3 === 0, 'segOrdinal epoch 变化后重算仍正确', String(s3))
  // 禁用路径：sessionId 空 → 直调 computeTurnMetrics（同输入两次返回新对象）
  const d1 = cachedTurnMetrics('', 1, 0, order, store, timings, 'a')
  const d2 = cachedTurnMetrics('', 1, 0, order, store, timings, 'a')
  assert(d1 !== null && d1.modelCalls === 1 && d1 !== d2, 'sessionId 空禁用缓存直调 computeTurnMetrics')
  // 禁用路径：nodes 无 values() → 直调（每次新对象）
  const noValuesStore = { get: (key) => inner.get(key) }
  const nv1 = cachedTurnMetrics('s', 1, 0, order, noValuesStore, timings, 'a')
  const nv2 = cachedTurnMetrics('s', 1, 0, order, noValuesStore, timings, 'a')
  assert(nv1 !== null && nv1 !== nv2, 'nodes 无 values() 时禁用缓存')
}

// ── P3：末段索引同步矩阵（lastSegBySession 五条维护路径）──
{
  console.log('\n=== 末段索引同步矩阵 ===')
  const S = 'idx-sess'
  // 1) 三段发布：最大段 seg2 为上一回合末输入
  publishTurnMetrics(S, 5, 0, { lastModelInputTokens: 100 })
  publishTurnMetrics(S, 5, 2, { lastModelInputTokens: 300 })
  publishTurnMetrics(S, 5, 1, { lastModelInputTokens: 200 })
  assert(readPreviousTurnLastInput(S, 6) === 300, '最大段 seg2 为上一回合末输入')
  // 2) 删除最大段 → 索引重扫取次大
  publishTurnMetrics(S, 5, 2, null)
  assert(readPreviousTurnLastInput(S, 6) === 200, '删除最大段后索引重扫取 seg1', String(readPreviousTurnLastInput(S, 6)))
  // 3) 删除非最大段 → 索引不动
  publishTurnMetrics(S, 5, 0, null)
  assert(readPreviousTurnLastInput(S, 6) === 200, '删除非最大段索引不动', String(readPreviousTurnLastInput(S, 6)))
  // 4) 空档跳过语义保留：turn6 未发布时往前取最近
  assert(readPreviousTurnLastInput(S, 7) === 200, 'turn6 未发布时往前取最近（turn5 末段）', String(readPreviousTurnLastInput(S, 7)))
  // 5) 130 段裁剪：128 上限裁最老段，索引仍指向最新段
  for (let i = 0; i < 130; i++) publishTurnMetrics(S, 9, i, { lastModelInputTokens: i + 1 })
  assert(readPreviousTurnLastInput(S, 10) === 130, '130 段裁剪后末段索引指向最新段 seg129', String(readPreviousTurnLastInput(S, 10)))
  // 6) 会话裁剪：cut-sess-1 发布后灌入 9 个新会话 → 被 8 会话上限淘汰
  publishTurnMetrics('cut-sess-1', 1, 0, { lastModelInputTokens: 1 })
  assert(readPreviousTurnLastInput('cut-sess-1', 2) === 1, '会话裁剪前可读自身')
  for (let s = 2; s <= 10; s++) publishTurnMetrics('cut-sess-' + s, 1, 0, { lastModelInputTokens: s })
  assert(readPreviousTurnLastInput('cut-sess-1', 2) === undefined, '最老会话被裁剪后读取返回 undefined（索引一并清理）', String(readPreviousTurnLastInput('cut-sess-1', 2)))
  // 7) 含冒号 sessionId：段裁剪解析不取错分隔点（P3-1 回归钉住）
  const colonSess = 'sess:with:colons'
  for (let i = 0; i < 130; i++) publishTurnMetrics(colonSess, 3, i, { lastModelInputTokens: i + 1 })
  assert(readPreviousTurnLastInput(colonSess, 4) === 130, '含冒号 sessionId 的段裁剪后索引正确', String(readPreviousTurnLastInput(colonSess, 4)))
}

// ── 运行中 tok/s：turn-tail 未建出时由已 finalized 的 assistant-step 实时推导 ──
// 根因：turn-tail 节点的 buildLocationData 在回合内没有 turn/end 事件时返回 null，
// 因此进行中的回合根本拿不到 data.tokensPerSecond —— 速率整段空白。宿主的
// deriveTurnMetrics 用的是「已 finalized step 的 outputTokens / decodeMs」，
// 这里按同口径在回合结束前先顶上。
{
  console.log('\n=== 运行中 tok/s 实时推导 ===')
  const nodes = new Map()
  const mk = (key, kind, turn, extra = {}) => nodes.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  // 真实形状：timing 挂在 finalNode（AssistantMessageNode）上，不在 data 顶层；
  // data.status 为 'running' | 'settled' | 'interrupted'（已结算才可采样）。
  const step = (key, turn, out, first, done) => mk(key, 'assistant-step', turn, {
    data: {
      status: 'settled',
      finalNode: { timing: { stepStartTime: first - 500, firstTokenTime: first, completedTime: done } },
      usage: { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: out },
    },
  })

  // 进行中回合：两个已完成 step，无 turn-tail 节点
  step('s1', 1, 100, 1000, 2000)   // decode 1000ms, 100 tok
  step('s2', 1, 300, 3000, 5000)   // decode 2000ms, 300 tok
  const running = computeTurnMetrics(1, ['s1', 's2'], nodes, undefined)
  // (100+300) / ((1000+2000)/1000) = 400/3 = 133.33
  assert(Math.abs(running.tokensPerSecond - 400 / 3) < 1e-9,
    '运行中 tok/s = 400tok / 3s = 133.3', JSON.stringify(running.tokensPerSecond))

  // 只有 running（未 finalized，无 finalNode）的 step 时没有可测 decode → 不显示（不编造）
  const n2 = new Map()
  n2.set('r1', { kind: 'assistant-step', location: { kind: 'step', turn: { turn: 2 } },
    data: { usage: { outputTokens: 50 }, timing: { firstTokenTime: 100, completedTime: 900 } } })
  const noFinal = computeTurnMetrics(2, ['r1'], n2, undefined)
  assert(noFinal.tokensPerSecond === undefined, '未 finalized 的 step 不产出 tok/s（无 finalNode）', JSON.stringify(noFinal.tokensPerSecond))

  // S1 回归：usage 随 live-chunk 提前到达（ui-chat updateChunk 的 'usage' 分支
  // 直接写 state.usage），而 firstTokenTime 在首个 token delta 就写入、
  // completedTime 要等 assistant/message 结算。若在「已有 usage 但本步未结算」
  // 时采样，会算出 outputTokens/(now-firstTokenTime) 的假速率（如 5tok/200ms
  // = 25 tok/s）并随流式持续下降。必须只在 status 已结算时才计入。
  const nLive = new Map()
  nLive.set('l1', { kind: 'assistant-step', location: { kind: 'step', turn: { turn: 6 } },
    data: { status: 'running', usage: { outputTokens: 5 }, finalNode: { timing: { firstTokenTime: 1000, completedTime: 1200 } } } })
  const liveTps = computeTurnMetrics(6, ['l1'], nLive, undefined)
  assert(liveTps.tokensPerSecond === undefined,
    '流式中（status=running）已有 usage 也不采样，避免假速率', JSON.stringify(liveTps.tokensPerSecond))

  // 时长必须严格为正：completed === firstToken 时 0 时长会把分母稀释成假速率
  const nZero = new Map()
  nZero.set('z1', { kind: 'assistant-step', location: { kind: 'step', turn: { turn: 7 } },
    data: { status: 'settled', usage: { outputTokens: 100 }, finalNode: { timing: { firstTokenTime: 5000, completedTime: 5000 } } } })
  const zeroTps = computeTurnMetrics(7, ['z1'], nZero, undefined)
  assert(zeroTps.tokensPerSecond === undefined,
    '零 decode 时长不采样（completed 必须 > firstToken）', JSON.stringify(zeroTps.tokensPerSecond))

  // firstTokenTime 为 null（未记录 token delta）→ 该步不参与，避免除零/虚高
  const n3 = new Map()
  n3.set('c1', { kind: 'assistant-step', location: { kind: 'step', turn: { turn: 3 } },
    data: { status: 'settled', finalNode: { timing: { stepStartTime: 1, firstTokenTime: null, completedTime: 900 } }, usage: { outputTokens: 80 } } })
  const noFirst = computeTurnMetrics(3, ['c1'], n3, undefined)
  assert(noFirst.tokensPerSecond === undefined, 'firstTokenTime 缺失的 step 不参与推导', JSON.stringify(noFirst.tokensPerSecond))

  // turn-tail 权威值出现后覆盖推导值（回合结束后以内置口径为准）
  const n4 = new Map()
  n4.set('d1', { kind: 'assistant-step', location: { kind: 'step', turn: { turn: 4 } },
    data: { status: 'settled', finalNode: { timing: { firstTokenTime: 1000, completedTime: 2000 } }, usage: { inputTokens: 10, outputTokens: 100 } } })
  n4.set('tail', { kind: 'turn-tail', location: { kind: 'turn', turn: { turn: 4 } },
    data: { tokensPerSecond: 42.5 } })
  const withTail = computeTurnMetrics(4, ['d1', 'tail'], n4, undefined)
  assert(withTail.tokensPerSecond === 42.5, 'turn-tail 权威值优先于推导值', JSON.stringify(withTail.tokensPerSecond))

  // 段隔离：插话段只统计本段 step，不混入上一段的 decode
  const n5 = new Map()
  step('e1', 5, 100, 1000, 2000)
  n5.set('steer', { kind: 'steering', location: { kind: 'session' } })
  n5.set('e2', { kind: 'assistant-step', location: { kind: 'step', turn: { turn: 5 } },
    data: { status: 'settled', finalNode: { timing: { firstTokenTime: 3000, completedTime: 5000 } }, usage: { inputTokens: 10, outputTokens: 200 } } })
  const seg1 = computeTurnMetrics(5, ['e1', 'steer', 'e2'], n5, undefined, 'e2')
  assert(Math.abs(seg1.tokensPerSecond - 100) < 1e-9,
    'seg1 tok/s 只含本段 step：200tok / 2s = 100', JSON.stringify(seg1.tokensPerSecond))
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1