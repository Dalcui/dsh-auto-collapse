/**
 * fold-bench — fold pass 每帧耗时基准（fake-dom + lib/client.js 构建产物）。
 * 不进 test glob（*.test.mjs 才被执行）。用法：node bench/fold-bench.mjs [--json]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow } from '../test/fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

function boot() {
  const env = installDomGlobals()
  const { document } = env
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) { moduleExports = spec.factory(() => { throw new Error('no require') }) },
  }
  // eslint-disable-next-line no-eval
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  let cleanup = null
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration,toolCalls', statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
  moduleExports.apply({ effect: (fn) => { cleanup = fn() }, settingsScope: { bind: () => scopeMock } })
  const flow = el('div', { 'data-chat-flow': '' })
  flow.offsetParent = {}
  flow.setRect({ width: 800, height: 600 })
  document.body.appendChild(flow)
  function register() {
    const seen = new Set(document._all)
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 1) { if (!seen.has(c)) { seen.add(c); document._all.push(c) } walk(c) }
      }
    }
    walk(document.body)
  }
  env.flow = flow
  env.register = register
  env.cleanupAll = () => { cleanup?.(); env.clearTimers() }
  return env
}

function seat(flow, kind, key, h) {
  const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow)
  s.setRect({ height: h })
  return s
}
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  return textNode(text, el('div', { class: 'markdown' }, body))
}

/** 构造 T 个回合的会话：每回合 user → tool×2 → think → 正文 → turn-tail。 */
function buildWorld(flow, turns) {
  const bodyTexts = []
  for (let t = 1; t <= turns; t++) {
    const u = seat(flow, 'user', 'u' + t, 40); textNode('回合' + t, u)
    for (let k = 1; k <= 2; k++) {
      const s = seat(flow, 'tool-call', 't' + t + '_' + k, 30)
      makeToolRow({ callId: 'call:' + t + '_' + k, tool: k === 1 ? 'bash' : 'read', state: 'ok', summary: 'cmd ' + t + '-' + k, parent: s })
    }
    const th = seat(flow, 'assistant-step', 'th' + t, 30)
    makeThinkRow({ state: 'ok', summary: 'thinking ' + t, parent: th })
    const fin = seat(flow, 'assistant-step', 'a' + t, 100)
    bodyTexts.push(addBodyText(fin, '最终正文 ' + t))
    const tail = seat(flow, 'turn-tail', 'tt' + t, 24); textNode('用时 5秒 · 42 tok/s', tail)
  }
  return bodyTexts
}

function now() { return performance.now() }

/** 预热 + 稳态流式帧：characterData-only 批次（live 正文流式），K 帧。 */
function benchSteadyLive(env, bodyTexts, frames) {
  const { document } = env
  // 预热 30 轮：耗尽每段 20 次的指标重试（无 token 源时前 20 pass 会全文档扫描，
  // 混进测量窗口会稀释稳态信号）；之后才是干净的稳态测量。
  for (let i = 0; i < 30; i++) { env.notifyMutations([{ type: 'characterData', target: bodyTexts[0] }]); env.flushRaf() }
  const targets = bodyTexts
  const t0 = now()
  for (let i = 0; i < frames; i++) {
    const tn = targets[i % targets.length]
    tn.data = tn.data + '.' // 文本变化 → characterData
    env.notifyMutations([{ type: 'characterData', target: tn }])
    env.flushRaf()
  }
  const t1 = now()
  return (t1 - t0) / frames
}

/** 结构批次帧：每帧 append 新 seat（childList），K 帧。 */
function benchStructural(env, flow, frames) {
  const { document } = env
  let n = 0
  const t0 = now()
  for (let i = 0; i < frames; i++) {
    n++
    const s = seat(flow, 'tool-call', 'x' + n, 30)
    makeToolRow({ callId: 'call:x' + n, tool: 'bash', state: 'ok', summary: 'x ' + n, parent: s })
    document._all.push(s)
    env.notifyMutations([{ type: 'childList', target: flow }])
    env.flushRaf()
  }
  const t1 = now()
  return (t1 - t0) / frames
}

const TURNS = Number(process.env.BENCH_TURNS ?? 40)
const env0 = boot()
const bodyTexts = buildWorld(env0.flow, TURNS)
env0.register()
const liveMs = benchSteadyLive(env0, bodyTexts, 150)
const structMs = benchStructural(env0, env0.flow, 60)
env0.cleanupAll()

const result = { turns: TURNS, steadyLiveMsPerFrame: +liveMs.toFixed(3), structuralMsPerFrame: +structMs.toFixed(3) }
if (process.argv.includes('--json')) console.log(JSON.stringify(result))
else {
  console.log('[fold-bench] 回合数 =', TURNS)
  console.log('  稳态流式帧（characterData-only）:', result.steadyLiveMsPerFrame, 'ms/帧')
  console.log('  结构批次帧（childList）      :', result.structuralMsPerFrame, 'ms/帧')
}
/** --profile：统计稳态帧内 querySelectorAll 调用次数与累计耗时。 */
function profileFrame(TURNS) {
  const env = boot()
  const bodyTexts = buildWorld(env.flow, TURNS)
  env.register()
  const HE = globalThis.HTMLElement
  const doc = env.document
  const stats = { count: 0, ns: 0 }
  const bySel = new Map()
  const wrap = (orig) => function (sel) {
    const t0 = now()
    try { return orig.call(this, sel) } finally {
      stats.count++; const dt = now() - t0; stats.ns += dt
      const b = bySel.get(sel) ?? { count: 0, ns: 0 }
      b.count++; b.ns += dt; bySel.set(sel, b)
    }
  }
  const origEl = HE.prototype.querySelectorAll
  const origDoc = doc.querySelectorAll.bind(doc)
  HE.prototype.querySelectorAll = wrap(origEl)
  doc.querySelectorAll = wrap(origDoc)
  const closestStats = { count: 0, ns: 0 }
  const origClosest = HE.prototype.closest
  HE.prototype.closest = function (sel) {
    const t0 = now()
    try { return origClosest.call(this, sel) } finally { closestStats.count++; closestStats.ns += now() - t0 }
  }
  // 预热 30 帧
  for (let i = 0; i < 30; i++) { env.notifyMutations([{ type: 'characterData', target: bodyTexts[0] }]); env.flushRaf() }
  const FRAMES = 30
  const frameNs = []
  stats.count = 0; stats.ns = 0; closestStats.count = 0; closestStats.ns = 0
  bySel.clear() // 预热期（每段 20 次指标重试的文本兜底扫描）不计入稳态分桶
  const total0 = now()
  for (let i = 0; i < FRAMES; i++) {
    const tn = bodyTexts[i % bodyTexts.length]
    tn.data = tn.data + '.'
    const f0 = now()
    env.notifyMutations([{ type: 'characterData', target: tn }])
    env.flushRaf()
    frameNs.push(now() - f0)
  }
  const totalMs = now() - total0
  HE.prototype.querySelectorAll = origEl
  HE.prototype.closest = origClosest
  delete doc.querySelectorAll
  env.cleanupAll()
  const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]
  const top = [...bySel.entries()].map(([sel, b]) => ({ sel, perFrame: +(b.count / FRAMES).toFixed(1), msPerFrame: +(b.ns / FRAMES).toFixed(2) }))
    .sort((a, b) => b.msPerFrame - a.msPerFrame).slice(0, 8)
  return {
    topSelectors: top,
    turns: TURNS,
    frameMedianMs: +med(frameNs).toFixed(3),
    frameTotalMs: +totalMs.toFixed(1),
    qsaPerFrame: +(stats.count / FRAMES).toFixed(1),
    qsaMsPerFrame: +(stats.ns / FRAMES).toFixed(3),
    closestPerFrame: +(closestStats.count / FRAMES).toFixed(1),
    closestMsPerFrame: +(closestStats.ns / FRAMES).toFixed(3),
  }
}
if (process.argv.includes('--profile')) {
  for (const t of [20, 60, 120]) console.log(JSON.stringify(profileFrame(t)))
} else if (!process.argv.includes('--json') && !process.argv.some(a => !a.startsWith('--') && !a.startsWith('bench/'))) {
  // 默认行为保持
}