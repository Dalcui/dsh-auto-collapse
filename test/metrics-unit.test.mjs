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

const { publishTurnMetrics, readTurnMetrics, readPreviousTurnLastInput, computeTurnMetrics } = mod
const S = 'sess-a'

// 上一回合末输入查找（按 sessionId 隔离）
mod.publishTurnMetrics(S, 1, { lastModelInputTokens: 10000 })
mod.publishTurnMetrics(S, 2, { lastModelInputTokens: 15000 })
mod.publishTurnMetrics(S, 4, { lastModelInputTokens: 22000 })
assert(readPreviousTurnLastInput(S, 2) === 10000, '上一回合末输入 = turn1', String(readPreviousTurnLastInput(S, 2)))
assert(readPreviousTurnLastInput(S, 4) === 15000, '跳过空档取最近已发布回合 turn2', String(readPreviousTurnLastInput(S, 4)))
assert(readPreviousTurnLastInput(S, 1) === undefined, '首回合无上一回合（调用方据此取基线 0）', String(readPreviousTurnLastInput(S, 1)))
assert(readTurnMetrics(S, 2).lastModelInputTokens === 15000, 'readTurnMetrics 透出 lastModelInputTokens')

// 会话隔离：main↔subagent 同名 turn 不串扰
mod.publishTurnMetrics('sess-b', 2, { lastModelInputTokens: 99999 })
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

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
