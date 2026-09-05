/**
 * fold-persist.test.mjs — T2 持久化链路测试。
 *
 * 覆盖：点击一级行展开 → localStorage 写入 dshcf:expanded:* 键；
 * 再次点击收起 → 键被移除；keepLocalStorage 下重新 boot（模拟页面重载）
 * → 展开状态自动恢复。此前 fake-dom 无 localStorage 桩，persistSegmentExpanded
 * 抛 ReferenceError 被静默吞掉，这条真实用户链路从未被执行过。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

function boot({ keepLocalStorage = false } = {}) {
  const env = installDomGlobals({ keepLocalStorage })
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

/** 标准回合：user + 工具 + 正文 + tail。 */
function buildTurn(flow, prefix) {
  const user = seat(flow, 'user', prefix + 'u1', 40); textNode('读文件', user)
  const t1 = seat(flow, 'tool-call', prefix + 't1', 30); makeToolRow({ callId: prefix + 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', prefix + 'a1', 100)
  const md = el('div', { class: 'assistant-markdown-root' }, fin)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode('最终正文', el('div', { class: 'markdown' }, body))
  const tail = seat(flow, 'turn-tail', prefix + 'tt1', 24); textNode('用时 5秒', tail)
}

function expandedKeys() {
  const keys = globalThis.localStorage.keys()
  return keys.filter(k => k.startsWith('dshcf:expanded:')).map(k => [k, globalThis.localStorage.getItem(k)])
}

{
  console.log('\n=== T2-A：点击展开/收起写入与移除 localStorage ===')
  const { env, document, flow, register, cleanup } = boot()
  buildTurn(flow, 'a')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '完成回合生成已处理行')
  assert(expandedKeys().length === 0, '初始无持久化键', JSON.stringify(expandedKeys()))
  row.dispatchEvent('click')
  await env.tick(); await env.tick()
  const afterExpand = expandedKeys()
  assert(afterExpand.length === 1 && afterExpand[0][1] === 'true', '展开点击写入 expanded=true', JSON.stringify(afterExpand))
  const toolRowA = flow.querySelector('[data-chat-call-id]')
  assert(toolRowA !== null && toolRowA.style.display === '', '展开后工具行恢复可见', 'display=' + (toolRowA && toolRowA.style.display))
  row.dispatchEvent('click')
  await env.tick(); await env.tick()
  const afterCollapse = expandedKeys()
  assert(afterCollapse.length === 0, '收起点击移除持久化键', JSON.stringify(afterCollapse))
  cleanup()
}

{
  console.log('\n=== T2-B：keepLocalStorage 重新 boot 后展开状态自动恢复 ===')
  const first = boot()
  buildTurn(first.flow, 'b')
  first.document.body.appendChild(first.flow)
  first.register()
  await first.env.tick(); await first.env.tick()
  const row1 = first.flow.querySelector('.dshcf-processed')
  assert(row1 !== null, '首次 boot 生成已处理行')
  row1.dispatchEvent('click')
  await first.env.tick(); await first.env.tick()
  const saved = expandedKeys()
  assert(saved.length === 1 && saved[0][1] === 'true', '展开状态已持久化', JSON.stringify(saved))
  const toolRow1 = first.flow.querySelector('[data-chat-call-id]')
  assert(toolRow1 !== null && toolRow1.style.display === '', '首次 boot 展开后工具行可见')
  first.cleanup()

  // 模拟页面重载：共享 localStorage 存储的新环境
  const second = boot({ keepLocalStorage: true })
  buildTurn(second.flow, 'b')
  second.document.body.appendChild(second.flow)
  second.register()
  await second.env.tick(); await second.env.tick()
  const toolRow2 = second.flow.querySelector('[data-chat-call-id]')
  assert(toolRow2 !== null && toolRow2.style.display === '', '重载后展开状态自动恢复（工具行可见）', 'display=' + (toolRow2 && toolRow2.style.display))
  const row2 = second.flow.querySelector('.dshcf-processed')
  assert(row2 !== null, '重载后已处理行存在')
  second.cleanup()
}

{
  console.log('\n=== T2-C：无持久化键时重载保持默认收起 ===')
  const first = boot()
  buildTurn(first.flow, 'c')
  first.document.body.appendChild(first.flow)
  first.register()
  await first.env.tick(); await first.env.tick()
  const row1 = first.flow.querySelector('.dshcf-processed')
  row1.dispatchEvent('click'); await first.env.tick(); await first.env.tick() // 展开
  row1.dispatchEvent('click'); await first.env.tick(); await first.env.tick() // 收起 → 键移除
  assert(expandedKeys().length === 0, '收起后无持久化键')
  first.cleanup()

  const second = boot({ keepLocalStorage: true })
  buildTurn(second.flow, 'c')
  second.document.body.appendChild(second.flow)
  second.register()
  await second.env.tick(); await second.env.tick()
  const toolRow2 = second.flow.querySelector('[data-chat-call-id]')
  assert(toolRow2 !== null && toolRow2.style.display === 'none', '无持久化键时重载保持收起（不误展开）', 'display=' + (toolRow2 && toolRow2.style.display))
  second.cleanup()
}

console.log('\nfold-persist: failures=' + failures)
if (failures > 0) process.exit(1)
