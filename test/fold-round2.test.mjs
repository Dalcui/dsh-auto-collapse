/**
 * fold-round2.test.mjs — 第二轮需求回归测试。
 * 覆盖：R1 head 锚、R2 跨类别合并计数、R3 进行中强制展开、
 * R4 间隔点分隔符、R5 工具名数量降序、R6 PTC 子工具名解析+强制折叠。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow, makeRetryRow, makeSubcall } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')
let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}
function boot(fields = 'duration') {
  const env = installDomGlobals()
  const { document } = env
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = { load(spec) { moduleExports = spec.factory(() => { throw new Error('require unsupported in stub') }) } }
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  let cleanup = null
  const scopeMock = { getSnapshot: () => ({ status: 'ready', value: { summaryFields: fields, statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }), subscribe: () => () => {}, set: async () => {}, unset: async () => {} }
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
function addThink(s, summary, state='ok') { const md = el('div', { class: 'assistant-markdown-root' }, s); const b = el('div', { class: 'assistant-markdown-body' }, md); makeThinkRow({ state, summary, parent: b }) }
function addBody(s, text) { const md = el('div', { class: 'assistant-markdown-root' }, s); const b = el('div', { class: 'assistant-markdown-body' }, md); textNode(text, el('div', { class: 'markdown' }, b)) }
function ctxSeat(flow, key, summary) { const c = seat(flow, 'context', key, 30); const d = el('div', { 'data-disclosure-row': '' }, c); el('span', { class: 'title', text: '上下文注入' }, d); el('span', { class: 'summary', text: summary }, d); return c }

{
  console.log('\n=== R1: 块前 model-retry 时 chip 位于 retry 之上（head 锚） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40); textNode('重试读', flow.lastChild)
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/2）', parent: r1 })
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '一级展开后生成二级 chip')
  assert(chip.nextElementSibling === r1, 'R1：chip 位于块前 model-retry 之上（head 锚）', 'next=' + (chip.nextElementSibling?.getAttribute('data-chat-anchor-key') ?? 'null'))
  assert(r1.style.display === 'none', 'R1：二级收起态块前 model-retry 随 chip 折叠', 'r1=' + r1.style.display)
  chip.dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === '', 'R1：二级展开后 model-retry 恢复显示且 chip 位置不变', 'r1=' + r1.style.display)
  assert(chip.nextElementSibling === r1, 'R1：展开后 chip 仍在 retry 之上（不跳动）', 'next=' + (chip.nextElementSibling?.getAttribute('data-chat-anchor-key') ?? 'null'))
  chip.dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === 'none', 'R1：再次收起 model-retry 随 chip 隐藏', 'r1=' + r1.style.display)
  cleanup()
}

{
  console.log('\n=== R2a: tool + context 跨类别合并为一个 chip ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('做点事', b.flow.lastChild)
  seat(b.flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: b.flow.children[1] })
  ctxSeat(b.flow, 'c1', 'AGENTS.md')
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await b.env.tick()
  const chips = b.flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, 'tool+context 合并为一个 chip（不再各 1 条都不折）', 'chips=' + chips.length)
  const summary = chips[0]?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(summary.includes('Read ×1'), '摘要含工具计数 Read ×1', 'summary=' + summary)
  assert(summary.includes('1 次上下文注入'), '摘要含上下文注入计数', 'summary=' + summary)
  b.cleanup()
}

{
  console.log('\n=== R2b: think+tool+context+model-retry 四类别合并计数 ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('全套', b.flow.lastChild)
  const th = seat(b.flow, 'assistant-step', 's1', 30); addThink(th, '想想')
  seat(b.flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'bash', summary: 'a.sh', parent: b.flow.children[2] })
  ctxSeat(b.flow, 'c1', 'README')
  const r1 = seat(b.flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求', parent: r1 })
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await b.env.tick()
  const chips = b.flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, '四类别合并为一个 chip', 'chips=' + chips.length)
  const summary = chips[0]?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(summary.includes('1 段思考'), '摘要含思考计数', 'summary=' + summary)
  assert(summary.includes('Bash ×1'), '摘要含工具计数 Bash ×1', 'summary=' + summary)
  assert(summary.includes('1 次上下文注入'), '摘要含上下文注入计数', 'summary=' + summary)
  assert(summary.includes('1 次重试'), '摘要含重试计数（model-retry）', 'summary=' + summary)
  b.cleanup()
}

{
  console.log('\n=== R3: 进行中 running 块强制展开 ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('跑命令', b.flow.lastChild)
  const s1 = seat(b.flow, 'assistant-step', 's1', 26); addThink(s1, '先想', 'ok')
  const t1 = seat(b.flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', state: 'running', summary: 'Get-Content a.txt', parent: t1 })
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  const chip = b.flow.querySelector('.dshcf-chip')
  assert(chip !== null, '进行中生成二级 chip')
  // R3（改）：进行中不再强制整块展开。chip 保持收起、running 行在 chip 外可见，
  // 已完成行折叠进 chip（逐条纳入折叠，避免 running→ok→running 反复折叠/展开）。
  assert(chip.getAttribute('aria-expanded') === 'false', 'R3：进行中 chip 保持收起（running 行在 chip 外可见）', 'aria=' + chip.getAttribute('aria-expanded'))
  const toolRow = t1.querySelector('[data-chat-call-id]')
  assert(toolRow.style.display === '', 'R3：running 工具行在 chip 外可见', 'row=' + toolRow.style.display)
  const thinkRow = s1.querySelector('[data-variant="think"]')
  assert(thinkRow.style.display === 'none', 'R3：已完成 think 行折叠进 chip', 'think=' + thinkRow.style.display)
  // 闭合：工具 done + turn-tail
  t1.querySelector('[data-tool]').setAttribute('data-state', 'ok')
  s1.querySelector('[data-variant="think"]').setAttribute('data-state', 'ok')
  const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  b.register()
  await b.env.tick(); await b.env.tick()
  assert(b.flow.querySelector('.dshcf-processed') !== null, 'R3：闭合后生成一级行（块收起）')
  b.cleanup()
}

{
  console.log('\n=== R4: 指标分隔符为间隔点 ===')
  const b = boot('duration,inputTokens')
  seat(b.flow, 'user', 'u1', 40); textNode('读文件', b.flow.lastChild)
  const t1 = seat(b.flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(b.flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail); el('div', { 'data-usage': JSON.stringify({ inputTokens: 1500 }) }, tail)
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  const row = b.flow.querySelector('.dshcf-processed')
  const label = row?.firstElementChild?.textContent ?? ''
  assert(label.includes('·'), 'R4：摘要分隔符含间隔点 ·', 'label=' + label)
  assert(!label.includes('|'), 'R4：摘要不再使用 | 分隔符', 'label=' + label)
  b.cleanup()
}

{
  console.log('\n=== R5: 工具名按数量降序 ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('跑命令', b.flow.lastChild)
  const t1 = seat(b.flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'bash', summary: 'a', parent: t1 })
  const t2 = seat(b.flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b', parent: t2 })
  const t3 = seat(b.flow, 'tool-call', 't3', 30); makeToolRow({ callId: 'call:3', tool: 'read', summary: 'c', parent: t3 })
  const t4 = seat(b.flow, 'tool-call', 't4', 30); makeToolRow({ callId: 'call:4', tool: 'pwsh', summary: 'd', parent: t4 })
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await b.env.tick()
  const chip = b.flow.querySelector('.dshcf-chip')
  const summary = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  const idxRead = summary.indexOf('Read ×2')
  const idxBash = summary.indexOf('Bash ×1')
  const idxPwsh = summary.indexOf('Pwsh ×1')
  assert(idxRead !== -1 && idxBash !== -1 && idxPwsh !== -1, 'R5：摘要含全部工具计数', 'summary=' + summary)
  assert(idxRead < idxBash && idxBash < idxPwsh, 'R5：按数量降序（Read ×2 在前，Bash/Pwsh 并列保持首次出现顺序）', 'summary=' + summary)
  b.cleanup()
}

{
  console.log('\n=== R6a: 单个 run_code + 子工具强制折叠、用子工具名 ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('编排工具', b.flow.lastChild)
  const t1 = seat(b.flow, 'tool-call', 't1', 30); const trow = makeToolRow({ callId: 'call:1', tool: 'run_code', summary: 'List project directory structure', parent: t1 })
  const subs = el('div', { 'data-subcalls': '' }, trow)
  makeSubcall({ callId: 's1', tool: 'bash', parent: subs })
  makeSubcall({ callId: 's2', tool: 'bash', parent: subs })
  makeSubcall({ callId: 's3', tool: 'read', parent: subs })
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await b.env.tick()
  const chip = b.flow.querySelector('.dshcf-chip')
  assert(chip !== null, 'R6a：单个 Code + 子工具强制折叠生成 chip')
  const summary = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(summary.includes('Bash ×2') && summary.includes('Read ×1'), 'R6a：摘要用子工具名（Bash ×2 · Read ×1）', 'summary=' + summary)
  assert(!summary.includes('Code ×1'), 'R6a：摘要不再用 Code 兜底', 'summary=' + summary)
  const code = chip?.querySelector('.dshcf-chip-code')?.textContent ?? ''
  assert(code.includes('List project directory structure'), 'R6a：末尾仍回显 description', 'code=' + code)
  b.cleanup()
}

{
  console.log('\n=== R6b: 单个 run_code 无子工具不折叠 ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('单 code', b.flow.lastChild)
  const t1 = seat(b.flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'run_code', summary: 'do something', parent: t1 })
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await b.env.tick()
  assert(b.flow.querySelector('.dshcf-chip') === null, 'R6b：无子工具的单 Code 不折叠', 'chips=' + b.flow.querySelectorAll('.dshcf-chip').length)
  b.cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1