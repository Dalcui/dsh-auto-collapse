/**
 * fold-multi-flow.test.mjs — 「主会话列 + 右侧栏子代理会话列」同时可见时的回归测试。
 *
 * 背景（真机实测，DSH 0.2.0-rc.2）：子代理面板（[data-sidebar-chat]，槽位
 * sidebar.chat.conversation）里有一个**普通** [data-chat-flow] 外层列，与主会话列
 * 同时可见、互不遮挡。旧实现 fold.ts 的 findFlow() 只取「文档序第一个可见列」，
 * 且排除谓词 SUBAGENT_PANEL_SELECTOR（[data-slot*="subagent"] 等）在真机上
 * **0 命中**（DSH 根本没有带 subagent 字样的 data 属性）——于是子代理面板里
 * 100+ 条工具行全部平铺、永远拿不到 chip（用户报告的「子代理界面折叠失效」）。
 *
 * 覆盖：
 *   1) 两个 PLAIN 列同时存在时，**两列都**被服务（各自建控制器、各自折叠）；
 *   2) 子代理列（带 [data-sidebar-chat] 祖先）不再被排除谓词挡下；
 *   3) 两列的折叠账本互不干扰：操作一列不影响另一列；
 *   4) 一列消失（React 摘除）只还原该列，另一列的折叠保持不变；
 *   5) 子代理列不是「靠主列不可见才被折到」——主列可见时它也照常折叠。
 *
 * 用法：node test/fold-multi-flow.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

function boot() {
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
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration,toolCalls', statusText: '工作中...', keepLastRows: 3 }, base: {}, user: {}, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
  moduleExports.apply({ effect: (fn) => { cleanup = fn() }, settingsScope: { bind: () => scopeMock } })
  function register() {
    const seen = new Set(document._all)
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 1) { if (!seen.has(c)) { seen.add(c); document._all.push(c) } walk(c) }
      }
    }
    walk(document.body)
  }
  return { env, document, register, cleanup: () => { cleanup?.(); env.clearWrappers?.(); env.clearTimers() } }
}

function seat(flow, kind, key, h) {
  const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow)
  s.setRect({ height: h })
  return s
}
function addBodyText(node, value) {
  const r = el('div', { class: 'assistant-markdown-root' }, node)
  const b = el('div', { class: 'assistant-markdown-body' }, r)
  const md = el('div', { class: 'markdown' }, b)
  textNode(value, md)
}
/** 官方工具组：折叠链路的可见效果落在组头上（aria-expanded 被驱动为 false）。 */
function makeGroup(parent, turn, activity, open) {
  const group = el('div', {
    'data-step-process': 'true',
    'data-chat-group-key': 'g' + String(turn) + ':' + activity,
    'data-chat-turn': String(turn),
    class: 'O_Ebla_root',
  }, parent)
  const header = el('div', {}, group)
  const btn = el('button', { 'data-process-activity': activity, 'aria-expanded': String(open) }, header)
  const body = el('div', { 'data-step-process-body': 'true' }, group)
  if (!open) body.setAttribute('hidden', 'until-found')
  el('div', { 'data-step-process-content': 'true', 'data-chat-flow': '' }, body)
  return { group, btn, body }
}
/** 一个「可折叠」的会话列：3 个官方组（前 2 个进覆盖集）+ 最终正文 + tail + 原生行。 */
function buildColumn(parent, turn) {
  const flow = el('div', { 'data-chat-flow': '' }, parent)
  flow.offsetParent = {}
  flow.setRect({ width: 500, height: 400 })
  const u = seat(flow, 'user', `u${turn}`, 40); textNode('问题' + turn, u)
  const g1 = makeGroup(flow, turn, 'code', false)
  const g2 = makeGroup(flow, turn, 'read', false)
  const g3 = makeGroup(flow, turn, 'search', false)
  const a = seat(flow, 'assistant-step', `a${turn}`, 60); addBodyText(a, '最终正文' + turn)
  const tail = seat(flow, 'turn-tail', `tt${turn}`, 24); textNode('用时 5秒', tail)
  const tp = seat(flow, 'turn-process', `tp${turn}`, 33)
  el('button', { 'data-turn-process': String(turn), 'aria-expanded': 'false' }, tp)
  return { flow, g1, g2, g3, body: a, tp }
}

function foldedCount(col) {
  // 「折叠生效」的可观测证据：覆盖集组被驱动为收起（aria-expanded=false）
  // + 存在插件产出的段级 chip。
  const chips = col.flow.querySelectorAll('.dshcf-seg-chip').length
  const groupsCollapsed = [col.g1, col.g2].filter(g => g.btn.getAttribute('aria-expanded') === 'false').length
  return { chips, groupsCollapsed }
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 1: 双流（主列 + 右侧栏子代理列）都被服务 ===')
  const { env, document, register, cleanup } = boot()
  const mainWrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const main = buildColumn(mainWrap, 1)
  const sideWrap = el('div', { 'data-slot': 'rightbar' }, document.body)
  const tab = el('div', { 'data-slot': 'sidebar.right.pane.tab' }, sideWrap)
  const sc = el('div', { 'data-sidebar-chat': '' }, tab)
  const sideConv = el('div', { 'data-slot': 'sidebar.chat.conversation' }, sc)
  const side = buildColumn(sideConv, 1)

  register()
  await env.tick(); await env.tick()

  assert(
    side.flow.closest('[data-slot*="subagent"], [data-subagent-panel], [data-dsh-subagent]') === null,
    '复刻真机：子代理列对「含 subagent 字样的选择器」0 命中（旧排除谓词是死代码）',
  )
  const m = foldedCount(main)
  const s = foldedCount(side)
  assert(m.chips >= 1, '主列产出段级 chip', JSON.stringify(m))
  assert(s.chips >= 1, '子代理列也产出段级 chip（修复点：旧实现恒为 0）', JSON.stringify(s))
  assert(m.groupsCollapsed === 2, '主列覆盖集组被驱动为收起', JSON.stringify(m))
  assert(s.groupsCollapsed === 2, '子代理列覆盖集组也被驱动为收起', JSON.stringify(s))
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 2: 两列账本隔离（操作一列不影响另一列） ===')
  const { env, document, register, cleanup } = boot()
  const mainWrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const main = buildColumn(mainWrap, 1)
  const sideWrap = el('div', { 'data-slot': 'rightbar' }, document.body)
  const sc = el('div', { 'data-sidebar-chat': '' }, sideWrap)
  const side = buildColumn(sc, 1)
  register()
  await env.tick(); await env.tick()

  const mBefore = foldedCount(main)
  const sBefore = foldedCount(side)
  assert(mBefore.chips >= 1 && sBefore.chips >= 1, '两列先都折叠', JSON.stringify({ mBefore, sBefore }))

  // ★ 切会话：主列被 React 整体替换（旧列摘除 + 新列挂入）。共享单控制器时代，
  //   这一动作会走 switchFlow → restoreAllDisplays()，把**正在被服务的子代理列**
  //   折叠一起还原（跨列串台）。分列独立后子代理列的折叠必须原样保留。
  mainWrap.remove()
  const mainWrap2 = el('div', { 'data-slot': 'main.conversation' }, document.body)
  buildColumn(mainWrap2, 2)
  register()
  await env.tick(); await env.tick(); await env.tick()

  const sAfter = foldedCount(side)
  assert(!main.flow.isConnected, '主列旧流已摘除（切会话已发生）')
  assert(sAfter.chips >= 1, '子代理列 chip 未被主列切会话还原（账本隔离）', JSON.stringify(sAfter))
  assert(sAfter.groupsCollapsed === 2, '子代理列组收起态未被主列切会话动摇', JSON.stringify(sAfter))
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 3: 子代理列消失只还原自己 ===')
  const { env, document, register, cleanup } = boot()
  const mainWrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const main = buildColumn(mainWrap, 1)
  const sideWrap = el('div', { 'data-slot': 'rightbar' }, document.body)
  const sc = el('div', { 'data-sidebar-chat': '' }, sideWrap)
  const side = buildColumn(sc, 1)
  register()
  await env.tick(); await env.tick()
  const mBefore = foldedCount(main)
  const sBefore = foldedCount(side)
  assert(mBefore.chips >= 1 && sBefore.chips >= 1, '两列先都折叠', JSON.stringify({ mBefore, sBefore }))

  sideWrap.remove()
  register()
  await env.tick(); await env.tick(); await env.tick()

  const mAfter = foldedCount(main)
  assert(mAfter.chips >= 1 && mAfter.groupsCollapsed === 2, '主列折叠保留（子代理关闭不牵连主列）', JSON.stringify(mAfter))
  assert(!side.flow.isConnected, '子代理列已从文档摘除')
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 4: 对照——子代理列不是「主列不可见才被折到」 ===')
  const { env, document, register, cleanup } = boot()
  // 主列在前且始终可见；子代理列在后。旧实现下子代理列恒 0 chip。
  const mainWrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const main = buildColumn(mainWrap, 1)
  const sideWrap = el('div', { 'data-slot': 'rightbar' }, document.body)
  const sc = el('div', { 'data-sidebar-chat': '' }, sideWrap)
  const side = buildColumn(sc, 1)
  register()
  await env.tick(); await env.tick()
  assert(main.flow.offsetParent !== null, '主列可见（未走「主列不可见」的兜底路径）')
  assert(foldedCount(side).chips >= 1, '主列可见时子代理列仍被折叠（非兜底侥幸）', JSON.stringify(foldedCount(side)))
  cleanup()
}

console.log('\n[DONE] failures=' + failures)
process.exit(failures === 0 ? 0 : 1)
