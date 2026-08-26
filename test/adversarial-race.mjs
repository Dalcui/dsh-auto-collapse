/**
 * adversarial-race.mjs — 场景 1（turn-tail 先渲染 + running→ok 竞态）与
 * 场景 2（多回合连续流式，segment running 起点归属）+ 2b（空回合夹在多个边界中间）。
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

// ---- 补桩：Node 静态常量 + compareDocumentPosition（fake-dom 未实现） ----
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

// ---- 基建 ----
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
/** 移除会话流并模拟真实 DOM 脱离文档（offsetParent=null、rect=0），
 * 否则 findFlow() 会继续命中已废弃的旧 flow。 */
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
function verdict(label) {
  const all = [...new Set()]
  console.log(`\n[判定] ${label}`)
}

// ===========================================================================
// 场景 1：竞态 — turn-tail 先渲染、块内工具行 running，随后 data-state→ok
// ===========================================================================
console.log('===== 场景 1：turn-tail 先渲染 + running→ok =====')
{
  const flow1 = makeFlow()
  document.body.appendChild(flow1)
  const u1 = seat(flow1, 'user', 'u1', 40)
  const bubble = el('div', { class: 'user-bubble' }, u1)
  textNode('用户消息', bubble)
  const t1 = seat(flow1, 'tool-call', 't1', 30)
  const t1row = makeToolRow({ callId: 'call:1', tool: 'read', state: 'running', summary: '读取文件…', parent: t1 })
  // 需求4：单条工具不再折叠；补第二条已完成工具保持可折叠，仍验证 running chip。
  const t2 = seat(flow1, 'tool-call', 't2', 30)
  makeToolRow({ callId: 'call:2', tool: 'grep', state: 'ok', summary: '找内容', parent: t2 })
  const tt1 = seat(flow1, 'turn-tail', 'tt1', 24)
  textNode('用时 33秒', tt1)
  registerTree()

  const stop1 = startPlugin()
  await env.tick()
  await env.tick() // pass1: tt1 已出现，但 running segment 暂不生成一级行

  let chip = flow1.querySelector('.dshcf-chip')
  check('[1] 首轮 chip 存在且显示"正在运行"', chip !== null && (chip.textContent ?? '').includes('正在运行'), chip?.textContent)
  check('[1] running 中不提前收尾（无 processed 行）', flow1.querySelectorAll('.dshcf-processed').length === 0)

  // 工具完成：data-state → ok（MutationObserver attributeFilter 含 data-state）
  t1row.querySelector('[data-tool]').setAttribute('data-state', 'ok')
  await env.tick()

  let rows1 = flow1.querySelectorAll('.dshcf-processed')
  check('[1] running→ok 后协调完成：恰好 1 行 processed', rows1.length === 1, `实际 ${rows1.length}`)
  check('[1] processed 行插在回合工作内容之前（u1 之后、t1 之前）',
    flow1.children.indexOf(rows1[0]) === flow1.children.indexOf(t1) - 1,
    `index(row)=${flow1.children.indexOf(rows1[0])} index(t1)=${flow1.children.indexOf(t1)}`)
  check('[1] 完成态工具宿主整块隐藏', t1.style.display === 'none')
  chip = flow1.querySelector('.dshcf-chip')
  check('[1] 完成态 chip 隐藏', chip !== null && chip.style.display === 'none', `display=${chip?.style.display}`)

  await env.tick(); await env.tick(); await env.tick()
  check('[1] 连续 tick 后不重复（仍恰好 1 行）', flow1.querySelectorAll('.dshcf-processed').length === 1)

  // 一级展开 → 再 tick：残余 anchor 不应重新收起
  rows1[0].dispatchEvent('click')
  await env.tick()
  check('[1] 一级展开后 chip 恢复可见', flow1.querySelectorAll('.dshcf-chip').length >= 1)
  check('[1] 展开后工作宿主可见', t1.style.display === '' || t1.style.display === undefined)
  chip = flow1.querySelector('.dshcf-chip')
  check('[1] 展开后 chip 收起态（collapseAllChips）', chip?.getAttribute('aria-expanded') === 'false')
  chip?.dispatchEvent('click')
  await env.tick()
  check('[1] 二级展开后工具行可见', t1row.style.display === '' || t1row.style.display === undefined, `display=${t1row.style.display}`)
  await env.tick(); await env.tick()
  check('[1] 展开态多次 tick 不被残余 anchor 重收', flow1.querySelectorAll('.dshcf-processed').length === 1 && t1row.style.display === '')
  stop1()
  detachFlow(flow1)
}

// ===========================================================================
// 场景 2：多回合连续流式（fake clock 验证 segment 起点归属）
// ===========================================================================
console.log('\n===== 场景 2：多回合连续流式 =====')
let clock = 1000
const realNow = Date.now
Date.now = () => clock
try {
  const flow2 = makeFlow()
  document.body.appendChild(flow2)
  const u1b = seat(flow2, 'user', 'u1b', 40)
  textNode('第一轮提问', u1b)
  const t1b = seat(flow2, 'tool-call', 't1b', 30)
  const t1brow = makeToolRow({ callId: 'call:1', tool: 'read', state: 'running', summary: '读文件', parent: t1b })
  const t1b2 = seat(flow2, 'tool-call', 't1b2', 30)
  makeToolRow({ callId: 'call:1b', tool: 'grep', state: 'ok', summary: '找', parent: t1b2 })
  registerTree()

  const stop2 = startPlugin()
  await env.tick() // passA: T0=1000
  check('[2] 回合1 chip 运行中', (flow2.querySelector('.dshcf-chip')?.textContent ?? '').includes('正在运行'))

  // 回合1 未完成时回合2 的 user 消息出现（segment 隔离风险点）
  const tt1b = seat(flow2, 'turn-tail', 'tt1b', 24)
  textNode('回合1完成', tt1b)
  const u2b = seat(flow2, 'user', 'u2b', 40)
  textNode('第二轮提问', u2b)
  registerTree()
  clock = 41000
  await env.tick() // passB: tt1b/u2b → pending（t1b 仍 running）
  check('[2] running 中不提前收尾（0 行）', flow2.querySelectorAll('.dshcf-processed').length === 0)

  // 回合1 工具完成 → 收尾回合1
  t1brow.querySelector('[data-tool]').setAttribute('data-state', 'ok')
  clock = 41000
  await env.tick() // passC
  let rows2 = flow2.querySelectorAll('.dshcf-processed')
  check('[2] 回合1 恰好 1 行', rows2.length === 1, `实际 ${rows2.length}`)
  check('[2] 回合1 duration=40秒（segment 起点归属正确，无串扰）', rows2[0].textContent.includes('40秒'), rows2[0].textContent)

  // 回合2 工具出现并运行 → 完成
  const t2b = seat(flow2, 'tool-call', 't2b', 30)
  const t2brow = makeToolRow({ callId: 'call:2', tool: 'grep', state: 'running', summary: '搜索', parent: t2b })
  const t2b2 = seat(flow2, 'tool-call', 't2b2', 30)
  makeToolRow({ callId: 'call:2b', tool: 'read', state: 'ok', summary: '读', parent: t2b2 })
  const tt2b = seat(flow2, 'turn-tail', 'tt2b', 24)
  textNode('回合2完成', tt2b)
  registerTree()
  clock = 46000
  await env.tick() // passD: t2b running → segment start=46000
  t2brow.querySelector('[data-tool]').setAttribute('data-state', 'ok')
  clock = 76000
  await env.tick() // passE
  rows2 = flow2.querySelectorAll('.dshcf-processed')
  check('[2] 两回合各 1 行（共 2 行，不重复不串行）', rows2.length === 2, `实际 ${rows2.length}`)
  const [r1, r2] = rows2
  check('[2] 回合1 行在 tt1 之前', flow2.children.indexOf(r1) < flow2.children.indexOf(tt1b))
  check('[2] 回合2 行在 u2 之后、tt2 之前', flow2.children.indexOf(r2) > flow2.children.indexOf(u2b) && flow2.children.indexOf(r2) < flow2.children.indexOf(tt2b))
  check('[2] 回合2 duration=30秒（segment 起点独立，不串回合1）', r2.textContent.includes('30秒'), r2.textContent)

  // segment 所有权不串：展开回合2 行只影响回合2 的宿主
  r2.dispatchEvent('click')
  await env.tick()
  check('[2] 展开回合2 行后 t2b 可见', t2b.style.display === '' || t2b.style.display === undefined, `display=${t2b.style.display}`)
  check('[2] 展开回合2 行后 t1b 仍隐藏（segment 不串）', t1b.style.display === 'none', `display=${t1b.style.display}`)
  stop2()
  detachFlow(flow2)
}
finally {
  // 保持 clock 以便场景 2b 继续使用
}

// ===========================================================================
// 场景 2b：空回合夹在中间，多个边界同时 pending → 完成时不重复
// ===========================================================================
console.log('\n===== 场景 2b：空回合 + 多 pending 边界 =====')
{
  const flow2b = makeFlow()
  document.body.appendChild(flow2b)
  const u1c = seat(flow2b, 'user', 'u1c', 40)
  textNode('q1', u1c)
  const t1c = seat(flow2b, 'tool-call', 't1c', 30)
  const t1crow = makeToolRow({ callId: 'call:1', tool: 'bash', state: 'running', summary: 'run', parent: t1c })
  registerTree()

  clock = 5000
  const stop2b = startPlugin()
  await env.tick() // segment start=5000

  // 空回合 2 的边界全部出现（t1c 仍在 running）
  const tt1c = seat(flow2b, 'turn-tail', 'tt1c', 24)
  textNode('回合1完成', tt1c)
  const u2c = seat(flow2b, 'user', 'u2c', 40)
  textNode('q2', u2c)
  const tt2c = seat(flow2b, 'turn-tail', 'tt2c', 24)
  textNode('用时 1秒', tt2c)
  registerTree()
  clock = 45000
  await env.tick()
  check('[2b] running 中三个边界全部 pending（0 行）', flow2b.querySelectorAll('.dshcf-processed').length === 0)

  t1crow.querySelector('[data-tool]').setAttribute('data-state', 'ok')
  clock = 45000
  await env.tick()
  const rows2b = flow2b.querySelectorAll('.dshcf-processed')
  check('[2b] 完成时恰好 1 行（多 pending 边界不重复）', rows2b.length === 1, `实际 ${rows2b.length}`)
  check('[2b] duration=40秒', rows2b[0].textContent.includes('40秒'), rows2b[0].textContent)
  check('[2b] 行位置在 tt1 之前（回合1）', flow2b.children.indexOf(rows2b[0]) < flow2b.children.indexOf(tt1c))
  stop2b()
  detachFlow(flow2b)
}

Date.now = realNow
env.clearTimers()
console.log(`\n[DONE] failures=${failures}`)
process.exitCode = failures > 0 ? 1 : 0
