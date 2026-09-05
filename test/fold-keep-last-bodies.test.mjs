/**
 * fold-keep-last-bodies.test.mjs — 「轮次折叠保留最后 N 条正文」回归测试。
 *
 * 覆盖：
 *   1) 默认 keepLastBodySteps=1：轮次折叠只保留最终正文，中间正文折叠；
 *   2) keepLastBodySteps=2：最后 2 条正文保留可见，更早正文折叠；
 *   3) keepLastBodySteps=0 且存在多个轮次：非最后轮次全部正文（含最终正文）
 *      折叠进轮次行；最后一个轮次仍至少保留 1 条（finalStep）；
 *   4) keepLastBodySteps=0 且只有一轮：该轮即最后轮次，最终正文保留；
 *   5) keepLastBodySteps=0 且尾部只有空 user 段：最后一条正文所在轮次仍保留；
 *   6) 展开轮次行后中间正文恢复可见（可再展开）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeThinkRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

function boot(keepLastBodySteps = 1) {
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
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration', statusText: 'Deep sleeping...', keepLastRows: 3, keepLastBodySteps }, base: {}, user: {}, writable: true }),
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
function addThinkRow(seatEl, summary, state = 'ok') {
  const md = seatEl.querySelector('.assistant-markdown-root') ?? el('div', { class: 'assistant-markdown-root' }, seatEl)
  const b = md.querySelector('.assistant-markdown-body') ?? el('div', { class: 'assistant-markdown-body' }, md)
  return makeThinkRow({ state, summary, parent: b })
}
function tail(flow, key) {
  const t = seat(flow, 'turn-tail', key, 24)
  textNode('用时 10秒', t)
  return t
}
function user(flow, key) {
  const u = seat(flow, 'user', key, 40)
  textNode('继续', u)
  return u
}
const visible = (elx) => elx.style.display === ''

{
  console.log('\n=== 场景 1: 默认 keep=1——只保留最终正文 ===')
  const { env, document, flow, register, cleanup } = boot(1)
  user(flow, 'u1')
  const b1 = seat(flow, 'assistant-step', 'b1', 60); addBodyText(b1, '中间正文一')
  const b2 = seat(flow, 'assistant-step', 'b2', 60); addBodyText(b2, '中间正文二')
  const b3 = seat(flow, 'assistant-step', 'b3', 80); addBodyText(b3, '最终正文')
  tail(flow, 'tt1')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const rows = flow.querySelectorAll('.dshcf-processed')
  assert(rows.length === 1, '闭合回合生成一个已处理行', 'rows=' + rows.length)
  assert(b1.style.display === 'none', '中间正文一折叠', 'b1=' + b1.style.display)
  assert(b2.style.display === 'none', '中间正文二折叠', 'b2=' + b2.style.display)
  assert(visible(b3), '最终正文保留可见', 'b3=' + b3.style.display)
  rows[0].dispatchEvent('click')
  await env.tick()
  assert(visible(b1) && visible(b2), '展开轮次行后中间正文恢复', JSON.stringify([b1.style.display, b2.style.display]))
  cleanup()
}

{
  console.log('\n=== 场景 2: keep=2——最后两条正文保留，更早正文折叠 ===')
  const { env, document, flow, register, cleanup } = boot(2)
  user(flow, 'u1')
  const b1 = seat(flow, 'assistant-step', 'b1', 60); addBodyText(b1, '最早正文')
  const b2 = seat(flow, 'assistant-step', 'b2', 60); addBodyText(b2, '倒数第二')
  const b3 = seat(flow, 'assistant-step', 'b3', 80); addBodyText(b3, '最终正文')
  tail(flow, 'tt1')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(b1.style.display === 'none', '最早正文折叠', 'b1=' + b1.style.display)
  assert(visible(b2), '倒数第二条正文保留可见', 'b2=' + b2.style.display)
  assert(visible(b3), '最终正文保留可见', 'b3=' + b3.style.display)
  cleanup()
}

{
  console.log('\n=== 场景 3: keep=0 两轮——前轮全折叠（含最终正文），最后轮保留最终正文 ===')
  const { env, document, flow, register, cleanup } = boot(0)
  user(flow, 'u1')
  const t1a = seat(flow, 'assistant-step', 't1a', 60); addBodyText(t1a, '轮1中间正文')
  const t1b = seat(flow, 'assistant-step', 't1b', 80); addBodyText(t1b, '轮1最终正文')
  tail(flow, 'tt1')
  user(flow, 'u2')
  const t2a = seat(flow, 'assistant-step', 't2a', 60); addBodyText(t2a, '轮2中间正文')
  const t2b = seat(flow, 'assistant-step', 't2b', 80); addBodyText(t2b, '轮2最终正文')
  tail(flow, 'tt2')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const rows = flow.querySelectorAll('.dshcf-processed')
  assert(rows.length === 2, '两个闭合回合各生成已处理行', 'rows=' + rows.length)
  assert(t1a.style.display === 'none', '轮1中间正文折叠', 't1a=' + t1a.style.display)
  assert(t1b.style.display === 'none', '轮1最终正文也折叠（非最后轮次）', 't1b=' + t1b.style.display)
  assert(t2a.style.display === 'none', '轮2中间正文折叠', 't2a=' + t2a.style.display)
  assert(visible(t2b), '轮2最终正文保留（最后轮次最小 1）', 't2b=' + t2b.style.display)
  // 展开轮1行 → 轮1正文恢复
  rows[0].dispatchEvent('click')
  await env.tick()
  assert(visible(t1a) && visible(t1b), '展开轮1行后轮1正文恢复', JSON.stringify([t1a.style.display, t1b.style.display]))
  cleanup()
}

{
  console.log('\n=== 场景 4: keep=0 单轮——该轮即最后轮次，最终正文保留 ===')
  const { env, document, flow, register, cleanup } = boot(0)
  user(flow, 'u1')
  const b1 = seat(flow, 'assistant-step', 'b1', 60); addBodyText(b1, '中间正文')
  const b2 = seat(flow, 'assistant-step', 'b2', 80); addBodyText(b2, '最终正文')
  tail(flow, 'tt1')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(b1.style.display === 'none', '中间正文折叠', 'b1=' + b1.style.display)
  assert(visible(b2), '唯一轮次的最终正文保留（最小 1）', 'b2=' + b2.style.display)
  cleanup()
}

{
  console.log('\n=== 场景 5: keep=0 且尾部空 user 段——最后正文所在轮次仍保留 ===')
  const { env, document, flow, register, cleanup } = boot(0)
  user(flow, 'u1')
  const b1 = seat(flow, 'assistant-step', 'b1', 60); addBodyText(b1, '中间正文')
  const b2 = seat(flow, 'assistant-step', 'b2', 80); addBodyText(b2, '最终正文')
  tail(flow, 'tt1')
  user(flow, 'u2') // 新 user 尚无任何助手输出
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(b1.style.display === 'none', '中间正文折叠', 'b1=' + b1.style.display)
  assert(visible(b2), '尾部空 user 段不算轮次：最终正文所在轮次仍保留最小 1', 'b2=' + b2.style.display)
  cleanup()
}

{
  console.log('\n=== 场景 6: keep=0 时保留正文的 think 行仍折叠（宿主可见、行收起） ===')
  const { env, document, flow, register, cleanup } = boot(0)
  user(flow, 'u1')
  const b1 = seat(flow, 'assistant-step', 'b1', 60)
  const think = addThinkRow(b1, '先思考')
  addBodyText(b1, '带思考的最终正文')
  tail(flow, 'tt1')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  // 单轮 = 最后轮次：宿主（正文）保留可见，其内 think 行仍被二级折叠
  assert(visible(b1), '最后轮次宿主正文保留可见', 'b1=' + b1.style.display)
  const thinkRow = b1.querySelector('[data-variant="think"]')
  assert(thinkRow !== null && thinkRow.style.display === 'none', '保留正文内的 think 行仍折叠进 chip', 'think=' + (thinkRow?.style.display ?? 'null'))
  assert(think !== undefined, 'think 行已创建')
  cleanup()
}

{
  console.log('\n=== 场景 7: 无 user 边界 + keep=0——收起态已处理行保持可见（展开入口不丢） ===')
  const { env, document, flow, register, cleanup } = boot(0)
  // 两段均无 user/steering 开头（历史收尾段/无 user 头恢复场景）
  const t1 = seat(flow, 'assistant-step', 't1', 60)
  addThinkRow(t1, '轮1思考')
  addBodyText(t1, '轮1正文')
  tail(flow, 'tt1')
  const t2 = seat(flow, 'assistant-step', 't2', 60)
  addThinkRow(t2, '轮2思考')
  addBodyText(t2, '轮2正文')
  tail(flow, 'tt2')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick(); await env.tick(); await env.tick()
  const rows = flow.querySelectorAll('.dshcf-processed')
  assert(rows.length === 2, '两段各保留已处理行（含全折叠的非最后段）', 'rows=' + rows.length)
  assert(t1.style.display === 'none', '轮1正文（非最后轮次）折叠', 't1=' + t1.style.display)
  assert(visible(t2), '轮2正文（最后轮次）保留', 't2=' + t2.style.display)
  // 多 pass 后已处理行不被移除（placeProcessedRow 清理守卫回归）
  await env.tick(); await env.tick()
  const rows2 = flow.querySelectorAll('.dshcf-processed')
  assert(rows2.length === 2 && rows2[0].isConnected === true, '多 pass 后两行仍连接（展开入口不丢）', 'rows=' + rows2.length)
  rows2[0].dispatchEvent('click')
  await env.tick()
  assert(visible(t1), '展开轮1行后正文恢复', 't1=' + t1.style.display)
  cleanup()
}

{
  console.log('\n=== 场景 8: keep=0 无 user 边界 + 外部隐藏最后轮保留正文 → 该段孤立行移除 ===')
  const { env, document, flow, register, cleanup } = boot(0)
  const t1 = seat(flow, 'assistant-step', 't1', 60)
  addThinkRow(t1, '轮1思考')
  addBodyText(t1, '轮1正文')
  tail(flow, 'tt1')
  const t2 = seat(flow, 'assistant-step', 't2', 60)
  addThinkRow(t2, '轮2思考')
  addBodyText(t2, '轮2正文')
  tail(flow, 'tt2')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 2, '初始两行', 'rows=' + flow.querySelectorAll('.dshcf-processed').length)
  // 外部隐藏最后轮保留的正文（非插件控制）→ 段 2 无可见工作 → 孤立行移除；
  // 段 1（全部插件自身隐藏）的行仍保留。
  t2.style.display = 'none'
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '外部隐藏后只保留插件全折叠段的行', 'rows=' + flow.querySelectorAll('.dshcf-processed').length)
  assert(t2.style.display === 'none', '外部隐藏样式不被插件恢复', 't2=' + t2.style.display)
  t2.style.display = ''
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 2, '解除外部隐藏后两行恢复', 'rows=' + flow.querySelectorAll('.dshcf-processed').length)
  cleanup()
}

{
  console.log('\n=== 场景 9: keep=0 展开态 + 外部隐藏整段 → 孤立行移除、解除后恢复 ===')
  const { env, document, flow, register, cleanup } = boot(0)
  user(flow, 'u1')
  const b1 = seat(flow, 'assistant-step', 'b1', 60); addBodyText(b1, '中间正文')
  const b2 = seat(flow, 'assistant-step', 'b2', 80); addBodyText(b2, '最终正文')
  tail(flow, 'tt1')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  let row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '初始一行', 'row=' + row)
  row.dispatchEvent('click') // 展开
  await env.tick()
  // 展开态下外部隐藏 user + 全部正文 → 无可见工作 → 孤立行移除
  const u1 = flow.querySelector('[data-chat-flow-kind="user"]')
  u1.style.display = 'none'
  b1.style.display = 'none'
  b2.style.display = 'none'
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 0, '展开态外部隐藏后孤立行移除', 'rows=' + flow.querySelectorAll('.dshcf-processed').length)
  assert(b2.style.display === 'none' && b1.style.display === 'none', '外部隐藏样式不被恢复', JSON.stringify([b1.style.display, b2.style.display]))
  u1.style.display = ''
  b1.style.display = ''
  b2.style.display = ''
  await env.tick(); await env.tick()
  row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '解除外部隐藏后行恢复', 'row=' + row)
  assert(visible(b2), 'final 正文恢复可见', 'b2=' + b2.style.display)
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
