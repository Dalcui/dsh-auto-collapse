/**
 * parity-fuzz — 旧（git HEAD）vs 新（工作区）turn-metrics 等价性对拍。
 * 随机生成 world（多回合/steering/缺失 location/异常 turn 号），逐键比对
 * computeTurnMetrics / computeSegOrdinal / cachedTurnMetrics 输出。
 * 用法：node bench/parity-fuzz.mjs [--json]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const newCode = transformSync(readFileSync(join(root, 'src/turn-metrics.ts'), 'utf8'), { loader: 'ts', format: 'esm' }).code
const oldRawSource = readFileSync(join(root, 'bench/_old-turn-metrics.mjs.ts.txt'), 'utf8')
const oldCode = transformSync(oldRawSource, { loader: 'ts', format: 'esm' }).code
const newMod = await import('data:text/javascript;base64,' + Buffer.from(newCode).toString('base64'))
const oldMod = await import('data:text/javascript;base64,' + Buffer.from(oldCode).toString('base64'))
// old-canonical：旧源码文本补丁——把 computeTurnMetrics 聚合循环的 seg 计数器
// 规范成与旧 computeSegOrdinal 相同的规则（全部 steering ++、边界先于 ++）。
// 若 新 ≡ old-canonical，则 新旧 的全部残差都归因于旧双算法漂移 bug（方案第六节
// 声明要修的问题），而非新实现引入的回归。
const canonPatchFrom = `    if (!n || !n.location) continue
    // steering 节点是段边界：段号 +1，不计入指标（回合切换时归 0，与 targetSeg 对齐）
    if (n.kind === 'steering') {
      seg++
      continue
    }`
const canonPatchTo = `    if (n && n.kind === 'steering') {
      if (n.location && (n.location.kind === 'turn' || n.location.kind === 'step') && n.location.turn) {
        const t = n.location.turn.turn
        if (currentTurn !== undefined && t !== currentTurn) seg = 0
        currentTurn = t
      }
      seg++
      continue
    }
    if (!n || !n.location) continue`
if (!oldRawSource.includes(canonPatchFrom)) throw new Error('canonical patch anchor not found')
const canonCode = oldRawSource.replace(canonPatchFrom, canonPatchTo)
const canonMod = await import('data:text/javascript;base64,' + Buffer.from(transformSync(canonCode, { loader: 'ts', format: 'esm' }).code).toString('base64'))

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KINDS = ['assistant-step', 'tool-call', 'turn-tail', 'model-retry', 'steering', 'user']

/** 随机 world：返回 {nodes, order, turnTimings, turns}。 */
function randomWorld(rng) {
  const nodes = new Map()
  const order = []
  const turnTimings = new Map()
  const turnCount = 1 + Math.floor(rng() * 6)
  let keyN = 0
  for (let t = 1; t <= turnCount; t++) {
    if (rng() < 0.85) {
      order.push('u' + t)
      nodes.set('u' + t, { kind: 'user', location: { kind: 'step', turn: { turn: t } } })
      keyN++
    }
    const steerings = Math.floor(rng() * 3)
    for (let s = 0; s < steerings; s++) {
      // steering 的 location 有三种形态：session（无 turn）/step 带 turn/完全缺失
      const roll = rng()
      const loc = roll < 0.5 ? { kind: 'session' } : roll < 0.8 ? { kind: 'step', turn: { turn: t } } : undefined
      nodes.set('st' + t + '_' + s, loc === undefined ? { kind: 'steering' } : { kind: 'steering', location: loc })
      order.push('st' + t + '_' + s)
      keyN++
    }
    const nodesInTurn = 1 + Math.floor(rng() * 7)
    for (let i = 0; i < nodesInTurn; i++) {
      const kind = KINDS[Math.floor(rng() * KINDS.length)]
      const key = 'n' + (keyN++)
      // 少数节点带异常 turn 号（0/负数/大数）或 location 缺失
      const roll = rng()
      let turnNo = t
      if (roll < 0.04) turnNo = 0
      else if (roll < 0.06) turnNo = 999
      else if (roll < 0.08) turnNo = -1
      const loc = rng() < 0.06 ? undefined : { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn: turnNo } }
      const node = { kind, location: loc }
      if (kind === 'assistant-step' && rng() < 0.9) {
        node.data = {
          status: rng() < 0.85 ? 'settled' : 'running',
          finalNode: rng() < 0.9 ? { timing: { firstTokenTime: 1000 + rng() * 1e5, completedTime: 2000 + rng() * 1e5 } } : undefined,
          usage: { inputTokens: Math.floor(rng() * 5000), cacheReadTokens: Math.floor(rng() * 1000), cacheWriteTokens: Math.floor(rng() * 500), outputTokens: Math.floor(rng() * 2000), reasoningTokens: Math.floor(rng() * 300), totalTokens: undefined },
        }
        if (rng() < 0.3) node.data.usage.totalTokens = node.data.usage.inputTokens + node.data.usage.outputTokens
      } else if (kind === 'turn-tail' && rng() < 0.8) {
        node.data = { tokensPerSecond: rng() * 100, ttftMs: rng() * 2000, tokenUsage: rng() < 0.7 ? { uncachedInputTokens: Math.floor(rng() * 3000), outputTokens: Math.floor(rng() * 1000), totalTokens: Math.floor(rng() * 5000), cacheReadTokens: Math.floor(rng() * 800), cacheWriteTokens: undefined, reasoningTokens: Math.floor(rng() * 100) } : undefined }
      } else if (kind === 'model-retry' && rng() < 0.7) {
        node.data = { attempts: Array.from({ length: Math.floor(rng() * 3) }, () => (rng() < 0.6 ? { retryState: 'started' } : { retryState: 'cancelled' })) }
      }
      if (rng() < 0.1) node.data = undefined
      nodes.set(key, node)
      order.push(key)
    }
    if (rng() < 0.8) turnTimings.set(t, { startTime: Math.floor(rng() * 1e6), endTime: Math.floor(rng() * 2e6) })
  }
  return { nodes, order, turnTimings, turnCount }
}

function normMetrics(m) {
  if (m === null || m === undefined) return 'null'
  const keys = Object.keys(m).sort()
  return keys.map(k => m[k] === undefined ? k + ':u' : k + ':' + String(m[k])).join('|')
}

let worlds = 0, checks = 0, mismatches = 0, hardMismatches = 0, driftFixed = 0
const details = []
for (let w = 0; w < 500; w++) {
  const rng = mulberry32(0xA11CE + w)
  const { nodes, order, turnTimings, turnCount } = randomWorld(rng)
  const storeLike = { get: k => nodes.get(k), values: () => ({ epoch: w }) }
  const plainMap = nodes // 无 values() 的退化路径
  for (const store of [storeLike, plainMap]) {
    for (let t = 1; t <= turnCount + 1; t++) {
      const a = normMetrics(newMod.computeTurnMetrics(t, order, store, turnTimings))
      const b = normMetrics(oldMod.computeTurnMetrics(t, order, store, turnTimings))
      const c = normMetrics(canonMod.computeTurnMetrics(t, order, store, turnTimings))
      checks++
      if (a !== c) { hardMismatches++; if (details.length < 8) details.push({ world: w, HARD: true, turn: t, withValues: store === storeLike, a: a.slice(0,140), c: c.slice(0,140) }) }
      else if (a !== b) { driftFixed++; }
    }
    // 每个存在的 key 的 segOrdinal 对拍
    for (const key of order) {
      const a = newMod.computeSegOrdinal(key, order, store)
      const b = oldMod.computeSegOrdinal(key, order, store)
      checks++
      if (a !== b) { mismatches++; if (details.length < 5) details.push({ world: w, segKey: key, a, b }) }
    }
    // cached 层（新实现对 cachedSegOrdinal 直通索引；旧实现有 LRU——对拍值语义）
    if (store === storeLike) {
      for (const key of order) {
        const a = newMod.cachedSegOrdinal(key, order, store)
        const b = oldMod.cachedSegOrdinal(key, order, store)
        checks++
        if (a !== b) { mismatches++; if (details.length < 5) details.push({ world: w, cachedSeg: key, a, b }) }
      }
      for (let t = 1; t <= turnCount; t++) {
        const nodeKey = order[order.length - 1]
        const a = normMetrics(newMod.cachedTurnMetrics('fz' + w, t, 0, order, store, turnTimings, nodeKey))
        const b = normMetrics(oldMod.cachedTurnMetrics('fz' + w, t, 0, order, store, turnTimings, nodeKey))
        const c = normMetrics(canonMod.cachedTurnMetrics('fz' + w, t, 0, order, store, turnTimings, nodeKey))
        checks++
        if (a !== c) { hardMismatches++; if (details.length < 8) details.push({ world: w, HARD: true, cachedTurn: t, nodeKey, a: a.slice(0, 140), c: c.slice(0, 140) }) }
        else if (a !== b) { driftFixed++ }
      }
    }
  }
  worlds++
}
const result = { worlds, checks, mismatches, details }
if (process.argv.includes('--json')) console.log(JSON.stringify(result))
else {
  console.log('worlds:', worlds, ' checks:', checks)
  console.log('HARD(new≠old-canonical):', hardMismatches, '  drift-fixed(new≡canonical≠old-raw):', driftFixed)
  for (const d of details) console.log(JSON.stringify(d).slice(0, 300))
}
if (hardMismatches > 0) process.exitCode = 1