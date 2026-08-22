import { installDomGlobals, el, textNode } from './fake-dom.mjs'
import { readFileSync } from 'node:fs'

const code = readFileSync('./lib/client.js', 'utf8')
const env = installDomGlobals()
const { document } = env
let mod = null
globalThis.window.__ModuleLoader__ = { load(spec) { mod = spec.factory(() => ({})) } }
eval(code)
mod.apply({ effect: (fn) => { fn() } })
const flow = el('div', { 'data-chat-flow': '' })
flow.offsetParent = {}
flow.setRect({ width: 800, height: 600 })
document.body.appendChild(flow)
for (const node of [flow, ...flow.querySelectorAll('*')]) {
  if (!document._all.includes(node)) document._all.push(node)
}
function seat(kind, key) {
  const s = el('div', { 'data-chat-anchor-key': key }, flow)
  if (kind !== null) s.setAttribute('data-chat-flow-kind', kind)
  return s
}
function ctxSeat(key, summary) {
  const s = seat('context', key)
  const row = el('div', { 'data-chat-call-id': key }, s)
  const root = el('div', { 'data-tool': 'context', 'data-state': 'ok' }, row)
  const dr = el('div', { 'data-disclosure-row': '' }, root)
  el('span', { class: 'title', text: '上下文注入' }, dr)
  el('span', { class: 'summary', text: summary }, dr)
  return s
}
function thinkSeat(key) {
  const s = seat('assistant-step', key)
  const t = el('div', { 'data-variant': 'think', 'data-state': 'ok' }, s)
  const dr = el('div', { 'data-disclosure-row': '' }, t)
  el('span', { class: 'title', text: 'Think' }, dr)
  return s
}
let nextChipId = 1
const chipIds = new WeakMap()
const chips = () => [...flow.querySelectorAll('.dshcf-chip')].map(c => {
  if (!chipIds.has(c)) chipIds.set(c, nextChipId++)
  const host = c.parentElement?.getAttribute('data-chat-anchor-key') || c.parentElement?.getAttribute('data-chat-flow-kind') || '?'
  return {
    id: chipIds.get(c),
    key: c.getAttribute('data-dshcf-block-key'),
    title: c.querySelector('.dshcf-chip-title')?.textContent || '?',
    summary: c.querySelector('.dshcf-chip-summary')?.textContent || '',
    display: c.style.display,
    host,
    hostDisplay: c.parentElement?.style.display || '',
    animations: c._animations?.length || 0,
  }
})
const flowKinds = () => [...flow.children].map(child => {
  const cls = child.getAttribute('class') || ''
  if (cls.includes('dshcf-processed')) return 'processed'
  if (cls.includes('dshcf-flow-chip')) return `chip#${chipIds.get(child) || '?'}`
  return `${child.getAttribute('data-chat-flow-kind') || '?'}:${child.getAttribute('data-chat-anchor-key') || '-'}`
})
const log = (tag) => console.log(tag.padEnd(18), 'flow:', JSON.stringify(flowKinds()), 'chips:', JSON.stringify(chips()))
const tick = async (tag) => {
  await env.tick()
  const style = document.getElementById('dshcf-style')
  log(tag)
  console.log(' '.repeat(18), 'state:', style?.getAttribute('data-dshcf-state') || '?', 'error:', style?.getAttribute('data-dshcf-error') || '-')
}

textNode('yo', seat('user', 'u1'))
const ctx1 = ctxSeat('ctx1', '~/.claude/CLAUDE.md')
const ctx2 = ctxSeat('ctx2', '~/dsh/AGENTS.md')
const tail = seat('turn-tail', 'tt')
textNode('用时 7秒', tail)
await tick('completed')
await tick('completed-2')
const processed = document.querySelector('.dshcf-processed')
if (processed === null) throw new Error('completed turn did not create .dshcf-processed')

// === 用户在回合已收尾、但 React 仍在补挂工作节点时展开 ===
processed.dispatchEvent('click')
const gap1 = seat('tool-call', 'transient-gap-1')
flow.insertBefore(gap1, ctx2)
const ctx3 = ctxSeat('ctx3', 'settings.json')
flow.insertBefore(ctx3, tail)
const gap2 = seat('tool-call', 'transient-gap-2')
flow.insertBefore(gap2, ctx3)
log('before-split-pass')
await tick('split-pass')
await tick('split-pass-2')

// 临时分隔节点消失后，context 应在下一轮重新合并为一个块。
gap1.remove()
gap2.remove()
await tick('merge-pass')
await tick('merge-pass-2')

// 继续补齐同一回合的思考与最终正文，观察新工作块是否独立。
const think = thinkSeat('a0')
flow.insertBefore(think, tail)
await tick('+think')
const answer = seat('assistant-step', 'a1')
textNode('Yo! 我在。', el('div', { class: 'markdown' }, el('div', { class: 'assistant-markdown-body' }, el('div', { class: 'assistant-markdown-root' }, answer))))
flow.insertBefore(answer, tail)
await tick('+body')
await tick('stable')

// === context + 已思考：收起后再次展开 ===
processed.dispatchEvent('click')
env.flushRaf()
log('collapse-inflight')
processed.dispatchEvent('click')
log('reexpand-before-settle')
env.flushRaf()
log('reexpand-pass')
await tick('reexpand')
await tick('reexpand-2')
process.exit(0)
