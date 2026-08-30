/**
 * fold-single.test.mjs — 需求4 回归测试。
 * 覆盖：单条非模型输出内容（单工具/单思考/单上下文）不折叠为二级 chip、留原生；
 * 相邻 ≥2 条仍折叠合成 chip（foldable 不回归）。
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
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, body))
}

{
  console.log('\n=== 需求4-A：单条工具调用不生成二级 chip（原生展示）===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('读文件', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '单条工具回合仍生成一级已处理行（一级保留）')
  assert(t1.style.display === 'none', '完成态单条工具随工作流折叠', 't1=' + t1.style.display)
  row.dispatchEvent('click')
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-chip') === null, '单条工具展开一级后不生成二级 chip')
  assert(t1.style.display === '', '单条工具原生展示（seat 恢复）', 't1=' + t1.style.display)
  const toolRow = t1.querySelector('[data-chat-call-id]')
  assert(toolRow !== null && toolRow.style.display === '', '工具行原生可见', 'row=' + (toolRow && toolRow.style.display))
  cleanup()
}

{
  console.log('\n=== 需求4-B：单段思考（纯 think 消息）不生成二级 chip ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('想想', user)
  const think = seat(flow, 'assistant-step', 'a1', 30); makeThinkRow({ state: 'ok', summary: '想一下', parent: think })
  const fin = seat(flow, 'assistant-step', 'a2', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '单段思考回合仍生成一级行')
  row.dispatchEvent('click')
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-chip') === null, '单段思考不生成二级 chip')
  cleanup()
}

{
  console.log('\n=== 需求4-C：两条相邻工具仍折叠合成一个 chip（foldable 不回归）===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑两个命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'bash', summary: 'a', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  row.dispatchEvent('click')
  await env.tick(); await env.tick()
  const chips = flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, '两条相邻工具合成一个 chip', 'chips=' + chips.length)
  const summary = chips[0]?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(summary.includes('Bash ×1') && summary.includes('Read ×1'), '计数含两条工具（Bash ×1 · Read ×1）', 'summary=' + summary)
  cleanup()
}

{
  console.log('\n=== 需求4-D：思考 + 相邻工具 = 2 条，仍折叠 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('想并做', user)
  const think = seat(flow, 'assistant-step', 'a1', 30); makeThinkRow({ state: 'ok', summary: '先想', parent: think })
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a2', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  row.dispatchEvent('click')
  await env.tick(); await env.tick()
  const chips = flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, '思考+工具相邻合成一个 chip', 'chips=' + chips.length)
  cleanup()
}

{
  console.log('\n=== 需求6：思考/工具分类不互串（标题与内容归属） ===')
  const { env, document, flow, register, cleanup } = boot()
  // 回合1：纯思考（两段，完成态 ok）→ chip 应为「已思考」，不误判为工具
  const u1 = seat(flow, 'user', 'u1', 40); textNode('想想', u1)
  const th = seat(flow, 'assistant-step', 'a1', 30); makeThinkRow({ state: 'ok', summary: '第一段', parent: th }); makeThinkRow({ state: 'ok', summary: '第二段', parent: th })
  const fin1 = seat(flow, 'assistant-step', 'f1', 100); addBodyText(fin1, '回合1正文')
  const tail1 = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail1)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  let chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null && chip.textContent.includes('已思考'), '纯思考块标题为已思考', 'chip=' + (chip?.textContent ?? 'null'))
  assert(chip !== null && !chip.textContent.includes('运行了命令'), '纯思考块不误判为运行了命令', 'chip=' + (chip?.textContent ?? 'null'))

  // 回合2：思考(running)+工具(running) 相邻 → 标题应为「正在运行」（工具优先），非「正在思考」
  const u2 = seat(flow, 'user', 'u2', 40); textNode('想并做', u2)
  const th2 = seat(flow, 'assistant-step', 'a2', 30); makeThinkRow({ state: 'running', summary: '思考中', followEnd: true, parent: th2 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', state: 'running', summary: '读', parent: t2 })
  register()
  await env.tick()
  const runningChips = flow.querySelectorAll('.dshcf-chip')
  const runningChip = [...runningChips].find(c => c.textContent.includes('正在运行') || c.textContent.includes('正在思考'))
  assert(runningChip !== undefined && runningChip.textContent.includes('正在运行'), '思考+工具 running 时标题为正在运行（工具优先）', 'chip=' + (runningChip?.textContent ?? 'null'))
  assert(runningChip !== undefined && !runningChip.textContent.includes('正在思考'), 'running 时不被误判为正在思考', 'chip=' + (runningChip?.textContent ?? 'null'))
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
