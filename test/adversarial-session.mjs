/**
 * adversarial-session.mjs — 场景 4（切会话：flow 整体替换）与
 * 场景 9（幽灵触发：历史会话一次性渲染 + 展开后多次 tick）。
 *
 * 用 fake-dom 桩环境实跑真实 bundle（lib/client.js）。
 * 不修改任何现有文件。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const env = installDomGlobals()
const { document } = env

Object.assign(globalThis.Node, {
  DOCUMENT_POSITION_FOLLOWING: 4,
  DOCUMENT_POSITION_PRECEDING: 2,
  DOCUMENT_POSITION_CONTAINED_BY: 16,
  DOCUMENT_POSITION_CONTAINS: 8,
})
globalThis.Node.prototype.compareDocumentPosition = function (other) {
  if (this === other) return 0
  const chain = (n) => { const a = []; let c = n; while (c !== null) { a.unshift(c); c = c.parentNode } return a }
  const ca = chain(this)
  const cb = chain(other)
  let i = 0
  while (i < ca.length && i < cb.length && ca[i] === cb[i]) i++
  if (i === ca.length) return 4 | 16
  if (i === cb.length) return 2 | 8
  const idxA = ca[i].parentNode.childNodes.indexOf(ca[i])
  const idxB = cb[i].parentNode.childNodes.indexOf(cb[i])
  return idxA < idxB ? 4 : 2
}

function makeFlow() {
  const flow = el('div', { 'data-chat-flow': '' })
  flow.offsetParent = {}
  flow.setRect({ width: 800, height: 600 })
  return flow
}
function seat(flow, kind, key, h = 30) {
  const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind }, flow)
  s.setRect({ height: h })
  return s
}
function registerTree() {
  const seen = new Set(document._all)
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 1) {
        if (!seen.has(c)) { seen.add(c); document._all.push(c) }
        walk(c)
      }
    }
  }
  walk(document.body)
}
/** 模拟真实 DOM 中节点脱离文档：offsetParent=null、rect=0。 */
function detachFlow(flow) {
  flow.remove()
  flow.offsetParent = null
  flow.setRect({ width: 0, height: 0 })
}
function startPlugin() {
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) { moduleExports = spec.factory(() => { throw new Error('require unsupported in stub') }) },
  }
  eval(readFileSync(join(root, 'lib/client.js'), 'utf8'))
  if (moduleExports === null) throw new Error('bundle did not register')
  let cleanup = null
  moduleExports.apply({ effect: (fn) => { cleanup = fn() } })
  return () => { cleanup?.(); globalThis.__dshcf_observers = []; env.clearTimers() }
}

let failures = 0
function check(name, cond, detail = '') {
  const ok = !!cond
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// ===========================================================================
// 场景 4：flow 整体替换（切会话）
// ===========================================================================
console.log('===== 场景 4：切会话（flow 整体替换） =====')
{
  // ---- 会话 A ----
  const flowA = makeFlow()
  document.body.appendChild(flowA)
  const au1 = seat(flowA, 'user', 'au1', 40)
  textNode('会话A 提问', au1)
  const at1 = seat(flowA, 'tool-call', 'at1', 30)
  makeToolRow({ callId: 'call:1', tool: 'read', summary: '读A', parent: at1 })
  const aa2 = seat(flowA, 'assistant-step', 'aa2', 60)
  const aa2r = el('div', { class: 'assistant-markdown-root' }, aa2)
  const aa2b = el('div', { class: 'assistant-markdown-body' }, aa2r)
  makeThinkRow({ state: 'ok', summary: '最终', parent: aa2b })
  const aa2md = el('div', { class: 'markdown' }, aa2b)
  textNode('A 的最终正文', aa2md)
  const att1 = seat(flowA, 'turn-tail', 'att1', 24)
  textNode('用时 33秒', att1)
  registerTree()
  const stop4 = startPlugin()
  await env.tick()
  await env.tick()
  let rowsA = flowA.querySelectorAll('.dshcf-processed')
  check('[4] 会话A 完成 1 行', rowsA.length === 1, `实际 ${rowsA.length}`)
  check('[4] 会话A 工具宿主隐藏', at1.style.display === 'none')
  check('[4] 会话A 完成态无可见 chip（立即完成的回合不产生可见 chip）',
    [...flowA.querySelectorAll('.dshcf-chip')].every(c => c.style.display === 'none'),
    `chips=${flowA.querySelectorAll('.dshcf-chip').length}`)

  // ---- 切会话：旧 flow 移除（模拟真实 detach），新 flow 插入（全新元素）----
  detachFlow(flowA)
  const flowB = makeFlow()
  document.body.appendChild(flowB)
  const bu1 = seat(flowB, 'user', 'bu1', 40)
  textNode('会话B 提问', bu1)
  const bt1 = seat(flowB, 'tool-call', 'bt1', 30)
  makeToolRow({ callId: 'call:1', tool: 'grep', summary: '查B', parent: bt1 })
  const bb2 = seat(flowB, 'assistant-step', 'bb2', 60)
  const bb2r = el('div', { class: 'assistant-markdown-root' }, bb2)
  const bb2b = el('div', { class: 'assistant-markdown-body' }, bb2r)
  makeThinkRow({ state: 'ok', summary: 'B 思考', parent: bb2b })
  const bb2md = el('div', { class: 'markdown' }, bb2b)
  textNode('B 的最终正文', bb2md)
  const btt1 = seat(flowB, 'turn-tail', 'btt1', 24)
  textNode('用时 5秒', btt1)
  registerTree()
  await env.tick()
  await env.tick()

  const rowsB = flowB.querySelectorAll('.dshcf-processed')
  check('[4] 新 flow 生成自己的 1 行（不串旧会话）', rowsB.length === 1, `实际 ${rowsB.length}`)
  check('[4] 新行时长来自会话B（5秒，而非 A 的 33秒）', rowsB[0].textContent.includes('5秒'), rowsB[0].textContent)
  check('[4] 旧 flow 无残留 chip（被 stale-chip 清理）', flowA.querySelectorAll('.dshcf-chip').length === 0)
  check('[4] 旧会话 processed 行不被搬到新 flow', rowsB.length === 1 && !rowsB[0].textContent.includes('33秒'))
  check('[4] B 的工具宿主被折叠', bt1.style.display === 'none')
  check('[4] B 的最终正文可见', bb2.style.display === '' || bb2.style.display === undefined)

  // ---- 变体：元素（同身份）被搬到新容器（React keyed 复用）----
  const flowC = makeFlow()
  document.body.appendChild(flowC)
  for (const child of [...flowB.children]) {
    child.remove()
    flowC.appendChild(child)
  }
  detachFlow(flowB)
  registerTree()
  await env.tick()
  check('[4-变体] 元素移动后 heal 把 processed 行搬进新 flow（自愈，跨流搬迁行为证据）',
    flowC.querySelectorAll('.dshcf-processed').length === 1, `实际 ${flowC.querySelectorAll('.dshcf-processed').length}`)
  check('[4-变体] 折叠状态跨流保持', bt1.style.display === 'none')
  stop4()
  detachFlow(flowC)
}

// ===========================================================================
// 场景 9：幽灵触发 — 历史会话一次性渲染大量消息，展开后多次 tick
// ===========================================================================
console.log('\n===== 场景 9：幽灵触发（历史会话） =====')
{
  const flow9 = makeFlow()
  document.body.appendChild(flow9)
  const mkTurn = (n) => {
    const u = seat(flow9, 'user', `u9-${n}`, 40)
    textNode(`问题${n}`, u)
    const tA = seat(flow9, 'tool-call', `t9-${n}a`, 30)
    makeToolRow({ callId: `c${n}a`, tool: 'read', summary: `读${n}`, parent: tA })
    const tB = seat(flow9, 'tool-call', `t9-${n}b`, 30)
    makeToolRow({ callId: `c${n}b`, tool: 'grep', summary: `查${n}`, parent: tB })
    const tt = seat(flow9, 'turn-tail', `tt9-${n}`, 24)
    textNode(`用时 ${10 + n}秒`, tt)
  }
  mkTurn(1)
  mkTurn(2)
  mkTurn(3)
  // 空回合 4（无工作内容 → 不应生成行）
  const u4 = seat(flow9, 'user', 'u9-4', 40)
  textNode('问题4', u4)
  const tt4 = seat(flow9, 'turn-tail', 'tt9-4', 24)
  textNode('用时 2秒', tt4)
  registerTree()

  const stop9 = startPlugin()
  await env.tick()
  await env.tick()
  let rows9 = flow9.querySelectorAll('.dshcf-processed')
  check('[9] 一次性历史渲染：3 个工作回合 = 3 行（空回合不生成）', rows9.length === 3, `实际 ${rows9.length}`)
  check('[9] 每回合只有 1 行（无重复）', new Set([...rows9].map(r => flow9.children.indexOf(r))).size === 3)

  // 点开第 1 行，再 tick 数次
  rows9[0].dispatchEvent('click')
  await env.tick()
  await env.tick()
  await env.tick()
  rows9 = flow9.querySelectorAll('.dshcf-processed')
  check('[9] 展开后多次 tick 行数不变（不插重复行）', rows9.length === 3, `实际 ${rows9.length}`)
  check('[9] 展开状态保持（不被残余 anchor 重新收起）', rows9[0].getAttribute('aria-expanded') === 'true')
  check('[9] 展开后回合1 chip 可见', flow9.querySelectorAll('.dshcf-chip').length >= 1)

  // 收起 → 再展开 → 仍稳定
  rows9[0].dispatchEvent('click')
  await env.tick()
  rows9[0].dispatchEvent('click')
  await env.tick()
  await env.tick()
  check('[9] 收起→再展开后仍 3 行', flow9.querySelectorAll('.dshcf-processed').length === 3)
  check('[9] 再展开后不被重收', flow9.querySelectorAll('.dshcf-processed')[0].getAttribute('aria-expanded') === 'true')

  // 渐进加载：新的历史回合追加
  const u5 = seat(flow9, 'user', 'u9-5', 40)
  textNode('问题5', u5)
  const t5 = seat(flow9, 'tool-call', 't9-5', 30)
  makeToolRow({ callId: 'c5', tool: 'write', summary: '写5', parent: t5 })
  const tt5 = seat(flow9, 'turn-tail', 'tt9-5', 24)
  textNode('用时 8秒', tt5)
  registerTree()
  await env.tick()
  rows9 = flow9.querySelectorAll('.dshcf-processed')
  check('[9] 渐进追加回合 → 新行 +1（共 4 行）', rows9.length === 4, `实际 ${rows9.length}`)
  check('[9] 已展开的行不被新 anchor 收起', rows9[0].getAttribute('aria-expanded') === 'true')
  stop9()
  detachFlow(flow9)
}

env.clearTimers()
console.log(`\n[DONE] failures=${failures}`)
process.exitCode = failures > 0 ? 1 : 0
