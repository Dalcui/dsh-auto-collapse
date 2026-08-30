/**
 * fold-live.test.mjs — 回合进行中实时摘要行 + 二级 chip 分层粒度计数回归测试。
 * 对齐 dsh-turn-fold：
 *   1) open（未闭合）回合显示实时摘要行（.dshcf-processing，含"已工作"耗时），
 *      闭合后由 .dshcf-processed 一级行接管；
 *   2) 完成态"运行了命令"chip 展示思考/工具调用次数，失败数（浅红，独立 span）。
 *
 * 用法：node test/fold-live.test.mjs
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
  const scopeMock = { getSnapshot: () => ({ status: 'ready', value: { keepLastRows: 1, statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }), subscribe: () => () => {}, set: async () => {}, unset: async () => {} }
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
function addThink(seatEl, summary, state = 'ok') {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  makeThinkRow({ state, summary, parent: body })
}
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, body))
}

{
  console.log('\n=== 场景: open 回合显示实时摘要行，闭合后由已处理行接管 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'running')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', state: 'running', summary: 'Get-Content a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addThink(fin, '最终思考'); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const live = flow.querySelector('.dshcf-processing')
  assert(live !== null, 'open 回合生成实时摘要行')
  assert(live !== null && live.textContent.includes('已工作'), '实时摘要行显示"已工作"耗时', 'text=' + (live?.textContent ?? ''))
  assert(live !== null && live.getAttribute('role') === 'status', '实时摘要行 role=status')
  assert(flow.querySelector('.dshcf-processed') === null, 'open 回合不生成已处理一级行')
  assert(live !== null && live.nextElementSibling === s1, '实时摘要行位于首个工作元素上方')
  // 工具转完成 + 闭合
  t1.querySelector('[data-tool]').setAttribute('data-state', 'ok')
  s1.querySelector('[data-variant="think"]').setAttribute('data-state', 'ok')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') === null, '闭合后实时摘要行移除')
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '闭合后生成已处理一级行')
  cleanup()
}

{
  console.log('\n=== 场景: 完成态"运行了命令"chip 展示思考/工具调用/失败计数 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('改文件', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'pwsh', state: 'error', summary: 'cmd', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '一级展开后生成二级 chip')
  assert(chip !== null && chip.textContent.includes('运行了命令'), 'chip 标题为运行了命令', 'text=' + (chip?.textContent ?? ''))
  assert(chip !== null && chip.textContent.includes('1 段思考'), 'chip 显示思考段数', 'text=' + (chip?.textContent ?? ''))
  assert(chip !== null && chip.textContent.includes('Read ×1') && chip.textContent.includes('Pwsh ×1'), 'chip 按工具名×次数显示调用（Read ×1 · Pwsh ×1）', 'text=' + (chip?.textContent ?? ''))
  const failure = chip?.querySelector('.dshcf-chip-failure')
  assert(failure !== null && failure !== undefined && failure.textContent === '1 个失败', '失败计数独立 span', 'failure=' + (failure?.textContent ?? 'null'))
  assert(failure !== null && failure !== undefined && failure.style.display === '', '失败计数可见', 'display=' + (failure?.style.display ?? 'null'))
  // 展开二级后摘要消失（三级原生行接管展示）
  chip.dispatchEvent('click')
  await env.tick()
  const summaryAfterExpand = chip.querySelector('.dshcf-chip-summary').textContent
  assert(summaryAfterExpand === '', '二级展开后计数摘要清空', 'summary=' + summaryAfterExpand)
  cleanup()
}

{
  console.log('\n=== 场景: 运行中 chip 不显示失败计数（P2-1） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'running')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', state: 'running', summary: 'Get-Content a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', state: 'error', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '运行中生成二级 chip')
  assert(chip !== null && chip.textContent.includes('正在运行'), 'chip 标题为正在运行', 'text=' + (chip?.textContent ?? ''))
  const failure = chip?.querySelector('.dshcf-chip-failure')
  assert(failure !== null && failure !== undefined && failure.style.display === 'none', '运行中不显示失败计数', 'display=' + (failure?.style.display ?? 'null'))
  cleanup()
}

{
  console.log('\n=== 场景: 完成态无失败时失败计数 span 隐藏（P2-6） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('改文件', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '一级展开后生成二级 chip')
  assert(chip !== null && chip.textContent.includes('运行了命令'), 'chip 标题为运行了命令', 'text=' + (chip?.textContent ?? ''))
  const failure = chip?.querySelector('.dshcf-chip-failure')
  assert(failure !== null && failure !== undefined && failure.style.display === 'none', '无失败时失败计数 span 隐藏', 'display=' + (failure?.style.display ?? 'null'))
  cleanup()
}


{
  console.log('\n=== 场景: 运行中 chip 收起、running 行在 chip 外可见、已完成行折叠（issue #3） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  // 已完成 think + running tool（同一块）
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'ok')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', state: 'running', summary: 'Get-Content a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '运行中生成二级 chip')
  assert(chip !== null && chip.getAttribute('aria-expanded') === 'false', 'chip 保持收起（不再强制展开）', 'aria=' + chip?.getAttribute('aria-expanded'))
  // running 工具行在 chip 外可见
  const toolRow = t1.querySelector('[data-chat-call-id]')
  assert(toolRow.style.display === '', 'running 工具行在 chip 外可见', 'row=' + toolRow.style.display)
  // 已完成 think 行折叠进 chip
  const thinkRow = s1.querySelector('[data-variant="think"]')
  assert(thinkRow.style.display === 'none', '已完成 think 行折叠进 chip', 'think=' + thinkRow.style.display)
  // 多次 tick 后不反复折叠/展开（chip 仍收起）
  await env.tick(); await env.tick(); await env.tick()
  assert(chip.getAttribute('aria-expanded') === 'false', '多次 tick 后 chip 仍收起（不反复折叠/展开）', 'aria=' + chip.getAttribute('aria-expanded'))
  assert(toolRow.style.display === '', '多次 tick 后 running 行仍可见', 'row=' + toolRow.style.display)
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1