/**
 * fold-record.test.mjs — 需求 5/8/1 的记录级路径回归。
 * 注入器（React shadow 渲染器）在 fake-dom 里不安装，本测试通过手工放置
 * data-turn-tail / data-dshcf-session / data-dshcf-turn / data-dshcf-turn-metrics
 * 属性，驱动 fold.ts 走「记录级」指标读取路径，验证：
 *  1. 耗时优先取记录 durationMs（覆盖 DOM「用时」文本）
 *  2. turn 归属优先 data-turn-tail
 *  3. 首轮 contextDelta = 本回合末输入（基线 0）
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

function boot(summaryFields) {
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
  console.log('\n=== 记录级路径：耗时优先 durationMs、首轮 contextDelta 基线0、turn 归属 data-turn-tail ===')
  const { env, document, flow, register, cleanup } = boot('duration,contextDelta')
  seat(flow, 'user', 'u1', 40)
  const t1 = seat(flow, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30)
  makeToolRow({ callId: 'call:2', tool: 'grep', summary: 'b', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'f1', 100)
  addBodyText(fin, '最终正文')
  // 注入器等效产物：shadow host 上的 data-dshcf-*（含记录级 durationMs=12000 与 lastModelInputTokens=8000）
  el('div', {
    'data-dshcf-turn-metrics': JSON.stringify({ durationMs: 12000, toolCalls: 2, modelCalls: 1, inputTokens: 8000, lastModelInputTokens: 8000 }),
    'data-dshcf-turn': '1',
    'data-dshcf-session': 'sess-x',
  }, fin)
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  const tailInner = el('div', { 'data-turn-tail': '1' }, tail)
  textNode('用时 5秒', tailInner)   // 故意给 DOM 用时 5 秒，应被记录 12 秒覆盖
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '闭合后生成一级行')
  const label = row?.firstElementChild?.textContent ?? ''
  assert(label.includes('12秒'), '耗时取记录 durationMs=12秒（覆盖 DOM 用时5秒）', 'label=' + label)
  assert(!label.includes('5秒'), '不显示 DOM 用时 5秒', 'label=' + label)
  assert(label.includes('8.0K'), '首轮 contextDelta=8.0K（基线0，等于本回合末输入）', 'label=' + label)
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
