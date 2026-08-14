import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow } from './fake-dom.mjs'
const env = installDomGlobals()
const { document } = env
const flow = el('div', { 'data-chat-flow': '' })
function seat(kind, key) { return el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow) }
seat('user', 'u1')
const ctx = seat('context', 'c1')
const ctxDrow = el('div', { 'data-disclosure-row': '' }, ctx); el('span', { class: 'title', text: '上下文注入' }, ctxDrow); el('span', { class: 'summary', text: 'skill' }, ctxDrow)
const a1 = seat('assistant-step', 'a1'); const b1 = el('div', { class: 'ab' }, a1); makeThinkRow({ state: 'ok', summary: 's1', parent: b1 })
const a1b = seat('assistant-step', 'a1b'); const b1b = el('div', { class: 'ab' }, a1b); makeThinkRow({ state: 'ok', summary: 's2', parent: b1b })
const t1 = seat('tool-call', 't1'); makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'x', parent: t1 })
const t2 = seat('tool-call', 't2'); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'y', parent: t2 })
const amid = seat('assistant-step', 'a-mid'); const bm = el('div', { class: 'ab' }, amid); makeThinkRow({ state: 'ok', summary: 'sm', parent: bm }); el('div', { class: 'markdown' }, bm).textContent = 'mid text'
const t3 = seat('tool-call', 't3'); makeToolRow({ callId: 'call:3', tool: 'grep', summary: 'z', parent: t3 })
const a2 = seat('assistant-step', 'a2'); const b2 = el('div', { class: 'ab' }, a2); makeThinkRow({ state: 'ok', summary: 'sf', parent: b2 }); el('div', { class: 'markdown' }, b2).textContent = 'final'
const tail = seat('turn-tail', 'tt1'); tail.textContent = '用时 33秒'

function thinkRowsIn(e) {
  const out = []
  for (const r of e.querySelectorAll('[data-variant="think"]:not([data-tool])')) {
    if (r.closest('[data-chat-call-id]') !== null) continue
    if (r.closest('[data-subcalls]') !== null) continue
    out.push(r)
  }
  return out
}
function callRowsIn(e) {
  const out = []
  for (const r of e.querySelectorAll('[data-chat-call-id]')) {
    if (r.closest('[data-subcalls]') !== null) continue
    if (r.closest('[data-chat-call-id]') !== r) continue
    out.push(r)
  }
  return out
}
function hasBodyText(el) {
  const walker = document.createTreeWalker(el, 4)
  let n
  while ((n = walker.nextNode()) !== null) {
    if (n.data.trim() === '') continue
    const p = n.parentElement
    if (p !== null && p.closest('[data-variant="think"], [data-chat-call-id], .dshcf-chip') !== null) continue
    return true
  }
  return false
}
const children = [...flow.children]
const blocks = []
let run = null
for (const el of children) {
  const thinkRows = thinkRowsIn(el), callRows = callRowsIn(el)
  const isToolPile = callRows.length > 0
  const hasText = !isToolPile && thinkRows.length > 0 ? hasBodyText(el) : false
  if (isToolPile || (thinkRows.length > 0 && !hasText)) {
    if (run === null) { run = { host: el, rows: [], containers: [] }; blocks.push(run) }
    run.rows.push(...thinkRows, ...callRows)
    if (isToolPile && el !== run.host) run.containers.push(el)
  } else if (el.hasAttribute('data-chat-anchor-key')) {
    if (thinkRows.length > 0) {
      if (run === null) { run = { host: el, rows: [], containers: [] }; blocks.push(run) }
      run.rows.push(...thinkRows)
    }
    run = null
  }
}
for (const b of blocks) {
  console.log('BLOCK host=', b.host.getAttribute('data-chat-anchor-key'),
    'rows=', b.rows.map(r => r.getAttribute('data-chat-anchor-key') ?? `think(${r.getAttribute('class')})`),
    'containers=', b.containers.map(c => c.getAttribute('data-chat-anchor-key')))
}
console.log('hasBodyText(a1)=', hasBodyText(a1), 'hasBodyText(amid)=', hasBodyText(amid), 'hasBodyText(a2)=', hasBodyText(a2), 'hasBodyText(ctx)=', hasBodyText(ctx))
console.log('thinkRowsIn(a1)=', thinkRowsIn(a1).length, 'thinkRowsIn(a1b)=', thinkRowsIn(a1b).length, 'thinkRowsIn(amid)=', thinkRowsIn(amid).length, 'thinkRowsIn(a2)=', thinkRowsIn(a2).length)
// 找 hasBodyText(a1) 里未被排除的文本
{
  const walker = document.createTreeWalker(a1, 4)
  let n
  while ((n = walker.nextNode()) !== null) {
    if (n.data.trim() === '') continue
    const p = n.parentElement
    const hit = p !== null ? p.closest('[data-variant="think"], [data-chat-call-id], .dshcf-chip') : null
    if (hit === null) console.log('UNEXCLUDED TEXT in a1:', JSON.stringify(n.data), 'parent=', p?.getAttribute('class'))
  }
}
