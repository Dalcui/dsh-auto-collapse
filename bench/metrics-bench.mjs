/**
 * metrics-bench — turn-metrics 侧基准：S 个可见 assistant-step 一帧的派生成本。
 * 直接转译 src/turn-metrics.ts（不进 React），模拟「结构变化批次」后一帧内
 * S 个 step 各自 useMemo 的真实调用模式：
 *   before: S × cachedSegOrdinal(O(N) miss) + T 回合 × computeTurnMetrics(O(N))
 *   after : 一次 buildIndex(O(N)) + S × O(1) 查表
 * 用法：node bench/metrics-bench.mjs [--json]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const srcCode = readFileSync(join(root, 'src/turn-metrics.ts'), 'utf8')
const { code } = transformSync(srcCode, { loader: 'ts', format: 'esm' })
const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const { cachedTurnMetrics, cachedSegOrdinal } = mod

function now() { return performance.now() }

/** 构造 T 回合 world：每回合 user → tool×2 → step×K。steering 每 3 回合插一段。 */
function buildWorld(turns, stepsPerTurn) {
  const nodes = new Map()
  const order = []
  const mk = (key, kind, turn, extra = {}) => {
    nodes.set(key, { kind, location: { kind: kind === 'turn-tail' ? 'turn' : 'step', turn: { turn } }, ...extra })
    order.push(key)
  }
  let steerCount = 0
  for (let t = 1; t <= turns; t++) {
    mk('u' + t, 'user', t)
    if (t > 1 && t % 3 === 0) { nodes.set('steer' + t, { kind: 'steering', location: { kind: 'session' } }); order.push('steer' + t); steerCount++ }
    for (let k = 1; k <= 2; k++) mk('tool' + t + '_' + k, 'tool-call', t)
    for (let s = 1; s <= stepsPerTurn; s++) {
      mk('step' + t + '_' + s, 'assistant-step', t, {
        data: { status: 'settled', finalNode: { timing: { firstTokenTime: t * 1e6 + s * 1e3, completedTime: t * 1e6 + s * 1e3 + 900 } }, usage: { inputTokens: 1000 + s, cacheReadTokens: 50, cacheWriteTokens: 10, outputTokens: 100 + s } },
      })
    }
    mk('tail' + t, 'turn-tail', t, { data: { tokensPerSecond: 42, tokenUsage: { uncachedInputTokens: 2000, outputTokens: 200, totalTokens: 2400, cacheReadTokens: 100, cacheWriteTokens: 100 } } })
  }
  return { nodes, order }
}

/** epoch 模拟 ChatNodeStore.values()（引用变化 = 内容纪元变化）。 */
function makeStore(nodes) {
  let epoch = { e: 0 }
  return {
    store: { get: k => nodes.get(k), values: () => epoch },
    bump() { epoch = { e: epoch.e + 1 } },
  }
}

function benchFrame(turns, stepsPerTurn) {
  const { nodes, order } = buildWorld(turns, stepsPerTurn)
  const { store, bump } = makeStore(nodes)
  const timings = new Map()
  for (let t = 1; t <= turns; t++) timings.set(t, { startTime: t * 1e6, endTime: t * 1e6 + 5e5 })
  const sessionId = 'bench-sess'
  // 可见 step 键：每回合最后一个 step（S = turns 个），模拟视口内可见步
  const visible = []
  for (let t = 1; t <= turns; t++) visible.push('step' + t + '_' + stepsPerTurn)

  // 预热（JIT + 建立缓存）
  for (let w = 0; w < 3; w++) {
    bump()
    for (const key of visible) cachedSegOrdinal(key, order, store)
    for (let t = 1; t <= turns; t++) cachedTurnMetrics(sessionId, t, 0, order, store, timings, visible[t - 1])
  }

  const FRAMES = 30
  const t0 = now()
  for (let f = 0; f < FRAMES; f++) {
    bump() // 结构变化批次 → order/valuesEpoch 全部失效（真实结构事件帧的缓存画像）
    for (const key of visible) cachedSegOrdinal(key, order, store)
    for (let t = 1; t <= turns; t++) cachedTurnMetrics(sessionId, t, 0, order, store, timings, visible[t - 1])
  }
  const ms = (now() - t0) / FRAMES
  return ms
}

const CASES = [
  { turns: 60, steps: 1 },
  { turns: 240, steps: 1 },
  { turns: 480, steps: 1 },
  { turns: 960, steps: 1 },
]
const out = []
for (const c of CASES) {
  // 每档跑 3 次取中位
  const runs = []
  for (let i = 0; i < 3; i++) runs.push(benchFrame(c.turns, c.steps))
  runs.sort((a, b) => a - b)
  out.push({ ...c, visibleSteps: c.turns, msPerFrame: +runs[1].toFixed(3) })
}
if (process.argv.includes('--json')) console.log(JSON.stringify(out))
else {
  console.log('[metrics-bench] 每帧 = S 个可见 step 的 segOrdinal + 全回合 metrics 派生（结构批次失效后）')
  for (const r of out) console.log('  N=' + String(r.turns * (r.steps + 4)).padStart(5), ' S=' + String(r.visibleSteps).padStart(4), ' ', r.msPerFrame, 'ms/帧')
}
