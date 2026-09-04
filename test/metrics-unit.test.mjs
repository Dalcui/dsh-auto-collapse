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

const { publishTurnMetrics, readTurnMetrics, readPreviousTurnLastInput, computeTurnMetrics, computeSegOrdinal } = mod
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
  // rc.1 turn-tail：权威聚合 + tokensPerSecond 仍在
  mk('tt', 'turn-tail', 1, { data: { tokensPerSecond: 42, tokenUsage: { uncachedInputTokens: 1000, outputTokens: 250, totalTokens: 1250, cacheReadTokens: 150, cacheWriteTokens: 50, reasoningTokens: 30 } } })
  const turnTimings = new Map([[1, { startTime: 1000, endTime: 36000 }]])
  const m = computeTurnMetrics(1, ['a', 'b', 'c', 'tt'], store, turnTimings, 'b')
  assert(m.inputTokens === 1200, 'tokenUsage 覆盖：总输入 = 1000+150+50 = 1200（非 per-step 1800）', JSON.stringify(m.inputTokens))
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
  // 可选字段缺失：cache/reasoning 缺省按 0 处理，不抛错
  mk('tt2', 'turn-tail', 1, { data: { tokenUsage: { uncachedInputTokens: 300, outputTokens: 60, totalTokens: 360 } } })
  const m2 = computeTurnMetrics(1, ['a', 'b', 'c', 'tt2'], store, turnTimings, 'b')
  assert(m2.inputTokens === 300 && m2.outputTokens === 60, '可选 cache/reasoning 缺失时按 0 聚合', JSON.stringify(m2))
  assert(m2.cacheReadTokens === undefined && m2.cacheWriteTokens === undefined, '缺失的 cache 字段不出现', JSON.stringify({ r: m2.cacheReadTokens, w: m2.cacheWriteTokens }))
  assert(m2.lastModelInputTokens === 1000, 'm2 lastModelInput 仍为末次 attempt 1000（可选字段缺失不影响到它）', JSON.stringify(m2.lastModelInputTokens))
  // 无 tokenUsage 时回退 per-step usage（运行态/旧版形状）
  mk('tt3', 'turn-tail', 1, { data: { tokensPerSecond: 7 } })
  const m3 = computeTurnMetrics(1, ['a', 'b', 'c', 'tt3'], store, turnTimings, 'b')
  assert(m3.inputTokens === 1800, '无 tokenUsage 回退 per-step usage 累加 = 1800', JSON.stringify(m3.inputTokens))
  assert(m3.lastModelInputTokens === 1000, 'm3 lastModelInput 仍为末次 attempt 1000（无 tokenUsage 不例外）', JSON.stringify(m3.lastModelInputTokens))
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

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1