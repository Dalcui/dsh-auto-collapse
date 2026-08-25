/**
 * fold-retry.test.mjs — DSH 原生回合级状态装饰行折叠回归测试。
 * 覆盖 model-retry（"已重试模型请求…"）、turn-error（终态失败）、
 * turn-max-tokens（达到输出上限）三种行：折叠时随段一级隐藏（修复前残留
 * 可见），且不打断工具组合并；工作中保持可见、一级展开后恢复显示。
 *
 * 用法：node test/fold-retry.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow, makeRetryRow, makeTurnErrorRow, makeMaxTokensRow } from './fake-dom.mjs'

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
  moduleExports.apply({ effect: (fn) => { cleanup = fn() } })
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
function addThink(seatEl, summary) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  makeThinkRow({ state: 'ok', summary, parent: body })
}
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, body))
}

{
  console.log('\n=== 场景: model-retry 重试状态行随段折叠（已重试模型请求） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('读文件', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'Get-Content a.txt', parent: t1 })
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/3）', parent: r1 })
  const s2 = seat(flow, 'assistant-step', 's2', 26); addThink(s2, '再思考')
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addThink(fin, '最终思考'); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processed') === null, '未闭合回合不生成一级行')
  assert(r1.style.display === '', '工作中 model-retry 状态行可见', 'r1=' + r1.style.display)
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '闭合后生成一级行')
  assert(r1.style.display === 'none', '折叠后 model-retry 行随段隐藏（修复前残留已重试模型请求）', 'r1=' + r1.style.display)
  assert(s1.style.display === 'none' && t1.style.display === 'none' && s2.style.display === 'none' && t2.style.display === 'none', '工作行折叠', 's1=' + s1.style.display + ' t1=' + t1.style.display + ' s2=' + s2.style.display + ' t2=' + t2.style.display)
  assert(fin.style.display === '', '最终输出显示', 'fin=' + fin.style.display)
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chips = flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, 'model-retry 未断开工具组合并（一级行展开后恰一个 chip）', 'chips=' + chips.length)
  assert(r1.style.display === 'none', '一级展开后 model-retry 行收入二级"运行了命令"（不再独立拆分）', 'r1=' + r1.style.display)
  flow.querySelector('.dshcf-chip').dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === '', '二级"运行了命令"展开后 model-retry 行恢复显示', 'r1=' + r1.style.display)
  flow.querySelector('.dshcf-chip').dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === 'none', '二级"运行了命令"再次收起后 model-retry 行再次隐藏', 'r1=' + r1.style.display)
  cleanup()
}

{
  console.log('\n=== 场景: 块前 model-retry 状态行——指标行锚在其上方（issue #1） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('重试读文件', user)
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/2）', parent: r1 })
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(r1.style.display === '', '工作中块前 model-retry 行可见', 'r1=' + r1.style.display)
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '闭合后生成一级行')
  assert(r1.style.display === 'none', '折叠后块前 model-retry 行随段隐藏', 'r1=' + r1.style.display)
  assert(row.nextElementSibling === r1, '指标行位于块前 model-retry 行上方', 'next=' + (row.nextElementSibling?.getAttribute('data-chat-anchor-key') ?? 'null'))
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === '', '一级展开后块前 model-retry 行恢复显示', 'r1=' + r1.style.display)
  cleanup()
}

{
  console.log('\n=== 场景: turn-error 终态失败行随段折叠（出错了） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd', parent: t1 })
  const e1 = seat(flow, 'turn-error', 'e1', 24); makeTurnErrorRow({ message: '上游 500', parent: e1 })
  const s2 = seat(flow, 'assistant-step', 's2', 26); addThink(s2, '再思考')
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addThink(fin, '最终思考'); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processed') === null, '未闭合回合不生成一级行')
  assert(e1.style.display === '', '工作中 turn-error 行可见', 'e1=' + e1.style.display)
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '闭合后生成一级行')
  assert(e1.style.display === 'none', '折叠后 turn-error 行随段隐藏（修复前残留出错了行）', 'e1=' + e1.style.display)
  assert(t1.style.display === 'none' && t2.style.display === 'none', '工作行折叠', 't1=' + t1.style.display + ' t2=' + t2.style.display)
  assert(fin.style.display === '', '最终输出显示', 'fin=' + fin.style.display)
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chips = flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, 'turn-error 未断开工具组合并（恰一个 chip）', 'chips=' + chips.length)
  assert(e1.style.display === 'none', '一级展开后 turn-error 行收入二级"运行了命令"（不再独立拆分）', 'e1=' + e1.style.display)
  flow.querySelector('.dshcf-chip').dispatchEvent('click')
  await env.tick()
  assert(e1.style.display === '', '二级"运行了命令"展开后 turn-error 行恢复显示', 'e1=' + e1.style.display)
  cleanup()
}

{
  console.log('\n=== 场景: turn-max-tokens 达到上限行随段折叠 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('写长文', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文被截断')
  const m1 = seat(flow, 'turn-max-tokens', 'm1', 24); makeMaxTokensRow({ parent: m1 })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processed') === null, '未闭合回合不生成一级行')
  assert(m1.style.display === '', '工作中 turn-max-tokens 行可见', 'm1=' + m1.style.display)
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '闭合后生成一级行')
  assert(m1.style.display === 'none', '折叠后 turn-max-tokens 行随段隐藏', 'm1=' + m1.style.display)
  assert(fin.style.display === '', '最终输出显示', 'fin=' + fin.style.display)
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  assert(m1.style.display === '', '一级展开后 turn-max-tokens 行恢复显示', 'm1=' + m1.style.display)
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
