/**
 * fold-native-compact.test.mjs — DSH 0.1.2-alpha.3+ 原生「对话显示」compact 模式协同回归。
 *
 * 覆盖：
 *   1) 回合闭合且存在原生 disclosure 行（button[data-turn-process]）时：
 *      本插件不建「已处理」一级行、不做一级隐藏（过程行由原生 hidden 接管），
 *      指标摘要写进原生 disclosure 行；
 *   2) 无原生行的回合维持原有行为（processed 行 + 一级折叠）；
 *   3) 原生行展开/收起（React 重渲染清掉注入 span）后自愈重建；
 *   4) 无被折叠行时不显示折叠行（进行中 keepLastRows 全保留）。
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

function boot(keepLastRows = 3) {
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
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration', statusText: 'Deep sleeping...', keepLastRows }, base: {}, user: {}, writable: true }),
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
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 1) { if (!seen.has(c)) { seen.add(c); document._all.push(c) } walk(c) } } }
    walk(document.body)
  }
  return { env, document, flow, register, cleanup: () => { cleanup?.(); env.clearTimers() } }
}
function seat(flow, kind, key, h = 26) {
  const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow)
  s.setRect({ height: h })
  return s
}
/** 原生 turn-process disclosure 行（DSH compact 模式）：seat + button[data-turn-process]（label span + chevron）。 */
function nativeDisclosure(flow, turn, labelText = '2 次工具调用') {
  const tp = seat(flow, 'turn-process', 'tp' + turn, 24)
  const btn = el('button', { 'data-turn-process': String(turn), 'data-open': '' }, tp)
  el('span', { class: 'label', text: labelText }, btn)
  el('svg', { class: 'chevron' }, btn)
  return btn
}

{
  console.log('\n=== 场景 1: 闭合回合 + 原生 disclosure 行 → 不建一级行，指标挂原生行 ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: 'ok', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', state: 'ok', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  tail.setAttribute('data-turn-tail', '1')
  const btn = nativeDisclosure(flow, 1)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  // 原生 compact：不建本插件的一级「已处理」行
  assert(flow.querySelector('.dshcf-processed') === null, '原生 disclosure 行存在时不建「已处理」行')
  // 一级折叠不做：工具行保持原生可见（display 未被插件改写）
  const row1 = t1.querySelector('[data-chat-call-id]')
  const row2 = t2.querySelector('[data-chat-call-id]')
  assert(row1.style.display === '', '工具行 1 不被插件隐藏（原生接管）', 'd=' + row1.style.display)
  assert(row2.style.display === '', '工具行 2 不被插件隐藏（原生接管）', 'd=' + row2.style.display)
  // 指标摘要写进原生 disclosure 行
  const span = btn.querySelector('.dshcf-native-metrics')
  assert(span !== null, '原生行内出现指标 span')
  assert(span !== null && span.textContent.includes('5秒'), '指标摘要含官方时长', 'text=' + (span?.textContent ?? 'null'))
  // 原生行的 label 与 chevron 不受影响
  assert(btn.textContent.includes('2 次工具调用'), '原生 label 保留')
  cleanup()
}

{
  console.log('\n=== 场景 2: 无原生行回合维持原有行为（processed 行 + 一级折叠） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: 'ok', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', state: 'ok', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  tail.setAttribute('data-turn-tail', '1')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processed') !== null, '无原生行时照常生成「已处理」行')
  assert(flow.querySelector('.dshcf-processed').textContent.includes('5秒'), '「已处理」行含时长')
  assert(t1.style.display === 'none', '一级折叠隐藏工具宿主')
  cleanup()
}

{
  console.log('\n=== 场景 3: 原生行被 React 重渲染清掉指标 span 后自愈重建 ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: 'ok', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  tail.setAttribute('data-turn-tail', '1')
  const btn = nativeDisclosure(flow, 1, '1 次工具调用')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(btn.querySelector('.dshcf-native-metrics') !== null, '首次 pass 已注入指标 span')
  // 模拟原生展开/收起触发的 React 重渲染：清空按钮子节点再放回 label+chevron
  btn.textContent = ''
  el('span', { class: 'label', text: '1 次工具调用' }, btn)
  el('svg', { class: 'chevron' }, btn)
  register()
  await env.tick()
  const span = btn.querySelector('.dshcf-native-metrics')
  assert(span !== null, 'React 重渲染清掉后自愈重建指标 span')
  assert(span !== null && span.textContent.includes('5秒'), '重建的 span 含时长', 'text=' + (span?.textContent ?? 'null'))
  cleanup()
}

{
  console.log('\n=== 场景 4: 进行中无被折叠行不显示折叠行（含 running 工具） ===')
  const { env, document, flow, register, cleanup } = boot(3)
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: 'running', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-chip') === null, '仅一条被保留的系统行 → 无折叠行')
  assert(t1.querySelector('[data-chat-call-id]').style.display === '', 'running 行原生可见')
  cleanup()
}

function addBody(s, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, s)
  const b = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, b))
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
