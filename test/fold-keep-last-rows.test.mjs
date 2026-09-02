/**
 * fold-keep-last-rows.test.mjs — R9「进行中尾行保留」+「正在思考修复」回归测试。
 *
 * 覆盖：
 *   1) keepLastRows 默认 3：进行中回合最后 3 个系统提示行保留原生可见，更早的行才折叠；
 *   2) keepLastRows=0：不保留任何系统行（含 running 行，全部折叠）；
 *   3) 运行中思考不再镜像「正在思考」+ 实时思考内容到 chip（修掉与原生行重复刷新）；
 *   4) think 行 data-state 缺失/滞后时，[data-follow-end] 兜底仍识别为 running（不误折叠）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeThinkRow, makeToolRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

function boot(keepLastRows = 3) {
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
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration', statusText: 'Deep sleeping...', keepLastRows }, base: {}, user: {}, writable: true }),
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
// 在同一个 assistant-step 里放一个 think 行（供同一块内多思考行测试）
function addThinkRow(seatEl, summary, state = 'ok', followEnd = false) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const b = el('div', { class: 'assistant-markdown-body' }, md)
  return makeThinkRow({ state, summary, followEnd: followEnd || state === 'running', parent: b })
}
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, body))
}

{
  console.log('\n=== 场景 1: keepLastRows 默认 3——进行中最后 3 个系统行保留、更早行折叠 ===')
  const { env, document, flow, register, cleanup } = boot(3)
  seat(flow, 'user', 'u1', 40); textNode('多步推理', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  const think1 = addThinkRow(s1, '第一步', 'ok')
  const think2 = addThinkRow(s1, '第二步', 'ok')
  const think3 = addThinkRow(s1, '第三步', 'ok')
  const think4 = addThinkRow(s1, '第四步', 'running')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '进行中生成二级 chip')
  // 最后 3 个系统行（第二步/第三步/第四步）保留可见，仅第一步折叠。
  assert(think1.style.display === 'none', '更早的 think1 折叠进 chip', 'think1=' + think1.style.display)
  assert(think2.style.display === '', 'think2（尾行内）保留可见', 'think2=' + think2.style.display)
  assert(think3.style.display === '', 'think3（尾行内）保留可见', 'think3=' + think3.style.display)
  assert(think4.style.display === '', 'running think4 保留可见', 'think4=' + think4.style.display)
  const text = chip?.textContent ?? ''
  assert(text.includes('已思考') && text.includes('1 段思考'), 'chip 只统计折叠的已完成思考（1 段思考）', 'text=' + text)
  cleanup()
}

{
  console.log('\n=== 场景 2: keepLastRows=0——不保留任何系统行（含 running 行） ===')
  const { env, document, flow, register, cleanup } = boot(0)
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThinkRow(s1, '先思考', 'ok')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: 'running', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '进行中生成二级 chip')
  assert(chip.textContent.includes('正在运行'), 'chip 标题为正在运行', 'text=' + chip.textContent)
  const think = s1.querySelector('[data-variant="think"]')
  const tool = t1.querySelector('[data-chat-call-id]')
  assert(think.style.display === 'none', '已完成 think 折叠进 chip', 'think=' + think.style.display)
  assert(tool.style.display === 'none', 'keep=0 时 running 工具行也折叠（不保留）', 'tool=' + tool.style.display)
  cleanup()
}

{
  console.log('\n=== 场景 3: 运行中思考不镜像「正在思考」+ 实时内容 ===')
  const { env, document, flow, register, cleanup } = boot(1)
  seat(flow, 'user', 'u1', 40); textNode('想问题', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  addThinkRow(s1, '先想一点', 'ok')
  addThinkRow(s1, '正在想的实时内容', 'running')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '进行中生成二级 chip')
  const text = chip?.textContent ?? ''
  assert(!text.includes('正在思考'), 'chip 不再镜像「正在思考」标题', 'text=' + text)
  assert(!text.includes('正在想的实时内容'), 'chip 不再镜像实时思考内容', 'text=' + text)
  assert(text.includes('已思考') && text.includes('1 段思考'), 'chip 显示已完成折叠计数（已思考 · 1 段思考）', 'text=' + text)
  // running think 行仍由原生行承载
  const rows = s1.querySelectorAll('[data-variant="think"]')
  const runningRow = [...rows].find(r => (r.textContent ?? '').includes('正在想的实时内容'))
  assert(runningRow !== undefined && runningRow.style.display === '', 'running think 行原生可见（实时思考只由原生行显示）', 'row=' + (runningRow?.style.display ?? 'null'))
  cleanup()
}

{
  console.log('\n=== 场景 4: data-follow-end 兜底——state 缺失仍识别为 running 不误折叠 ===')
  const { env, document, flow, register, cleanup } = boot(1)
  seat(flow, 'user', 'u1', 40); textNode('想问题', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  addThinkRow(s1, '第一步', 'ok')
  // data-state 缺省（null）但带 [data-follow-end]：模拟宿主 data-state 缺失/滞后，
  // 实时锚点仍在——兜底应识别为 running、保留可见。
  const live = addThinkRow(s1, '还在想', 'ok', true)
  live.removeAttribute('data-state')
  addThinkRow(s1, '第三步', 'ok')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  // live 行虽 data-state 缺省，但含 data-follow-end → 按 running 保留可见（不折叠）
  assert(live.style.display === '', 'data-follow-end 行按 running 保留可见（不误折叠）', 'live=' + live.style.display)
  const first = s1.querySelectorAll('[data-variant="think"]')[0]
  assert(first.style.display === 'none', '更早的已完成 think 折叠进 chip', 'first=' + first.style.display)
  // P2-1：兜底识别为 running 的行必须同样从计数中排除（不虚增 thinkCount）
  const chip = flow.querySelector('.dshcf-chip')
  const text = chip?.textContent ?? ''
  assert(text.includes('已思考') && text.includes('1 段思考') && !text.includes('2 段思考'), 'chip 计数排除 data-follow-end 行（恰 1 段思考）', 'text=' + text)
  cleanup()
}

{
  console.log('\n=== 场景 5: 尾行全保留的纯思考块不出空 chip（P3） ===')
  const { env, document, flow, register, cleanup } = boot(3)
  seat(flow, 'user', 'u1', 40); textNode('想问题', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  addThinkRow(s1, '先想一点', 'ok')
  const running = addThinkRow(s1, '正在想', 'running')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  // keepLastRows=3 覆盖全部 2 行 → 无折叠行、无 running 工具 → 不出空 chip，原生展示
  assert(flow.querySelector('.dshcf-chip') === null, '尾行全保留的纯思考块不出空 chip', 'chip=' + (flow.querySelector('.dshcf-chip')?.textContent ?? 'null'))
  assert(running.style.display === '', 'running think 原生可见', 'running=' + running.style.display)
  const first = s1.querySelectorAll('[data-variant="think"]')[0]
  assert(first.style.display === '', '已完成 think（尾行内）也保留原生可见', 'first=' + first.style.display)
  cleanup()
}

{
  console.log('\n=== 场景 6: 尾行全保留且有 running 工具但无被折叠行 → 不出 chip ===')
  const { env, document, flow, register, cleanup } = boot(3)
  seat(flow, 'user', 'u1', 40); textNode('跑命令', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThinkRow(s1, '先想一点', 'ok')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', state: 'running', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  // keepLastRows=3 覆盖全部 2 行：无任何被折叠行 → 不再显示「正在运行」折叠行
  // （折叠行只在确有被折叠行时出现；running 工具行本身原生可见，无需 chip 兼作状态头）。
  assert(flow.querySelector('.dshcf-chip') === null, '无被折叠行时不出现折叠行（chip）', 'chip=' + (flow.querySelector('.dshcf-chip')?.textContent ?? 'null'))
  const think = s1.querySelector('[data-variant="think"]')
  assert(think.style.display === '', '尾行内已完成 think 保留原生可见', 'think=' + think.style.display)
  const tool = t1.querySelector('[data-chat-call-id]')
  assert(tool !== null && tool.style.display === '', 'running 工具行保留原生可见', 'tool=' + (tool?.style.display ?? 'null'))
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
