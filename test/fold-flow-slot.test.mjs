/**
 * fold-flow-slot.test.mjs — DSH 0.2.1 新增流扩展位（[data-slot="conversation.chat.flow"]）的回归测试。
 *
 * 背景（真机实测，DSH 0.2.1-rc.2）：官方把会话列 [data-chat-flow] 的**全部流子级**
 * 包进一个扩展位 <div data-slot="conversation.chat.flow" style="display:contents">，
 * 并列读取顶层行时同口径解包（chat 0.2.1 CHAT:2081 / CHAT:2226：
 *   (elements.column.querySelector(':scope > [data-slot="conversation.chat.flow"]') ?? elements.column).children
 * ）。
 *
 * 插件若不跟着解包，`flowItems(column)` 只能看到 [加载更早, slot] 两项：
 *   - 整段会话被当成**一个巨型块**（真机：5 个回合只出 1 个 chip，摘要横跨全会话）；
 *   - 段的 boundary/finalStep 全为空 → 指标键 (turn/sessionId) 取不到 →
 *     **原生 turn-process 行上的指标注入整体失效**（真机：.dshcf-native-metrics = 0）；
 *   - 扩展位本身是 display:contents（无布局盒），`isFlowVisible` 若只测它自己
 *     会判定所有列「不可见」→ findFlow() 退化成文档序第一个候选（多列串台）。
 *
 * 覆盖：
 *   1) 官方新结构（扩展位）下照常折叠：段级 chip 产出 + 覆盖集组被驱动收起；
 *   2) 扩展位结构下指标能挂到原生 turn-process 行上；
 *   3) 多个「扩展位列」同时存在时，每一列都被服务（不因 display:contents 被判不可见）；
 *   4) 旧结构（无扩展位）保持原行为（向后兼容，不能因新结构改动而回归）；
 *   5) 扩展位里的插件节点不会落进官方二分序列（chip 只挂 turn-process 座位内）。
 *
 * 用法：node test/fold-flow-slot.test.mjs
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

/**
 * 造一个 0.2.1 形态的会话列：[@加载更早, [data-slot=conversation.chat.flow]]
 * 真正的流内容全部挂在扩展位内部。
 */
function buildColumn021(parent, turn) {
  const column = el('div', { 'data-chat-flow': '' }, parent)
  // ★ 关键复刻：列自身**不再持有**流子级，全部搬进扩展位。
  const slot = el('div', { 'data-slot': 'conversation.chat.flow' }, column)
  // 真机扩展位是 display:contents（无布局盒）：rect 全 0、offsetParent=null。
  slot.setRect({ width: 0, height: 0 })
  slot.offsetParent = null
  column.setRect({ width: 680, height: 900 })
  column.offsetParent = {}

  const u = seat(slot, 'user', 'u' + turn, 40)
  textNode('问题' + turn, u)
  // ★ 真机顺序（0.2.1 实测）：turn-process 座位排在该回合的**最前面**，
  // 之后才是工具组 / 正文 / turn-tail。fixture 必须同序，否则段键与原生行
  // 归属对不上（会把原生行算到下一段里）。
  const tp = seat(slot, 'turn-process', 'tp' + turn, 33)
  tp.setAttribute('data-chat-turn', String(turn))
  el('button', { 'data-turn-process': String(turn), 'aria-expanded': 'false' }, tp)
  const g1 = makeGroup(slot, turn, 'code', false)
  const g2 = makeGroup(slot, turn, 'read', false)
  const g3 = makeGroup(slot, turn, 'search', false)
  const a = seat(slot, 'assistant-step', 'a' + turn, 60)
  addBodyText(a, '最终正文' + turn)
  const tail = seat(slot, 'turn-tail', 'tt' + turn, 24)
  tail.setAttribute('data-turn-tail', String(turn))
  textNode('用时 5秒', tail)
  return { column, slot, g1, g2, g3, body: a, tp, tail }
}

/** 旧结构（0.2.0 及更早）：流子级直接挂在 [data-chat-flow] 上。 */
function buildColumnLegacy(parent, turn) {
  const flow = el('div', { 'data-chat-flow': '' }, parent)
  flow.setRect({ width: 500, height: 400 })
  flow.offsetParent = {}
  const u = seat(flow, 'user', 'u' + turn, 40)
  textNode('问题' + turn, u)
  const g1 = makeGroup(flow, turn, 'code', false)
  const g2 = makeGroup(flow, turn, 'read', false)
  const g3 = makeGroup(flow, turn, 'search', false)
  const a = seat(flow, 'assistant-step', 'a' + turn, 60)
  addBodyText(a, '最终正文' + turn)
  const tail = seat(flow, 'turn-tail', 'tt' + turn, 24)
  textNode('用时 5秒', tail)
  const tp = seat(flow, 'turn-process', 'tp' + turn, 33)
  el('button', { 'data-turn-process': String(turn), 'aria-expanded': 'false' }, tp)
  return { flow, g1, g2, g3, body: a, tp }
}

function stats(mod) {
  const scope = mod.slot ?? mod.flow
  return {
    chips: scope.querySelectorAll('.dshcf-seg-chip').length,
    groupsCollapsed: [mod.g1, mod.g2].filter(g => g.btn.getAttribute('aria-expanded') === 'false').length,
  }
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 1: 0.2.1 扩展位结构下照常折叠 ===')
  const { env, document, register, cleanup } = boot()
  const wrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const col = buildColumn021(wrap, 1)
  register()
  await env.tick(); await env.tick()

  const s = stats(col)
  assert(s.chips >= 1, '扩展位结构下产出段级 chip（修复点：解包前恒为 0）', JSON.stringify(s))
  assert(s.groupsCollapsed === 2, '覆盖集组被驱动为收起（前 2 组收起）', JSON.stringify(s))
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 2: 扩展位结构下指标挂到原生 turn-process 行 ===')
  const { env, document, register, cleanup } = boot()
  const wrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const col = buildColumn021(wrap, 1)
  // 注入一个指标 host 到 assistant-step 座位内部（复刻 shadow 渲染器产物）。
  // 注意：有原生 turn-process 行的回合走**整回合作用域**（TURN_SCOPE_SEG），
  // 折叠层读的是 data-dshcf-turn-scope-metrics（真机注入器两个属性都写）。
  const metricsPayload = JSON.stringify({ durationMs: 5000, toolCalls: 2, modelCalls: 1, inputTokens: 1000, outputTokens: 50 })
  const host = el('div', {
    'data-dshcf-turn-metrics-host': '1',
    'data-dshcf-turn': '1',
    'data-dshcf-session': 'sess-1',
    'data-dshcf-seg': '0',
    'data-dshcf-turn-metrics': metricsPayload,
    'data-dshcf-turn-scope-metrics': metricsPayload,
  }, col.body)
  host.setRect({ width: 0, height: 0 })
  register()
  await env.tick(); await env.tick()
  await env.tick()

  const btn = col.tp.querySelector('[data-turn-process]')
  const metrics = btn.querySelector('.dshcf-native-metrics')
  // 解包前：段的 boundary/finalStep 全空 → turn 键取不到 → nativeManaged 恒空 →
  // 指标永远不注入。解包后键能取到、原生行被识别、指标 span 挂上。
  // ⚠️ 本场景只鉴别「解包」这一层（在「已解包但缓存键错配」的变体上仍会 PASS）；
  // 「缓存键一致性」由场景 6 单独鉴别，两者分工不同。
  assert(metrics !== null, '原生行内注入指标 span（解包前恒为 null）')
  assert(metrics !== null && /次工具|tool/.test(metrics.textContent ?? ''),
    '指标内容含工具计数（走整回合作用域取值）', metrics?.textContent)
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 3: 可见性判定沿祖先链回退（列自身 display:contents 无盒） ===')
  const { env, document, register, cleanup } = boot()
  // ★ 鉴别力关键：让**列自身**（[data-chat-flow]）也没有布局盒（rect 0×0、
  // offsetParent=null），只有更外层的滚动容器有盒——这正是 0.2.1 的形态：
  // 真正承载流子级的列在 display:contents 链上。旧 isFlowVisible 只看元素自身
  // → 两列都判不可见 → findFlow 退化成 flows[0]；新实现沿祖先链回退 → 两列都可见。
  const mainWrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  mainWrap.setRect({ width: 680, height: 900 })
  mainWrap.offsetParent = {}
  const main = buildColumn021(mainWrap, 1)
  main.column.setRect({ width: 0, height: 0 })
  main.column.offsetParent = null
  const sideWrap = el('div', { 'data-slot': 'rightbar' }, document.body)
  sideWrap.setRect({ width: 400, height: 900 })
  sideWrap.offsetParent = {}
  const sc = el('div', { 'data-sidebar-chat': '' }, sideWrap)
  const side = buildColumn021(sc, 1)
  side.column.setRect({ width: 0, height: 0 })
  side.column.offsetParent = null
  register()
  await env.tick(); await env.tick()

  const m = stats(main)
  const s = stats(side)
  assert(m.chips >= 1, '主列折叠（列自身无盒，靠祖先链判定可见）', JSON.stringify(m))
  assert(s.chips >= 1, '子代理列也被折叠（旧实现两列都判不可见 → 只服务文档序第一列）', JSON.stringify(s))
  // ⚠️ 如实声明：本场景**不能**单独鉴别 isFlowVisible（FoldManager 对所有连通列
  // 都显式 bind，不看可见性 → 两种实现下这里都 PASS）。它的价值是锁定 0.2.1
  // 「列自身 display:contents」形态下多列仍全部被服务的**行为快照**。
  // isFlowVisible 的祖先回退目前**无独立覆盖**（函数未导出），属已知缺口。
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 4: 旧结构（无扩展位）保持原行为 ===')
  const { env, document, register, cleanup } = boot()
  const wrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const legacy = buildColumnLegacy(wrap, 1)
  register()
  await env.tick(); await env.tick()

  const s = stats(legacy)
  assert(s.chips >= 1, '旧结构照常产出段级 chip（向后兼容）', JSON.stringify(s))
  assert(s.groupsCollapsed === 2, '旧结构覆盖集组被驱动为收起（向后兼容）', JSON.stringify(s))
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 5: 插件节点不落进官方二分序列 ===')
  const { env, document, register, cleanup } = boot()
  const wrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const col = buildColumn021(wrap, 1)
  register()
  await env.tick(); await env.tick()

  // 官方 0.2.1 readVisibleTurn：((column.querySelector(':scope > [data-slot="conversation.chat.flow"]') ?? column)).children
  const rowSequence = [...col.slot.children]
  const pluginNodes = rowSequence.filter(e =>
    e.classList.contains('dshcf-chip')
    || e.classList.contains('dshcf-processed')
    || e.classList.contains('dshcf-processing'))
  assert(pluginNodes.length === 0, '扩展位（官方二分序列）内无插件自建节点', JSON.stringify(pluginNodes.map(n => n.className)))
  // 段级 chip 应挂在 turn-process 座位内部（安全宿主）
  assert(col.tp.querySelectorAll('.dshcf-seg-chip').length >= 1, '段级 chip 挂在 turn-process 座位内（§4.4 安全挂载）')
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 6: 缓存键一致性——结构变化后注入器 host 列表必须重建 ===')
  const { env, document, register, cleanup } = boot()
  const wrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const col = buildColumn021(wrap, 1)
  register()
  await env.tick(); await env.tick()

  // 首次 pass 建立 metricsHostListCache（此时无 host）。
  const beforeCount = document.querySelectorAll('[data-dshcf-turn-metrics-host]').length
  // 追加一个新 host 到答案步内（复刻注入器在结构变化后挂载新节点）。
  const payload6 = JSON.stringify({ durationMs: 5000, toolCalls: 2 })
  const host = el('div', {
    'data-dshcf-turn-metrics-host': '1',
    'data-dshcf-turn': '1',
    'data-dshcf-session': 'sess-1',
    'data-dshcf-seg': '0',
    'data-dshcf-turn-metrics': payload6,
    'data-dshcf-turn-scope-metrics': payload6,
  }, col.body)
  host.setRect({ width: 0, height: 0 })
  register()
  await env.tick(); await env.tick(); await env.tick()

  const btn = col.tp.querySelector('[data-turn-process]')
  const metrics = btn.querySelector('.dshcf-native-metrics')
  assert(beforeCount === 0, '前置：首次 pass 时无注入器 host', String(beforeCount))
  // 关键：缓存若以「列」为键而失效以「扩展位」为键，会永远读到旧空列表 → 指标不出现。
  assert(metrics !== null, '结构变化后 host 列表缓存被正确失效（指标能挂上）',
    metrics === null ? 'cache key mismatch' : undefined)

  // ⚠️ 这里**不能**断言「移除 host 后指标消失」：插件把已算出的回合指标
  // 冻结在段状态里（state.metrics，详见 pass 的注释「不删除已发布的数据」），
  // 指标是回合级**记录数据**、不是 DOM 的投影；React 对活动回合只会重渲染
  // host、不会移除它。实测确认移除 host 后 span 仍保留（符合设计），
  // 因此本场景只锁「结构变化后新增 host 能被读到」这一路径。
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 7: turn-trigger（0.2.0 起既有）不破坏段收尾 ===')
  const { env, document, register, cleanup } = boot()
  const wrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const column = el('div', { 'data-chat-flow': '' }, wrap)
  const slot = el('div', { 'data-slot': 'conversation.chat.flow' }, column)
  column.setRect({ width: 680, height: 900 })
  column.offsetParent = {}
  // 回合 1：原生行（最前）+ 组 + 正文 + tail
  const tp1 = seat(slot, 'turn-process', 'tp1', 33); tp1.setAttribute('data-chat-turn', '1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tp1)
  const g1 = makeGroup(slot, 1, 'code', false)
  const a1 = seat(slot, 'assistant-step', 'a1', 60); addBodyText(a1, '正文1')
  const tt1 = seat(slot, 'turn-tail', 'tt1', 24); tt1.setAttribute('data-turn-tail', '1')
  // 回合 2 以 turn-trigger 起头（0.2.1 的任务消息/子任务状态更新回合）
  const trig = seat(slot, 'turn-trigger', 'trig2', 40)
  trig.setAttribute('data-chat-turn', '2')
  textNode('收到任务消息', trig)
  const tp2 = seat(slot, 'turn-process', 'tp2', 33); tp2.setAttribute('data-chat-turn', '2')
  el('button', { 'data-turn-process': '2', 'aria-expanded': 'false' }, tp2)
  // 两个组：最新段的覆盖集 = 除最后一组外的全部 → 至少要有 2 组才会产 chip
  // （只有 1 组时 covered 为空、该组作为「最后一组」恒展开，不建 chip 是设计如此）。
  const g2 = makeGroup(slot, 2, 'read', false)
  const g2b = makeGroup(slot, 2, 'search', false)
  const a2 = seat(slot, 'assistant-step', 'a2', 60); addBodyText(a2, '正文2')
  const tt2 = seat(slot, 'turn-tail', 'tt2', 24); tt2.setAttribute('data-turn-tail', '2')

  register()
  await env.tick(); await env.tick()

  // 两个回合各自被服务：都有段级 chip 挂到自己的原生行座位内。
  assert(tp1.querySelectorAll('.dshcf-seg-chip').length >= 1, '回合 1 的 chip 挂在自己的原生行座位')
  assert(tp2.querySelectorAll('.dshcf-seg-chip').length >= 1, '回合 2（turn-trigger 起头）也拿到自己的 chip')
  assert(slot.querySelectorAll('.dshcf-processed').length === 0,
    '原生行管理的回合不建自建一级行（避免双写）')
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 8: 组内内容流里的节点 → 流根仍是外层列的内容根 ===')
  const { env, document, register, cleanup } = boot()
  const wrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const col = buildColumn021(wrap, 1)
  // 组内的内容流本身带 data-chat-flow（真机 CHAT:4239 [data-step-process-content][data-chat-flow]），
  // 且在它内部再放一个同名 slot——模拟「嵌套同名扩展位」这一最坏形态。
  const innerFlow = col.g1.body.querySelector('[data-step-process-content]')
  const innerSlot = el('div', { 'data-slot': 'conversation.chat.flow' }, innerFlow)
  const deep = el('div', { 'data-chat-flow-kind': 'assistant-step' }, innerSlot)
  register()
  await env.tick(); await env.tick()

  // 组内节点必须仍被折叠/统计，说明缓存键取到了正确的流根（不是组内内容流）。
  const s = stats(col)
  assert(s.chips >= 1, '组内嵌套同名 slot 时仍正常折叠（流根解析未落到组内容流）', JSON.stringify(s))
  assert(s.groupsCollapsed === 2, '覆盖集仍被驱动收起（统计口径未错位）', JSON.stringify(s))
  // 反向证据：若流根被错认成组内内容流，段会被拆散、chip 数量会异常（>1）。
  assert(s.chips === 1, '段级 chip 数量为 1（流根正确，未被组内同名 slot 劫持）', String(s.chips))
  cleanup()
}

console.log('\n[DONE] failures=' + failures)
process.exit(failures === 0 ? 0 : 1)
