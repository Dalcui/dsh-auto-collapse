/**
 * metrics-unit.test.mjs — 需求 5 的纯函数单元测试。
 * 用 esbuild 把 src/turn-metrics.ts 转译后导入（不 bundle、不进 React），
 * 验证 computeTurnMetrics 记录「最后一次模型调用输入 token」，以及
 * readPreviousTurnLastInput 找到上一回合末输入，从而支撑上下文增量计算。
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

// 上一回合末输入查找
mod.publishTurnMetrics(1, { lastModelInputTokens: 10000 })
mod.publishTurnMetrics(2, { lastModelInputTokens: 15000 })
mod.publishTurnMetrics(4, { lastModelInputTokens: 22000 })
assert(readPreviousTurnLastInput(2) === 10000, '上一回合末输入 = turn1', String(readPreviousTurnLastInput(2)))
assert(readPreviousTurnLastInput(4) === 15000, '跳过空档取最近已发布回合 turn2', String(readPreviousTurnLastInput(4)))
assert(readPreviousTurnLastInput(1) === undefined, '首回合无上一回合', String(readPreviousTurnLastInput(1)))
assert(readTurnMetrics(2).lastModelInputTokens === 15000, 'readTurnMetrics 透出 lastModelInputTokens')

// computeTurnMetrics 计算 lastModelInputTokens = 最后一个 step 的输入总量（含缓存）
{
  const nodes = new Map()
  const mk = (key, kind, turn, extra = {}) => nodes.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
  mk('a', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 100, outputTokens: 80 } } })
  mk('b', 'assistant-step', 1, { data: { finalNode: {}, usage: { inputTokens: 700, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 90 } } })
  mk('c', 'tool-call', 1)
  const m = computeTurnMetrics(1, ['a', 'b', 'c'], nodes, undefined)
  assert(m.lastModelInputTokens === 1000, '最后一次模型输入 = 700+300+0 = 1000', JSON.stringify(m.lastModelInputTokens))
  assert(m.inputTokens === 1800, '总输入 = (500+200+100)+(700+300+0) = 1800', JSON.stringify(m.inputTokens))
  assert(m.toolCalls === 1 && m.modelCalls === 2, '工具/模型调用计数', JSON.stringify({ t: m.toolCalls, m: m.modelCalls }))
}

// 跨回合增量：turn2 末输入 15000 - turn1 末输入 10000 = 5000
{
  const delta = readTurnMetrics(2).lastModelInputTokens - readPreviousTurnLastInput(2)
  assert(delta === 5000, '上下文增量 = 15000 - 10000 = 5000', String(delta))
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
