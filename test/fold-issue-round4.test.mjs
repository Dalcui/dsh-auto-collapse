/**
 * fold-issue-round4.test.mjs — 第四轮问题修复回归测试。
 * 覆盖：
 *   1) 运行中轮次「最后一条提示」不折叠（不看 running 状态，保留最新完整显示）；
 *   2) 被中断末段（无 turn-tail、无后续 user/turn-tail 边界）也能提取指标（兜底轮次识别）。
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
function boot(summaryFields = 'duration,toolCalls,modelCalls,inputTokens') {
  const env = installDomGlobals()
  const { document } = env
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = { load(spec) { moduleExports = spec.factory(() => { throw new Error('require unsupported in stub') }) } }
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  let cleanup = null
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', value: { summaryFields, statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }),
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
function seat(flow, kind, key, h) { const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow); s.setRect({ height: h }); return s }
function addBodyText(seatEl, text) { const md = el('div', { class: 'assistant-markdown-root' }, seatEl); const b = el('div', { class: 'assistant-markdown-body' }, md); textNode(text, el('div', { class: 'markdown' }, b)) }
function addThink(s, summary, state = 'ok') { const md = el('div', { class: 'assistant-markdown-root' }, s); const b = el('div', { class: 'assistant-markdown-body' }, md); makeThinkRow({ state, summary, parent: b }) }

{
  console.log('\n=== 场景 A: 运行中轮次最后一条（ok 态）不折叠、保留最新完整显示 ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'ok')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  // 最终正文正在流式输出（无 turn-tail，段仍未闭合 = 运行中轮次）
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '运行中生成二级 chip')
  const thinkRow = s1.querySelector('[data-variant="think"]')
  const toolRow = t1.querySelector('[data-chat-call-id]')
  assert(thinkRow.style.display === 'none', '已完成的 think 行折叠进 chip', 'think=' + thinkRow.style.display)
  assert(toolRow.style.display === '', '最后一条工具行（ok 态）保留完整显示，不折叠', 'tool=' + toolRow.style.display)
  cleanup()
}

{
  console.log('\n=== 场景 B: 运行中轮次最后一条是 running 行仍保留（不回归 R3） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'ok')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: 'running', summary: 'a.txt', parent: t1 })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const toolRow = t1.querySelector('[data-chat-call-id]')
  assert(toolRow.style.display === '', 'running 行在 chip 外可见（R3 不回归）', 'tool=' + toolRow.style.display)
  cleanup()
}

{
  console.log('\n=== 场景 C: 被中断末段（无 turn-tail 边界）也提取指标 ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40); textNode('写一半停掉', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'ok')
  // 注入器产物：turn1 的 think step（模块级 Map 不可用时走 DOM 属性路径）
  el('div', { 'data-dshcf-turn-metrics': JSON.stringify({ durationMs: 12000, toolCalls: 1, modelCalls: 1, inputTokens: 3000, lastModelInputTokens: 3000 }), 'data-dshcf-turn': '1', 'data-dshcf-session': 'sess-x', 'data-dshcf-seg': '0' }, s1)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: 'stopped', summary: 'a.txt', parent: t1 })
  // 无后续 user / turn-tail：boundary=null 的末段
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '闭合后生成一级行')
  const label = row?.firstElementChild?.textContent ?? ''
  assert(label.includes('1次工具调用') && label.includes('1次模型调用') && label.includes('3.0K'), '中断末段也提取工具/模型/输入指标', 'label=' + label)
  assert(label.includes('12秒'), '中断末段提取记录级耗时', 'label=' + label)
  cleanup()
}

{
  console.log('\n=== 场景 D: 中断轮次 + 发起消息继续的两轮各自显示指标（不串扰） ===')
  const { env, document, flow, register, cleanup } = boot()
  // turn 1（被中断，stopped 行、无 turn-tail）
  seat(flow, 'user', 'u1', 40); textNode('第一步', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'ok')
  el('div', { 'data-dshcf-turn-metrics': JSON.stringify({ toolCalls: 1, modelCalls: 1, inputTokens: 3000, lastModelInputTokens: 3000 }), 'data-dshcf-turn': '1', 'data-dshcf-session': 'sess-x', 'data-dshcf-seg': '0' }, s1)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: 'stopped', summary: 'a.txt', parent: t1 })
  // turn 2（发起消息继续）
  seat(flow, 'user', 'u2', 40); textNode('继续', flow.lastChild)
  const s2 = seat(flow, 'assistant-step', 's2', 26); addThink(s2, '再思考', 'ok')
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a2', 100); addBodyText(fin, '最终正文')
  el('div', { 'data-dshcf-turn-metrics': JSON.stringify({ durationMs: 5000, toolCalls: 1, modelCalls: 2, inputTokens: 7000, lastModelInputTokens: 7000 }), 'data-dshcf-turn': '2', 'data-dshcf-session': 'sess-x', 'data-dshcf-seg': '0' }, fin)
  const tail = seat(flow, 'turn-tail', 'tt2', 24); const tailInner = el('div', { 'data-turn-tail': '2' }, tail); textNode('用时 5秒', tailInner)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick(); await env.tick()
  const rows = flow.querySelectorAll('.dshcf-processed')
  assert(rows.length === 2, '两轮各一行', 'rows=' + rows.length)
  if (rows.length === 2) {
    const labelA = rows[0]?.firstElementChild?.textContent ?? ''
    const labelB = rows[1]?.firstElementChild?.textContent ?? ''
    assert(labelA.includes('3.0K') && labelA.includes('已停止'), '中断轮显示自身输入指标 + 已停止', 'labelA=' + labelA)
    assert(labelB.includes('7.0K') && !labelB.includes('3.0K'), '继续轮显示自身输入指标（不串扰）', 'labelB=' + labelB)
  }
  cleanup()
}

{
  console.log('\n=== 场景 E: Shift+点击一级行展开该回合全部二级 ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40); textNode('读文件', flow.lastChild)
  // 块 A：两个工具
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'grep', summary: 'b', parent: t2 })
  // 中间正文断开 → 块 B
  const mid = seat(flow, 'assistant-step', 'mid', 60); addBodyText(mid, '中间正文')
  const t3 = seat(flow, 'tool-call', 't3', 30); makeToolRow({ callId: 'call:3', tool: 'read', summary: 'c.txt', parent: t3 })
  const t4 = seat(flow, 'tool-call', 't4', 30); makeToolRow({ callId: 'call:4', tool: 'bash', summary: 'Get-Content d', parent: t4 })
  const fin = seat(flow, 'assistant-step', 'fin', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '闭合后生成一级行')
  row.dispatchEvent('click', { shiftKey: true })
  await env.tick()
  const chips = flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 2, '该回合两个二级 chip', 'chips=' + chips.length)
  assert([...chips].every(c => c.getAttribute('aria-expanded') === 'true'), 'Shift+点击后全部二级展开', 'aria=' + [...chips].map(c => c.getAttribute('aria-expanded')).join(','))
  const rowA = t1.querySelector('[data-chat-call-id]')
  const rowD = t4.querySelector('[data-chat-call-id]')
  assert(rowA.style.display === '' && rowD.style.display === '', '展开后工具行全部可见', 'A=' + rowA.style.display + ' D=' + rowD.style.display)
  // 再次 Shift+点击：全部二级收起
  row.dispatchEvent('click', { shiftKey: true })
  await env.tick()
  assert([...chips].every(c => c.getAttribute('aria-expanded') === 'false'), '再次 Shift+点击后全部二级收起', 'aria=' + [...chips].map(c => c.getAttribute('aria-expanded')).join(','))
  cleanup()
}

{
  console.log('\n=== 场景 F: Ctrl/Cmd+Shift+E 全局展开/收起所有一级+二级 ===')
  const { env, document, flow, register, cleanup } = boot()
  // 回合 1
  seat(flow, 'user', 'u1', 40); textNode('读文件', flow.lastChild)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'grep', summary: 'b', parent: t2 })
  const fin1 = seat(flow, 'assistant-step', 'f1', 100); addBodyText(fin1, '最终正文1')
  const tail1 = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 3秒', tail1)
  // 回合 2
  seat(flow, 'user', 'u2', 40); textNode('继续', flow.lastChild)
  const t3 = seat(flow, 'tool-call', 't3', 30); makeToolRow({ callId: 'call:3', tool: 'read', summary: 'c.txt', parent: t3 })
  const t4 = seat(flow, 'tool-call', 't4', 30); makeToolRow({ callId: 'call:4', tool: 'bash', summary: 'Get-Content d', parent: t4 })
  const fin2 = seat(flow, 'assistant-step', 'f2', 100); addBodyText(fin2, '最终正文2')
  const tail2 = seat(flow, 'turn-tail', 'tt2', 24); textNode('用时 3秒', tail2)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 2, '两回合各一行')
  document.dispatchEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'E' })
  await env.tick()
  const chips = flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 2, '两回合各一个 chip', 'chips=' + chips.length)
  assert([...chips].every(c => c.getAttribute('aria-expanded') === 'true'), '全局展开后所有二级展开', 'aria=' + [...chips].map(c => c.getAttribute('aria-expanded')).join(','))
  const rows = flow.querySelectorAll('.dshcf-processed')
  assert([...rows].every(r => r.getAttribute('aria-expanded') === 'true'), '全局展开后所有一级展开', 'rowsAria=' + [...rows].map(r => r.getAttribute('aria-expanded')).join(','))
  // 再次全局：全部收起（一级收起后 chip 隐藏；blockExpanded 已复位，重新展开回合后二级保持收起）
  document.dispatchEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'E' })
  await env.tick()
  const rows2 = flow.querySelectorAll('.dshcf-processed')
  assert([...rows2].every(r => r.getAttribute('aria-expanded') === 'false'), '再次全局后所有一级收起', 'rowsAria=' + [...rows2].map(r => r.getAttribute('aria-expanded')).join(','))
  // 重新展开一个回合：二级仍保持收起（证明 blockExpanded 已复位，而非仅隐藏）
  rows2[0].dispatchEvent('click')
  await env.tick()
  const chip0 = flow.querySelector('.dshcf-chip')
  assert(chip0.getAttribute('aria-expanded') === 'false', '全局收起后重新展开回合，二级仍收起', 'aria=' + chip0.getAttribute('aria-expanded'))
  cleanup()
}

{
  console.log('\n=== 场景 G: 纯文本回合（无折叠块）全局快捷键仍能收起一级行（P1 回归） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40); textNode('问个问题', flow.lastChild)
  const mid = seat(flow, 'assistant-step', 'mid', 60); addBodyText(mid, '中间正文')
  const fin = seat(flow, 'assistant-step', 'fin', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 3秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '纯文本回合（含中间正文）也生成一级行')
  document.dispatchEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'E' })
  await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row.getAttribute('aria-expanded') === 'true', '首次全局展开一级行', 'aria=' + row.getAttribute('aria-expanded'))
  document.dispatchEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'E' })
  await env.tick()
  assert(row.getAttribute('aria-expanded') === 'false', '再次全局能收起一级行（P1 修复）', 'aria=' + row.getAttribute('aria-expanded'))
  cleanup()
}

{
  console.log('\n=== 场景 H: 运行中实时行指标 DOM 属性兜底（模块 Map 空时不再消失） ===')
  const { env, document, flow, register, cleanup } = boot('duration,toolCalls,modelCalls,inputTokens')
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'running')
  // 模拟注入器 DOM 产物（模块 Map 为空 → 走 readLiveMetricsFromDom 兜底）
  el('div', {
    'data-dshcf-turn-metrics': JSON.stringify({ toolCalls: 1, modelCalls: 1, inputTokens: 3000, turnStartTime: Date.now() - 10000, lastModelInputTokens: 3000 }),
    'data-dshcf-turn': '1', 'data-dshcf-session': 'sess-x', 'data-dshcf-seg': '0',
  }, s1)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const live = flow.querySelector('.dshcf-processing')
  assert(live !== null, '运行中生成实时摘要行')
  const label = live?.textContent ?? ''
  assert(label.includes('1次工具调用') && label.includes('1次模型调用') && label.includes('3.0K'), '实时行指标从 DOM 属性兜底读取（不消失）', 'label=' + label)
  assert(label.includes('已工作'), '实时行显示计时', 'label=' + label)
  cleanup()
}

{
  console.log('\n=== 场景 I: turnStartTime 缓存——指标短暂消失后计时不归零 ===')
  const { env, document, flow, register, cleanup } = boot('duration,toolCalls')
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'running')
  const host = el('div', {
    'data-dshcf-turn-metrics': JSON.stringify({ toolCalls: 1, turnStartTime: Date.now() - 10000 }),
    'data-dshcf-turn': '1', 'data-dshcf-session': 'sess-x', 'data-dshcf-seg': '0',
  }, s1)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const live = flow.querySelector('.dshcf-processing')
  const label1 = live?.textContent ?? ''
  assert(label1.includes('10秒'), '首次读到 turnStartTime=10秒前，计时 10秒', 'label1=' + label1)
  // 移除 DOM 属性 + 模块 Map 仍空（模拟注入器数据短暂消失）
  host.removeAttribute('data-dshcf-turn-metrics')
  register()
  await env.tick(); await env.tick()
  const label2 = live?.textContent ?? ''
  assert(label2.includes('10秒'), '指标短暂消失后计时仍用缓存 turnStartTime（不归零）', 'label2=' + label2)
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
