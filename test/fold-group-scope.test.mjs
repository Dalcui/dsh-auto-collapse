/**
 * fold-group-scope.test.mjs — 「分组 = 折叠指标行作用域」回归测试（需求：轮次折叠的
 * 分组与所有指标统计的分组保持一致，统一按折叠指标行所在位置分割分组）。
 *
 * 覆盖：
 *   1) compact 模式（原生 turn-process 折叠指标行覆盖整回合）+ 插话：原生行读到的是
 *      **整回合作用域**指标（回合聚合），不是最后一段的段级数字；两段都不再各自写行；
 *   2) normal 模式（插件自建一级行）+ 插话：每段读自己的**段作用域**指标，回合级
 *      兜底（turn-tail 文本「用时 X秒」）不套到段级行上（各自独立、不重复）；
 *   3) 无插话的单分组回合：段作用域即整回合（回合计时 + 回合级用量生效）；
 *   4) 段作用域行即使 DOM 上存在整回合属性也不读它（作用域互斥）。
 *
 * 用法：node test/fold-group-scope.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeRetryRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

function boot(fields = 'duration,toolCalls') {
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
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: fields, statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }),
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

function seat(flow, kind, key, h = 26) {
  const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow)
  s.setRect({ height: h })
  return s
}
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, body))
}
/** 原生 turn-process 折叠指标行：seat + button[data-turn-process]（label + chevron）。 */
function nativeDisclosure(flow, turn) {
  const tp = seat(flow, 'turn-process', 'tp' + turn, 24)
  const btn = el('button', { 'data-turn-process': String(turn), 'aria-expanded': 'false' }, tp)
  el('span', { class: 'label', text: '3 次工具调用' }, btn)
  el('svg', { class: 'chevron' }, btn)
  return btn
}
/** 注入器等效产物：真实 DOM 里 wrapper 是 assistant-step 座位**内部**的子元素
 * （data-dshcf-* 写在它上面）。模块级 Map 在 fake-dom 里不存在，fold 走 DOM 属性
 * 兜底路径 —— 正是本节要验证的作用域选择。 */
function injectMetrics(parent, attrs) {
  return el('div', attrs, parent)
}

// 插话切分的回合夹具：段A（2 工具）→ steering → 段B（1 工具）→ 正文 → turn-tail。
function buildSteeredTurn(flow, withNativeRow) {
  seat(flow, 'user', 'u1', 40)
  if (withNativeRow) nativeDisclosure(flow, 1)
  const a1 = seat(flow, 'tool-call', 'a1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: a1 })
  const a2 = seat(flow, 'tool-call', 'a2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: a2 })
  seat(flow, 'steering', 'st1', 40)
  const b1 = seat(flow, 'tool-call', 'b1', 30); makeToolRow({ callId: 'call:3', tool: 'grep', summary: 'c', parent: b1 })
  const fin = seat(flow, 'assistant-step', 'fin', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  tail.setAttribute('data-turn-tail', '1')
  return { a1, a2, b1, fin, tail }
}

{
  console.log('\n=== 场景 1: compact 模式 + 插话 → 原生折叠指标行读整回合作用域 ===')
  const { env, document, flow, register, cleanup } = boot()
  const { fin } = buildSteeredTurn(flow, true)
  // 段B（seg1）的段级条目：1 次工具、耗时 3 秒；整回合条目：3 次工具、耗时 9 秒。
  injectMetrics(fin, {
    'data-dshcf-turn-metrics': JSON.stringify({ durationMs: 3000, toolCalls: 1 }),
    'data-dshcf-turn-scope-metrics': JSON.stringify({ durationMs: 9000, toolCalls: 3 }),
    'data-dshcf-turn': '1', 'data-dshcf-session': 'sess-g', 'data-dshcf-seg': '1',
  })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 0, '原生折叠指标行存在时两段都不建自建一级行', 'rows=' + flow.querySelectorAll('.dshcf-processed').length)
  const span = flow.querySelector('.dshcf-native-metrics')
  const text = span?.textContent ?? ''
  assert(span !== null, '指标摘要挂进原生折叠指标行')
  assert(text.includes('3次工具调用'), '原生行显示整回合工具数 3（不是最后一段的 1）', 'text=' + text)
  assert(text.includes('9秒'), '原生行显示整回合耗时 9秒（不是段级 3秒）', 'text=' + text)
  assert(!text.includes('5秒') && !text.includes('3秒') && !text.includes('1次工具调用'), '整回合作用域条目覆盖段级/回合级文本兜底', 'text=' + text)
  cleanup()
}

{
  console.log('\n=== 场景 2: normal 模式 + 插话 → 自建一级行各读自己的段作用域 ===')
  const { env, document, flow, register, cleanup } = boot()
  const { a2, b1, fin } = buildSteeredTurn(flow, false)
  // 段A（seg0）条目：1 次工具、耗时 2 秒；段B（seg1）条目：2 次工具、耗时 4 秒。
  injectMetrics(a2, {
    'data-dshcf-turn-metrics': JSON.stringify({ durationMs: 2000, toolCalls: 1 }),
    'data-dshcf-turn-scope-metrics': JSON.stringify({ durationMs: 9000, toolCalls: 3 }),
    'data-dshcf-turn': '1', 'data-dshcf-session': 'sess-g', 'data-dshcf-seg': '0',
  })
  injectMetrics(b1, {
    'data-dshcf-turn-metrics': JSON.stringify({ durationMs: 4000, toolCalls: 2 }),
    'data-dshcf-turn-scope-metrics': JSON.stringify({ durationMs: 9000, toolCalls: 3 }),
    'data-dshcf-turn': '1', 'data-dshcf-session': 'sess-g', 'data-dshcf-seg': '1',
  })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const rows = [...flow.querySelectorAll('.dshcf-processed')]
  assert(rows.length === 2, '插话切分两段各生成一级行', 'rows=' + rows.length)
  const t0 = rows[0]?.textContent ?? ''
  const t1 = rows[1]?.textContent ?? ''
  assert(t0.includes('1次工具调用') && t0.includes('2秒'), '段A行 = 段A作用域（1 次工具调用 / 2秒）', 't0=' + t0)
  assert(t1.includes('2次工具调用') && t1.includes('4秒'), '段B行 = 段B作用域（2 次工具调用 / 4秒）', 't1=' + t1)
  assert(!t0.includes('5秒') && !t1.includes('5秒'), '回合级文本「用时 5秒」不套到段级行（不重复统计）', 't0=' + t0 + ' | t1=' + t1)
  assert(!t0.includes('3次工具调用') && !t1.includes('3次工具调用'), '段级行不读整回合属性（作用域互斥）', 't0=' + t0 + ' | t1=' + t1)
  cleanup()
}

{
  console.log('\n=== 场景 3: 无插话的单分组回合 → 段作用域即整回合（回合级兜底生效） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'fin', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  tail.setAttribute('data-turn-tail', '1')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  const text = row?.textContent ?? ''
  assert(row !== null && text.includes('5秒'), '单分组回合：回合级「用时 5秒」照常兜底', 'text=' + text)
  cleanup()
}

{
  console.log('\n=== 场景 4: steering 排队但该段无内容 → 不构成分组，回合级兜底照常生效 ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'fin', 100); addBodyText(fin, '最终正文')
  seat(flow, 'steering', 'st1', 40)
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  tail.setAttribute('data-turn-tail', '1')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const rows = [...flow.querySelectorAll('.dshcf-processed')]
  const text = rows.map(r => r.textContent ?? '').join(' || ')
  assert(rows.length >= 1 && text.includes('5秒'), 'steering 后的空段不算分组 → 唯一分组覆盖整回合、回合级耗时照常显示', 'rows=' + rows.length + ' text=' + text)
  cleanup()
}

{
  console.log('\n=== 场景 5: 插话后段内只有状态行（model-retry）→ 不构成分组，与指标侧口径一致 ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1', 40)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'fin', 100); addBodyText(fin, '最终正文')
  const retry = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/3）', parent: retry })
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  tail.setAttribute('data-turn-tail', '1')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const rows = [...flow.querySelectorAll('.dshcf-processed')]
  const text = rows.map(r => r.textContent ?? '').join(' || ')
  // 该段只有一条状态行（无块宿主、无正文步）→ 不是「有内容的分组」（指标侧
  // buildTurnGroupMetrics 同样只在 hasContent 的分组上计分组数）→ 回合仍是单分组，
  // 回合级「用时 5秒」照常兜底，且不会把回合耗时错摊成两份。
  assert(rows.length === 1 && text.includes('5秒'), '仅状态行的段不构成分组 → 单分组回合耗时照常（不重复统计）', 'rows=' + rows.length + ' text=' + text)
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
