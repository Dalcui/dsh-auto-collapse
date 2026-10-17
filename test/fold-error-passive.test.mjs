/**
 * fold-error-passive.test.mjs — 「本轮运行失败」之后折叠不再失效的回归测试。
 *
 * 背景（用户报告 ①）：出现「本轮运行失败」后所有折叠都会失效。
 *
 * 实测结论（DSH 0.2.0-rc.2）：
 *  - error / aborted 回合的原生 turn-process 行是 aria-expanded="true" + disabled
 *    （CHAT turnProcessAlwaysOpen：status open | reason aborted | reason error ⇒
 *    open=true 且 canCollapse=false）；
 *  - 插件对该回合「完全让路」（fold.ts §5.10 nativePassiveTurns/Segments）是
 *    **有意设计**，且判定按 turn 号**逐段**匹配，只让该回合 passive；
 *  - 因此 error 回合**不会**级联成「整条流折叠失效」。真正让用户看到「全都失效」
 *    的是另一条链路：shadow inject 面为空 → 委托渲染抛 usePresentation →
 *    renderer 的 SlotErrorBoundary 把整条 conversation.chat.node 条目退市
 *    （已在 src/turn-metrics.ts 修复，见 shadow-inject.test.mjs）。
 *
 * 本用例把「error 回合只让路自己不牵连其它回合」这条契约钉死，防止将来有人
 * 为了让 error 回合可折叠而改动 passive 语义（会连带破坏 verbose 的「插件不介入」）。
 *
 * 用法：node test/fold-error-passive.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode } from './fake-dom.mjs'

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
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration,toolCalls', keepLastRows: 3 }, base: {}, user: {}, writable: true }),
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
function addBodyText(node, value) {
  const r = el('div', { class: 'assistant-markdown-root' }, node)
  const b = el('div', { class: 'assistant-markdown-body' }, r)
  const md = el('div', { class: 'markdown' }, b)
  textNode(value, md)
}
function makeGroup(parent, turn, activity, open) {
  const group = el('div', {
    'data-step-process': 'true',
    'data-chat-group-key': 'g' + String(turn) + ':' + activity,
    'data-chat-turn': String(turn),
    class: 'O_Ebla_root',
  }, parent)
  const header = el('div', {}, group)
  const btn = el('button', { 'data-process-activity': activity, 'aria-expanded': String(open) }, header)
  const body = el('div', { 'data-step-process-body': 'true' }, group)
  if (!open) body.setAttribute('hidden', 'until-found')
  el('div', { 'data-step-process-content': 'true', 'data-chat-flow': '' }, body)
  return { group, btn, body }
}

/** 健康回合：官方组 ×3 + 最终正文 + tail + 原生行（收起态）。 */
function healthyTurn(flow, turn) {
  const u = seat(flow, 'user', `u${turn}`, 40); textNode('问题' + turn, u)
  const g1 = makeGroup(flow, turn, 'code', false)
  const g2 = makeGroup(flow, turn, 'read', false)
  const g3 = makeGroup(flow, turn, 'search', false)
  const a = seat(flow, 'assistant-step', `a${turn}`, 60); addBodyText(a, '正文' + turn)
  const tail = seat(flow, 'turn-tail', `tt${turn}`, 24); textNode('用时 5秒', tail)
  const tp = seat(flow, 'turn-process', `tp${turn}`, 33)
  el('button', { 'data-turn-process': String(turn), 'aria-expanded': 'false' }, tp)
  return { g1, g2, g3, a }
}
/** 失败回合（真机形态）：turn-error 座位 + 原生行 aria-expanded=true + disabled。 */
function failedTurn(flow, turn, kind) {
  const u = seat(flow, 'user', `u${turn}`, 40); textNode('问题' + turn, u)
  const err = seat(flow, kind, `e${turn}`, 24)
  textNode(kind === 'turn-error' ? '本轮运行失败 429' : '已停止', err)
  const tail = seat(flow, 'turn-tail', `tt${turn}`, 24); textNode('用时 2秒', tail)
  const tp = seat(flow, 'turn-process', `tp${turn}`, 33)
  el('button', { 'data-turn-process': String(turn), 'aria-expanded': 'true', disabled: '' }, tp)
}
function stateOf(document) {
  const style = document.getElementById('dshcf-style')
  return { state: style?.getAttribute('data-dshcf-state'), err: style?.getAttribute('data-dshcf-error') }
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 1: 失败回合在中间，前后健康回合仍折叠（无级联） ===')
  const { env, document, flow, register, cleanup } = boot()
  const t1 = healthyTurn(flow, 1)
  failedTurn(flow, 2, 'turn-error')
  const t3 = healthyTurn(flow, 3)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick(); await env.tick()

  const st = stateOf(document)
  assert(st.state === 'active' && st.err === null, '折叠协调器未进入 error 态（pass 未抛错）', JSON.stringify(st))
  // 健康回合的覆盖集被驱动为收起 = 折叠生效。
  const t1Collapsed = [t1.g1, t1.g2].filter(g => g.btn.getAttribute('aria-expanded') === 'false').length
  const t3Collapsed = [t3.g1, t3.g2].filter(g => g.btn.getAttribute('aria-expanded') === 'false').length
  assert(t1Collapsed === 2, '失败回合**之前**的回合折叠照常', String(t1Collapsed))
  assert(t3Collapsed === 2, '失败回合**之后**的回合折叠照常（关键：无级联）', String(t3Collapsed))
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 2: 整条流全是失败回合也不崩（最坏形态） ===')
  const { env, document, flow, register, cleanup } = boot()
  failedTurn(flow, 1, 'turn-error')
  failedTurn(flow, 2, 'aborted')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick(); await env.tick()
  const st = stateOf(document)
  assert(st.state === 'active' && st.err === null, '全被动流不触发 pass 异常', JSON.stringify(st))
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 3: 失败回合不建 chip，但不回收其它回合的 chip ===')
  const { env, document, flow, register, cleanup } = boot()
  const t1 = healthyTurn(flow, 1)
  failedTurn(flow, 2, 'turn-error')
  const t3 = healthyTurn(flow, 3)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick(); await env.tick()
  const perSeat = [...flow.children].map((s, i) => i + ':' + s.querySelectorAll('.dshcf-seg-chip').length + ':' + s.querySelectorAll('.dshcf-chip').length).join(' ')
  const total = flow.querySelectorAll('.dshcf-seg-chip').length + flow.querySelectorAll('.dshcf-chip').length
  assert(total >= 2, '至少健康回合产出了 chip（未被失败回合清理）', 'perSeat=' + perSeat + ' total=' + String(total))
  // 失败回合（第 2 个座位组）自身不产 chip
  const errSeatHasChip = flow.querySelector('[data-chat-anchor-key="e2"]')?.querySelectorAll('.dshcf-chip,.dshcf-seg-chip').length ?? 0
  assert(errSeatHasChip === 0, '失败回合自身让路、不产 chip', String(errSeatHasChip))
  cleanup()
}

console.log('\n[DONE] failures=' + failures)
process.exit(failures === 0 ? 0 : 1)
