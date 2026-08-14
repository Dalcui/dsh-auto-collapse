/**
 * fold-behavior.test.mjs — 用真实 bundle（lib/client.js）驱动会话流 fixture，
 * 验证一级/二级/三级折叠与 context 独立性，并测量“已处理行 ↔ 最终正文”之间的
 * 可见元素与 flex gap，定位“巨大空白”来源。
 *
 * 用法：node test/fold-behavior.test.mjs（纯诊断输出；行为断言见 fold-regression.test.mjs）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundlePath = join(root, "lib/client.js")

// ---------------------------------------------------------------------------
// 启动桩环境并加载真实 bundle
// ---------------------------------------------------------------------------
const env = installDomGlobals()
const { document } = env

let moduleExports = null
globalThis.window.__ModuleLoader__ = {
  load(spec) {
    moduleExports = spec.factory(() => { throw new Error('require unsupported in stub') })
  },
}
const code = readFileSync(bundlePath, 'utf8')
eval(code)
if (moduleExports === null) throw new Error('bundle did not register')

let cleanup = null
moduleExports.apply({ effect: (fn) => { cleanup = fn() } })

// ---------------------------------------------------------------------------
// 会话流 fixture（真实 DSH DOM 契约）
// ---------------------------------------------------------------------------
const flow = el('div', { 'data-chat-flow': '' })
flow.offsetParent = {}
flow.setRect({ width: 800, height: 600 })

function seat(kind, key, h) {
  const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow)
  s.setRect({ height: h }) // leaf 高度（内容整体），隐藏行后置 0
  return s
}

// 1) user
const user = seat('user', 'u1', 40)
const bubble = el('div', { class: 'user-bubble' }, user)
textNode('读一下 F:\\workspace\\HANDOFF.md', bubble)

// 2) context 注入（独立顶层节点：DisclosureRow）
const ctx = seat('context', 'c1', 30)
const ctxDrow = el('div', { 'data-disclosure-row': '' }, ctx)
el('span', { class: 'leading' }, ctxDrow)
el('span', { class: 'title', text: '上下文注入' }, ctxDrow)
el('span', { class: 'sep' }, ctxDrow)
el('span', { class: 'summary', text: 'skill 目录' }, ctxDrow)
const ctxBody = el('div', { 'data-context-injection-body': '', 'data-context-form': 'markdown' }, ctx)
textNode('系统注入的上下文正文', ctxBody)

// 3) think-only assistant-step（块宿主 a1）
const a1 = seat('assistant-step', 'a1', 26)
const a1Root = el('div', { class: 'assistant-markdown-root' }, a1)
const a1Body = el('div', { class: 'assistant-markdown-body' }, a1Root)
makeThinkRow({ state: 'ok', summary: '用户想读 HANDOFF', parent: a1Body })

// 3b) 第二个 think-only assistant-step（合并进同一块，非宿主）
const a1b = seat('assistant-step', 'a1b', 26)
const a1bRoot = el('div', { class: 'assistant-markdown-root' }, a1b)
const a1bBody = el('div', { class: 'assistant-markdown-body' }, a1bRoot)
makeThinkRow({ state: 'ok', summary: '先读文件再继续', parent: a1bBody })

// 4) 工具组 t1 / t2（独立 seat）
const t1 = seat('tool-call', 't1', 30)
makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'Get-Content HANDOFF.md', parent: t1 })
const t2 = seat('tool-call', 't2', 30)
makeToolRow({ callId: 'call:2', tool: 'read', summary: 'F:\\workspace\\HANDOFF.md', parent: t2 })

// 5) 中间正文 assistant-step（有 think + 正文，非最终）
const amid = seat('assistant-step', 'a-mid', 60)
const amidRoot = el('div', { class: 'assistant-markdown-root' }, amid)
const amidBody = el('div', { class: 'assistant-markdown-body' }, amidRoot)
makeThinkRow({ state: 'ok', summary: '中间思考', parent: amidBody })
const amidMd = el('div', { class: 'markdown' }, amidBody)
textNode('我先读一下 HANDOFF 的内容。', amidMd)

// 6) 工具组 t3
const t3 = seat('tool-call', 't3', 30)
makeToolRow({ callId: 'call:3', tool: 'grep', summary: '搜索关键词', parent: t3 })

// 7) 最终正文（think + 正文；真实 DSH 最终输出 kind='assistant'，过程 step 才是 assistant-step）
const a2 = seat('assistant', 'a2', 100)
const a2Root = el('div', { class: 'assistant-markdown-root' }, a2)
const a2Body = el('div', { class: 'assistant-markdown-body' }, a2Root)
makeThinkRow({ state: 'ok', summary: '最终思考', parent: a2Body })
const a2Md = el('div', { class: 'markdown' }, a2Body)
textNode('已经读完，这是最终正文。', a2Md)

// 8) turn-tail（回合边界）
const tail = seat('turn-tail', 'tt1', 24)
textNode('用时 33秒', tail)

document.body.appendChild(flow)

// 把 fixture 树注册进 document 查询范围
{
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

// ---------------------------------------------------------------------------
// 布局测算（flex column gap:16px，隐藏项不计）
// ---------------------------------------------------------------------------
function visibleHeight(node) {
  if (node.nodeType === 3) return 0 // 文本节点不占布局
  if (node.style.display === 'none') return 0
  if (node.classList.contains('dshcf-chip')) return 22
  if (node.classList.contains('dshcf-processed')) return 24
  if (typeof node._rect.height === 'number' && node._rect.height > 0 && node.childNodes.length === 0) return node._rect.height
  // wrapper：高度 = 可见子节点之和（自身有 leaf 高度时用自身）
  if (node._rect.height > 0 && node.getAttribute('data-chat-anchor-key') !== null) {
    // seat：内容由子节点决定
  }
  return node.childNodes.reduce((s, c) => s + visibleHeight(c), 0)
}

function measureBetween(flow, start, end, label) {
  const gap = 16
  const items = []
  let prev = null
  let blank = 0
  let inRange = false
  for (const child of flow.children) {
    if (child === start) { inRange = true; prev = start; continue }
    if (child === end) break
    if (!inRange) continue
    if (child.style.display === 'none') { prev = child; continue }
    const h = visibleHeight(child)
    if (prev !== null && prev.style.display !== 'none') blank += gap
    items.push({ el: child, kind: child.getAttribute('data-chat-flow-kind'), h })
    prev = child
  }
  return { items: items.map(i => `${i.kind}:${i.h}`), blank }
}

function visibleFlowChildren(flow) {
  return flow.children.filter(c => c.style.display !== 'none').map(c => ({
    kind: c.getAttribute('data-chat-flow-kind'),
    cls: c.getAttribute('class') ?? '',
    display: c.style.display,
  }))
}

// ---------------------------------------------------------------------------
// 驱动：模拟历史会话一次渲染完成
// ---------------------------------------------------------------------------
await env.tick()
await env.tick()

const flowChildren = () => [...flow.children]
const row = flow.querySelector('.dshcf-processed')
const chips = () => flow.querySelectorAll('.dshcf-chip')

console.log('=== 完成态（当前代码） ===')
console.log('flow children:', flowChildren().map(c => `${c.getAttribute('data-chat-anchor-key') ?? c.getAttribute('data-chat-flow-kind') ?? c.getAttribute('class') ?? '?'}[${c.style.display || 'visible'}]`).join(' '))
console.log('processed row 插入位置 index:', flowChildren().indexOf(row), '（前一个兄弟:', flowChildren()[flowChildren().indexOf(row) - 1]?.getAttribute('data-chat-flow-kind') ?? 'none', '）')
console.log('chips:', chips().map(c => `${c.textContent.trim().slice(0, 24)}|expanded=${c.getAttribute('aria-expanded')}|display=${c.style.display}`).join(' || '))

const a2Idx = flowChildren().indexOf(a2)
const m = measureBetween(flow, row, a2, 'row→a2')
console.log('row→a2 之间可见元素:', m.items, '空白(gap)总量:', m.blank)

// 三级：t1 单条命令展开（原生 data-open），随后二级收起再展开应保持
const t1Row = t1.querySelector('[data-chat-call-id]')
const t1OpenRoot = t1Row.querySelector('[data-tool]')
t1OpenRoot.setAttribute('data-open', 'true')
// 让插件感知（不需要——插件不读 data-open 做折叠判断；仅用于三级断言）

// ---- 一级点击：展开 ----
console.log('\n=== 点击一级 已处理（展开） ===')
row.dispatchEvent('click')
await env.tick()
console.log('flow children:', flowChildren().map(c => `${c.getAttribute('data-chat-flow-kind') ?? c.getAttribute('class') ?? '?'}[${c.style.display || 'visible'}]`).join(' '))
console.log('chips:', chips().map(c => `${c.textContent.trim().slice(0, 24)}|expanded=${c.getAttribute('aria-expanded')}|display=${c.style.display}`).join(' || '))
console.log('t1 内 tool row display:', t1Row.style.display, '| t1 内 data-open:', t1OpenRoot.getAttribute('data-open'))
console.log('context seat display:', ctx.style.display)

// 二级：点击 chip（运行了命令）
console.log('\n=== 点击二级 chip（折叠） ===')
const chip1 = chips()[0]
chip1.dispatchEvent('click')
await env.tick()
console.log('chip expanded:', chip1.getAttribute('aria-expanded'))
console.log('t1 seat display:', t1.style.display, '| t1 row display:', t1Row.style.display, '| t1 data-open:', t1OpenRoot.getAttribute('data-open'))
console.log('a1b seat display:', a1b.style.display)

// 二级再展开
console.log('\n=== 点击二级 chip（展开） ===')
chip1.dispatchEvent('click')
await env.tick()
console.log('chip expanded:', chip1.getAttribute('aria-expanded'))
console.log('t1 row display:', t1Row.style.display, '| t1 data-open:', t1OpenRoot.getAttribute('data-open'))

// 一级收起再展开：二级状态应保持（现状：被强制展开）
console.log('\n=== 一级收起 → 再展开 ===')
row.dispatchEvent('click')
await env.tick()
row.dispatchEvent('click')
await env.tick()
console.log('chips:', chips().map(c => `${c.textContent.trim().slice(0, 24)}|expanded=${c.getAttribute('aria-expanded')}|display=${c.style.display}`).join(' || '))
console.log('t1 row display:', t1Row.style.display, '| t1 data-open:', t1OpenRoot.getAttribute('data-open'))
console.log('context seat display:', ctx.style.display)

// 停用清理
cleanup?.()
env.clearTimers()
console.log('\n[DONE]')
