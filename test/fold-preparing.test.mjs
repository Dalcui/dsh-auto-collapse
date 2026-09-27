/**
 * fold-preparing.test.mjs —— data-state="preparing" 的运行态判定回归。
 *
 * 背景（0.1.7 适配期间源码实证）：DSH 的 toolview 会把工具调用的**准备阶段**
 * 渲染成 data-state="preparing"：
 *   dsh-client-ui-tool ToolRow:
 *     const state = !done ? (block.phase === "preparing" ? "preparing" : "running")
 *                         : (block.error?.code === "interrupted" ? "stopped"
 *                            : block.isError ? "error" : "ok");
 *     const running = state === "running" || state === "preparing";
 * 官方自己就把 preparing 当运行中。插件原先只认 'running'，会把 preparing 的
 * 工具行误判成已完成（chip 退出 running 态、标题退成「已思考」等）。
 *
 * 场景形状沿用 fold-single「需求6 回合2」：一条已完成思考（保证存在被折叠行，
 * chip 才会出现）+ 一条运行中的工具行。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

function boot() {
  const env = installDomGlobals()
  const { document } = env
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) { moduleExports = spec.factory(() => { throw new Error('require unsupported in stub') }) },
  }
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  let cleanup = null
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration', statusText: 'Deep sleeping...', keepLastRows: 1 }, base: {}, user: {}, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
  moduleExports.apply({ effect: (fn) => { cleanup = fn() }, settingsScope: { bind: () => scopeMock } })
  const flow = el('div', { 'data-chat-flow': '' })
  flow.offsetParent = {}
  flow.setRect({ width: 800, height: 600 })
  function register() {
    const seen = new Set(document._all)
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 1) { if (!seen.has(c)) { seen.add(c); document._all.push(c) } walk(c) }
      }
    }
    walk(document.body)
  }
  return { env, document, flow, register, cleanup: () => { cleanup?.(); env.clearTimers() } }
}

function seat(flow, kind, key, h) {
  const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow)
  s.setRect({ height: h })
  return s
}

/** 一条已完成思考（被折叠）+ 一条指定状态的工具 → 返回 chip。 */
async function chipFor(env, document, flow, register, toolState) {
  const user = seat(flow, 'user', 'u1', 40); textNode('想并做', user)
  const th = seat(flow, 'assistant-step', 'a0', 30); makeThinkRow({ state: 'ok', summary: '已完成第一步', parent: th })
  const t = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: toolState, summary: '读', parent: t })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  return [...flow.querySelectorAll('.dshcf-chip')]
}

{
  console.log('\n=== P1：工具 data-state="preparing" → chip 视为运行中（官方口径） ===')
  const { env, document, flow, register, cleanup } = boot()
  const chips = await chipFor(env, document, flow, register, 'preparing')
  assert(chips.length >= 1, '存在 chip', 'chips=' + chips.length)
  const text = chips.map(c => (c.textContent || '').trim()).join(' | ')
  assert(text.includes('正在运行'), 'preparing 工具让 chip 标题为「正在运行」', 'chip=' + JSON.stringify(text))
  assert(!text.includes('正在思考'), 'preparing 不被误判为「正在思考」', 'chip=' + JSON.stringify(text))
  cleanup()
}

{
  console.log('\n=== P2：工具 data-state="running" 仍照旧（不回归） ===')
  const { env, document, flow, register, cleanup } = boot()
  const chips = await chipFor(env, document, flow, register, 'running')
  const text = chips.map(c => (c.textContent || '').trim()).join(' | ')
  assert(text.includes('正在运行'), 'running 工具让 chip 标题为「正在运行」', 'chip=' + JSON.stringify(text))
  cleanup()
}

{
  console.log('\n=== P3：对照——工具 data-state="ok" 时不得判为运行中 ===')
  const { env, document, flow, register, cleanup } = boot()
  const chips = await chipFor(env, document, flow, register, 'ok')
  const text = chips.map(c => (c.textContent || '').trim()).join(' | ')
  assert(!text.includes('正在运行'), 'ok 工具不进入运行中态', 'chip=' + JSON.stringify(text))
  cleanup()
}

if (failures > 0) {
  console.error('\nfold-preparing: failures=' + failures)
  process.exit(1)
}
console.log('\nfold-preparing: failures=0')
