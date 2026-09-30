/**
 * fold-retry.test.mjs — DSH 原生回合级状态装饰行折叠回归测试。
 * 覆盖 model-retry（"已重试模型请求…"）、turn-error（终态失败）、
 * turn-max-tokens（达到输出上限）三种行：折叠时随段一级隐藏（修复前残留
 * 可见），且不打断工具组合并；工作中保持可见、一级展开后恢复显示。
 *
 * 注：R9 尾行保留（keepLastRows，默认 3）现在覆盖「所有类型的系统提示行」——
 * model-retry 等状态行与思考/工具行同处一个 DOM 顺序序列，最新 N 个一律保留
 * 可见（见 fold-keep-last-rows 场景 7-10）。因此「状态行是否被折进 chip」的
 * 场景需要把 N 调到窗口之外（boot(1)）才能稳定命中折叠路径；默认 N=3 下
 * 系统行不足 3 条时全部保留、不生成 chip（P3「无被折叠行不显示折叠行」）。
 *
 * 用法：node test/fold-retry.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow, makeRetryRow, makeTurnErrorRow, makeMaxTokensRow } from './fake-dom.mjs'

/** 官方工具组桩（与 fold-017-safety.test.mjs 的 makeGroup 同构，只保留本用例
 * 需要的字段）：组根 = div[data-step-process]，组头按钮 = button[data-process-activity]，
 * 组体 = div[data-step-process-body]，组内容流 = div[data-step-process-content]。 */
function makeGroup(parent, { turn = 1, activity = 'code', open = false, grouped = true } = {}) {
  const group = el('div', {
    'data-step-process': 'true',
    'data-chat-group-key': 'g' + String(turn) + ':' + activity,
    'data-chat-turn': String(turn),
    class: 'O_Ebla_root',
  }, parent)
  if (!grouped) group.setAttribute('data-group-expanded-mode', '')
  const header = el('div', {}, group)
  const btn = el('button', { 'data-process-activity': activity, 'aria-expanded': String(open) }, header)
  const body = el('div', { 'data-step-process-body': 'true' }, group)
  if (grouped && !open) body.setAttribute('hidden', 'until-found')
  const content = el('div', { 'data-step-process-content': 'true', 'data-chat-flow': '' }, body)
  // F-6：与 fold-017-safety / fold-chip-drive 的官方 disclosure 桩**同语义**——
  // 点击切 aria-expanded，并在 body 上派发 beforematch（插件 driveGroupOnce 的
  // 展开通道依赖它；只绑 click 会让后续 chip 驱动断言在该夹具上失效）。
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-expanded') !== 'true'
    btn.setAttribute('aria-expanded', String(next))
    if (grouped && !next) body.setAttribute('hidden', 'until-found')
    else if (grouped) body.removeAttribute('hidden')
    if (typeof body.dispatchEvent === 'function') body.dispatchEvent('beforematch')
  })
  return { group, header, btn, body, content }
}

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
    getSnapshot: () => ({ status: 'ready', value: { statusText: 'Deep sleeping...', keepLastRows }, base: {}, user: {}, writable: true }),
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
function addThink(seatEl, summary) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  makeThinkRow({ state: 'ok', summary, parent: body })
}
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, body))
}

{
  console.log('\n=== 场景: model-retry 重试状态行随段折叠（已重试模型请求） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('读文件', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'Get-Content a.txt', parent: t1 })
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/3）', parent: r1 })
  const s2 = seat(flow, 'assistant-step', 's2', 26); addThink(s2, '再思考')
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addThink(fin, '最终思考'); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processed') === null, '未闭合回合不生成一级行')
  assert(r1.style.display === 'none', '工作中 model-retry 行随二级 chip 折叠（不再残留可见）', 'r1=' + r1.style.display)
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '闭合后生成一级行')
  assert(r1.style.display === 'none', '折叠后 model-retry 行随段隐藏（修复前残留已重试模型请求）', 'r1=' + r1.style.display)
  assert(s1.style.display === 'none' && t1.style.display === 'none' && s2.style.display === 'none' && t2.style.display === 'none', '工作行折叠', 's1=' + s1.style.display + ' t1=' + t1.style.display + ' s2=' + s2.style.display + ' t2=' + t2.style.display)
  assert(fin.style.display === '', '最终输出显示', 'fin=' + fin.style.display)
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chips = flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, 'model-retry 未断开工具组合并（一级行展开后恰一个 chip）', 'chips=' + chips.length)
  assert(r1.style.display === 'none', '一级展开后 model-retry 行收入二级"运行了命令"（不再独立拆分）', 'r1=' + r1.style.display)
  flow.querySelector('.dshcf-chip').dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === '', '二级"运行了命令"展开后 model-retry 行恢复显示', 'r1=' + r1.style.display)
  flow.querySelector('.dshcf-chip').dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === 'none', '二级"运行了命令"再次收起后 model-retry 行再次隐藏', 'r1=' + r1.style.display)
  cleanup()
}

{
  console.log('\n=== 场景: 块前 model-retry 状态行——指标行锚在其上方（issue #1） ===')
  // keepLastRows=1：本场景的 3 条系统行（retry + think + tool）在默认 N=3 下会
  // 全部保留可见、不生成 chip；取 1 让重试行落入折叠路径以覆盖二级折叠行为。
  const { env, document, flow, register, cleanup } = boot(1)
  const user = seat(flow, 'user', 'u1', 40); textNode('重试读文件', user)
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/2）', parent: r1 })
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(r1.style.display === 'none', '工作中块前 model-retry 行随二级 chip 折叠', 'r1=' + r1.style.display)
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '闭合后生成一级行')
  assert(r1.style.display === 'none', '折叠后块前 model-retry 行随段隐藏', 'r1=' + r1.style.display)
  // R1 后 chip 作为 flow-chip 锚在块前 model-retry 之上（一级折叠时隐藏）；指标行仍在 r1 之上（DOM 顺序）。
  assert([...flow.children].indexOf(row) < [...flow.children].indexOf(r1), '指标行位于块前 model-retry 行上方（DOM 顺序在 r1 之前）', 'rowIdx=' + [...flow.children].indexOf(row) + ' r1Idx=' + [...flow.children].indexOf(r1))
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  // 需求7：块前 model-retry（工具组「上一行」）被吸收进二级 chip，一级展开后仍随 chip 折叠
  assert(r1.style.display === 'none', '一级展开后块前 model-retry 仍随二级 chip 折叠（需求7）', 'r1=' + r1.style.display)
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '块前 model-retry 所在工作块生成二级 chip', 'chip=' + (chip?.textContent ?? 'null'))
  chip.dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === '', '二级展开后块前 model-retry 行恢复显示', 'r1=' + r1.style.display)
  chip.dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === 'none', '二级再次收起后块前 model-retry 行随 chip 隐藏', 'r1=' + r1.style.display)
  cleanup()
}

{
  console.log('\n=== 场景: turn-error 终态失败行随段折叠（出错了） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd', parent: t1 })
  const e1 = seat(flow, 'turn-error', 'e1', 24); makeTurnErrorRow({ message: '上游 500', parent: e1 })
  const s2 = seat(flow, 'assistant-step', 's2', 26); addThink(s2, '再思考')
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addThink(fin, '最终思考'); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  // 需求1：turn-error 是终态信号，无 turn-tail 也立即闭合折叠。
  assert(flow.querySelector('.dshcf-processed') !== null, 'turn-error 终态即闭合生成一级行（无 tail）')
  assert(e1.style.display === 'none', 'turn-error 终态后随段折叠隐藏', 'e1=' + e1.style.display)
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '闭合后生成一级行')
  assert(e1.style.display === 'none', '折叠后 turn-error 行随段隐藏（修复前残留出错了行）', 'e1=' + e1.style.display)
  assert(t1.style.display === 'none' && t2.style.display === 'none', '工作行折叠', 't1=' + t1.style.display + ' t2=' + t2.style.display)
  assert(fin.style.display === '', '最终输出显示', 'fin=' + fin.style.display)
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chips = flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, 'turn-error 未断开工具组合并（恰一个 chip）', 'chips=' + chips.length)
  assert(e1.style.display === 'none', '一级展开后 turn-error 行收入二级"运行了命令"（不再独立拆分）', 'e1=' + e1.style.display)
  flow.querySelector('.dshcf-chip').dispatchEvent('click')
  await env.tick()
  assert(e1.style.display === '', '二级"运行了命令"展开后 turn-error 行恢复显示', 'e1=' + e1.style.display)
  cleanup()
}

{
  console.log('\n=== 场景: turn-max-tokens 达到上限行随段折叠 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('写长文', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文被截断')
  const m1 = seat(flow, 'turn-max-tokens', 'm1', 24); makeMaxTokensRow({ parent: m1 })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  // 需求1：turn-max-tokens 是终态信号，无 turn-tail 也立即闭合折叠。
  assert(flow.querySelector('.dshcf-processed') !== null, 'turn-max-tokens 终态即闭合生成一级行（无 tail）')
  assert(m1.style.display === 'none', 'turn-max-tokens 终态后随段折叠隐藏', 'm1=' + m1.style.display)
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '闭合后生成一级行')
  assert(m1.style.display === 'none', '折叠后 turn-max-tokens 行随段隐藏', 'm1=' + m1.style.display)
  assert(fin.style.display === '', '最终输出显示', 'fin=' + fin.style.display)
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  assert(m1.style.display === '', '一级展开后 turn-max-tokens 行恢复显示', 'm1=' + m1.style.display)
  cleanup()
}

{
  console.log('\n=== 场景: model-retry + 单工具 = 2 条非正文 → 折叠（需求4 一致的 2+ 语义） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('重试读', user)
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/2）', parent: r1 })
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processed') !== null, '闭合后生成一级行')
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chips = flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, 'model-retry + 单工具（2 条非正文）折叠为一个 chip', 'chips=' + chips.length)
  assert(r1.style.display === 'none', '被吸收的块前 retry 随 chip 隐藏', 'r1=' + r1.style.display)
  flow.querySelector('.dshcf-chip').dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === '', '二级展开后块前 retry 恢复显示', 'r1=' + r1.style.display)
  cleanup()
}

// ── P3 缺口①：直播段重试链收敛（ISSUE_ROOTCAUSE_2026_09_30 问题②）───────────
// 机制：直播段不建 segmentState（pass 里 `if (!snapshot.closed && !snapshot.terminated)`
// 与 `if (snapshot.running || !snapshot.hasWork)` 两处 continue）⇒ shouldChip 与 P3 两条
// 处置路径都以 state 为前置 ⇒ 整个直播期块外状态行无人处置、逐条平铺在官方组
// 之间（用户报告「已重试模型请求把组分割成很多个」）。修复后只留最新一条。
{
  console.log('\n=== 场景: 直播期多条重试行只留最新一条（P3 缺口①） ===')
  const { env, document, flow, register, cleanup } = boot(3)
  const user = seat(flow, 'user', 'u1', 40); textNode('重试风暴', user)
  // F-5：补 turn-process 座位（真机 compact 形态）——否则 segmentChipHost 返回 null
  // ⇒ ensureSegmentChip 返回 null ⇒ P3 从不建 chip，末段断言实际测的是一级折叠路径
  // （「交 P3 处置」名不副实）。加座位后 chip 才真正建出，末段断言才有鉴别力。
  const tpSeat = seat(flow, 'turn-process', 'tp1', 28)
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  // 真机形态（0.1.7+）：工具行进官方组（组是不透明容器），重试行是 **flow 直接
  // 子级**夹在组之间——官方断组器把 model-retry 当 INDEPENDENT，每遇一条即
  // flush 当前组、单独 emit，于是形成「组、重试行、组、重试行…」交错。
  const { content: c1 } = makeGroup(flow, { turn: 1, activity: 'read' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't1' }, c1)
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/5）', parent: r1 })
  const { content: c2 } = makeGroup(flow, { turn: 1, activity: 'read' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't2' }, c2)
  const r2 = seat(flow, 'model-retry', 'r2', 24); makeRetryRow({ label: '已重试模型请求（2/5）', parent: r2 })
  const { content: c3 } = makeGroup(flow, { turn: 1, activity: 'code' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't3' }, c3)
  const r3 = seat(flow, 'model-retry', 'r3', 24); makeRetryRow({ label: '已重试模型请求（3/5）', parent: r3 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '进行中正文')
  // R3-3 回归网：真机里官方给每个 flow 节点写 data-chat-turn（chat bundle 的
  // ChatNodeSeat wrapper），使 segmentMetricsKeys 能从 finalStep/block.host 读到
  // 回合号 ⇒ 运行中段也会被判 nativeManaged。这里显式复刻该形态，并**对重试行的
  // display 写入计数**——因为「守卫失效」的终态与正确实现相同（都是 3 隐藏 + 1 可见），
  // 只有**写次数**能区分：正确实现每 pass ≤1 次写（幂等收敛），退化为 _none→""→none_
  // 往返双写则每 pass 多次。这是 R2-1 唯一可观测的差异，也是它当初逃过普通断言的原因。
  for (const el2 of [fin, ...flow.querySelectorAll('[data-step-process]')]) el2.setAttribute('data-chat-turn', '1')
  document.body.appendChild(flow)
  // 计数器：既有的重试行均已在 seat() 时创建，这里按其 style 的 display 写入计数。
  const writeCounts = new Map()
  for (const el2 of [r1, r2, r3, fin]) writeCounts.set(el2, 0)
  for (const el2 of [r1, r2, r3]) {
    let v = el2.style.display
    Object.defineProperty(el2.style, 'display', {
      configurable: true,
      get() { return v },
      set(nv) { writeCounts.set(el2, writeCounts.get(el2) + 1); v = nv },
    })
  }
  register()
  await env.tick(); await env.tick()
  // 直播中：未闭合 ⇒ 无一级行、无段级 chip（state 未建）
  assert(flow.querySelector('.dshcf-processed') === null, '直播期不生成一级行')
  assert(flow.querySelectorAll('.dshcf-seg-chip').length === 0, '直播期不生成段级 chip（无 state）')
  // 关键断言：只留最新一条重试行可见，前两条被收敛隐藏
  assert(r1.style.display === 'none', '直播期第 1 条重试行被收敛隐藏', 'r1=' + r1.style.display)
  assert(r2.style.display === 'none', '直播期第 2 条重试行被收敛隐藏', 'r2=' + r2.style.display)
  assert(r3.style.display === '', '直播期最新（第 3 条）重试行保留可见', 'r3=' + r3.style.display)
  // R3-3：稳态幂等——再跑两个 register+tick 循环，写入次数不得继续增长
  // （正确实现 = 已在目标态、每 pass 零写；守卫失效则每 pass 至少 4 次往返写）。
  const writesAfterFirst = r1.style.display === 'none' ? writeCounts.get(r1) : -1
  register(); await env.tick(); await env.tick()
  register(); await env.tick(); await env.tick()
  assert(writeCounts.get(r1) === writesAfterFirst,
    'R3-3 稳态零写：连续两个 pass 不再对已收敛的重试行写 display（杀 R2-1 往返双写）',
    'first=' + writesAfterFirst + ' now=' + writeCounts.get(r1))

  // 新增一条更新的重试行 ⇒ 上一条让位（「最新」随流式推进滑动）
  const r4 = seat(flow, 'model-retry', 'r4', 24); makeRetryRow({ label: '已重试模型请求（4/5）', parent: r4 })
  register()
  await env.tick(); await env.tick()
  assert(r3.style.display === 'none', '更新的重试行出现后，原最新一条让位隐藏', 'r3=' + r3.style.display)
  assert(r4.style.display === '', '新的最新重试行保持可见', 'r4=' + r4.style.display)
  assert(r1.style.display === 'none' && r2.style.display === 'none', '更早的重试行仍保持隐藏（不回流）',
    'r1=' + r1.style.display + ' r2=' + r2.style.display)

  // 回合闭合 ⇒ 交 P3 接管（段级 chip 建出，重试行收入 chip 收起态）
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 9秒', tail)
  register()
  await env.tick(); await env.tick()
  // 注意：本夹具带 turn-process 座位（原生 compact 形态）⇒ 一级折叠由原生
  // disclosure 行接管，插件**不建** .dshcf-processed（pass 里 `if (nativeManaged.has(snapshot.key))`
  // 分支的正确语义）。
  assert(flow.querySelectorAll('.dshcf-processed').length === 0,
    '原生 turn-process 座位存在时不建插件一级行（一级折叠交原生接管）',
    'processed=' + flow.querySelectorAll('.dshcf-processed').length)
  assert(r4.style.display === 'none', '闭合后最新重试行交由段级 P3 处置（随段折叠隐藏）', 'r4=' + r4.style.display)
  assert(flow.querySelectorAll('.dshcf-seg-chip').length === 1,
    'F-5 前置：turn-process 座位使段级 chip 真正建出（本断言为下条 P3 断言提供鉴别力）',
    'chips=' + flow.querySelectorAll('.dshcf-seg-chip').length)
  // F-5 补充：chip 展开后直播期被收敛的行必须全部恢复（此前只覆盖隐藏方向）
  const segChip = flow.querySelector('.dshcf-seg-chip')
  segChip.dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === '' && r2.style.display === '' && r3.style.display === '' && r4.style.display === '',
    'chip 展开后直播期被收敛/折叠的重试行全部恢复可见（信息不丢失）',
    'r1=' + r1.style.display + ' r2=' + r2.style.display + ' r3=' + r3.style.display + ' r4=' + r4.style.display)
  segChip.dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === 'none' && r4.style.display === 'none',
    'chip 再次收起后重试行重新隐藏（幂等）', 'r1=' + r1.style.display + ' r4=' + r4.style.display)
  cleanup()
}

// ── F-2：直播段终态行永不隐藏（错误线索不丢）──────────────────────────────
// 前提：段必须**保持直播态**——buildSegments 的
// terminated = !runningNow && (hasTerminalStatus || hasStoppedRow) 在「仍有行
// running」时为 false（真机竞态形态：turn-error 已出现、某行状态尚未落定）。
// 无 running 行时段被判 terminated ⇒ state 建出 ⇒ 走 P3/一级折叠而非本收敛路径。
{
  console.log('\n=== 场景: 直播段终态行不被重试链收敛隐藏（F-2） ===')
  const { env, document, flow, register, cleanup } = boot(3)
  const user = seat(flow, 'user', 'u1', 40); textNode('重试后报错', user)
  // ⚠️ 夹具必须让末尾状态行**留在段级**（segment.statusRows）才能测到本收敛路径：
  // findBlocks 只把「紧跟在一个已打开块之后」的状态行收进 block.statusRows
  // （pendingStatus 转交），而块被正文消息关闭后 pendingStatus 被清空 ⇒ 尾部状态行
  // 落回段级。因此这里用「运行中 think（保持段 live）→ 正文消息（关块并清 pending）
  // → 尾部状态行」的真机形态，而不是让状态行紧跟工具块。
  // 本文件的 addThink 是 2 参（state 恒 'ok'），故这里内联构造 **running** think 行，
  // 它是让段保持直播态（!terminated）的关键——否则 turn-error 会让段判 terminated。
  const t1 = seat(flow, 'assistant-step', 't1', 26)
  {
    const md = el('div', { class: 'assistant-markdown-root' }, t1)
    const body = el('div', { class: 'assistant-markdown-body' }, md)
    makeThinkRow({ state: 'running', summary: '正在思考', parent: body })
  }
  const a2 = seat(flow, 'assistant-step', 'a2', 60); addBodyText(a2, '继续')
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/2）', parent: r1 })
  const err = seat(flow, 'turn-error', 'e1', 24); makeTurnErrorRow({ label: '出错了', parent: err })
  const r2 = seat(flow, 'model-retry', 'r2', 24); makeRetryRow({ label: '已重试模型请求（2/2）', parent: r2 })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelectorAll('.dshcf-seg-chip').length === 0, 'F-2 前置：段仍为直播态（无段级 chip）',
    'chips=' + flow.querySelectorAll('.dshcf-seg-chip').length)
  assert(err.style.display === '', 'F-2 直播段 turn-error 保留可见（不被收敛隐藏）', 'e1=' + err.style.display)
  assert(r2.style.display === '', 'F-2 最新重试行仍保留（收敛正常工作）', 'r2=' + r2.style.display)
  assert(r1.style.display === 'none', 'F-2 更早的重试行仍被收敛隐藏', 'r1=' + r1.style.display)
  cleanup()
}

// ── 问题⑤ 根因B：直播期新组出现时前一组必须收起 ────────────────────────────
// 机制：官方组默认收起（useDisclosure() 无初始值），展开完全由插件每 pass 的
// driveGroups([last], true) 驱动；直播段此前在段级循环入口 continue ⇒ covered
// 整个直播期从不被驱动 ⇒ 上一 pass 被当作 last 展开的组，在新组出现、退居
// covered 之后无人收回 ⇒ 两组并排展开（用户症状「新组出现了旧组不收」）。
// 修法：直播段也 driveGroups(covered, false)。
{
  console.log('\n=== 场景: 直播期新组出现，前一组自动收起（问题⑤ 根因B） ===')
  const { env, document, flow, register, cleanup } = boot(3)
  const user = seat(flow, 'user', 'u1', 40); textNode('连续两组工作', user)
  const a0 = seat(flow, 'assistant-step', 'a0', 50); addBodyText(a0, '开始')
  const g1 = makeGroup(flow, { turn: 1, activity: 'read' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't1' }, g1.content)
  const fin = seat(flow, 'assistant-step', 'a1', 80); addBodyText(fin, '正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(g1.btn.getAttribute('aria-expanded') === 'true',
    '阶段1：唯一（也是最后）一组被驱动展开', 'g1=' + g1.btn.getAttribute('aria-expanded'))

  // 流式推进：新的组出现 ⇒ 旧组退居 covered，必须被收回
  const g2 = makeGroup(flow, { turn: 1, activity: 'code' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't2' }, g2.content)
  register()
  await env.tick(); await env.tick()
  assert(g1.btn.getAttribute('aria-expanded') === 'false',
    '根因B：新组出现后前一组被收起（修复前恒为 true，两组并排展开）',
    'g1=' + g1.btn.getAttribute('aria-expanded'))
  assert(g2.btn.getAttribute('aria-expanded') === 'true',
    '根因B：新出现的组作为 last 保持展开', 'g2=' + g2.btn.getAttribute('aria-expanded'))
  cleanup()
}

// ── D-1：原生 hidden 翻转不得清掉插件当前的隐藏（遗留清理的排除项）─────────
// 机制：cleanupLegacyResidue 的候选集含 [hidden]（目的是清除**旧版本**插件写在
// 组根上的遗留 style——组根无 style prop，React 永不清除）。但 React 会**动态**
// 给普通行加 hidden="until-found"；这类元素带 hidden ⇒ isNativeProtected 为真 ⇒
// 清理会把插件**自己当前的** display:none 一并清掉 ⇒ 元素在仍 hidden 期间被放出，
// 等 React 移除 hidden 时短暂可见。修法：清理排除插件当前受控元素（controlledDisplay）。
{
  console.log('\n=== 场景: 原生 hidden 翻转不清掉插件当前的隐藏（D-1） ===')
  const { env, document, flow, register, cleanup } = boot(3)
  const user = seat(flow, 'user', 'u1', 40); textNode('x', user)
  const a0 = seat(flow, 'assistant-step', 'a0', 50); addBodyText(a0, '开始')
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/2）', parent: r1 })
  const r2 = seat(flow, 'model-retry', 'r2', 24); makeRetryRow({ label: '已重试模型请求（2/2）', parent: r2 })
  document.body.appendChild(flow)
  let writes = 0
  Object.defineProperty(r1.style, 'display', {
    configurable: true,
    get() { return r1._v ?? '' },
    set(nv) { writes++; r1._v = nv },
  })
  r1._v = ''
  register(); await env.tick(); await env.tick()
  assert(r1.style.display === 'none', 'D-1 前置：r1（非末条）已被插件隐藏', 'r1=' + r1.style.display)
  const w0 = writes
  // React 给 r1 加原生 hidden（官方 processHidden 收起形态）——清理不得清掉插件的隐藏
  r1.setAttribute('hidden', 'until-found')
  register(); await env.tick(); await env.tick()
  assert(r1.style.display === 'none',
    'D-1 元素获得原生 hidden 后，插件当前的隐藏不被遗留清理清掉（修复前变空串）', 'r1=' + r1.style.display)
  assert(writes === w0, 'D-1 该翻转不产生任何 display 写（无往返）', 'before=' + w0 + ' after=' + writes)
  // React 移除 hidden（官方展开）——插件意图不变，仍应保持隐藏
  r1.removeAttribute('hidden')
  register(); await env.tick(); await env.tick()
  assert(r1.style.display === 'none', 'D-1 原生 hidden 移除后插件隐藏仍在（无需重新写）', 'r1=' + r1.style.display)
  cleanup()
}

// ── 问题⑤ 根因A：「最后一组恒展开」只对最新段兑现（跨段不并排）────────────
// 机制：groupPartitionOf 按段独立划分 last，而 last 的展开驱动原先对**每个段**
// 都执行、无段新旧门控 ⇒ 「某组曾是它所在段的最后一组」永久成立 ⇒ 每 pass 被
// 驱动展开，对抗任何收起。steering 切出多段时表现为多个组并排展开。
// 修法：last 只在流内**最后一个可驱动段**兑现；历史段的 last 并入 covered，
// 由 chip 代表收起（展开 chip 即可看到，信息不丢）。
{
  console.log('\n=== 场景: 跨段（steering）只展开最新段的最后一组（问题⑤ 根因A） ===')
  const { env, document, flow, register, cleanup } = boot(3)
  // ★ 必须走**真实用户时序**（审查指出的测试缺口）：先渲染只有段0 的流、让 gA 被
  // 驱动展开；**之后**才插入 steering 与段1。若一次性写入整棵 DOM，gA 的初始 aria
  // 就是 false，断言「gA===false」天然通过、与「是否被收回」无关（零鉴别力）。
  const u1 = seat(flow, 'user', 'u1', 40); textNode('第一问', u1)
  const g1 = makeGroup(flow, { turn: 1, activity: 'read' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't1' }, g1.content)
  const fin1 = seat(flow, 'assistant-step', 'a1', 80); addBodyText(fin1, '第一段完成')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(g1.btn.getAttribute('aria-expanded') === 'true',
    '根因A 前置：段0 是当时唯一的段 ⇒ 其最后一组被驱动展开',
    'g1=' + g1.btn.getAttribute('aria-expanded'))

  // 插话 ⇒ 段0 退居历史段，其最后一组必须被收回
  const st = seat(flow, 'steering', 'st1', 30); textNode('插话', st)
  const g2 = makeGroup(flow, { turn: 1, activity: 'code' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't2' }, g2.content)
  const fin2 = seat(flow, 'assistant-step', 'a2', 80); addBodyText(fin2, '第二段完成')
  register()
  await env.tick(); await env.tick()
  assert(g1.btn.getAttribute('aria-expanded') === 'false',
    '根因A：插话后历史段（段0）的最后一组被**收回**（先展开过，故本断言有鉴别力）',
    'g1=' + g1.btn.getAttribute('aria-expanded'))
  assert(g2.btn.getAttribute('aria-expanded') === 'true',
    '根因A：最新段（段1）的最后一组保持展开', 'g2=' + g2.btn.getAttribute('aria-expanded'))
  cleanup()

  // ★ 阻断缺陷回归（审查实测）：历史段只有 **1 个**可驱动组 ⇒ 有效覆盖集长度 1，
  // 但 chip 宿主缺失时 ensureSegmentChip 会 return null。若 driveGroups 被放在
  // 'if (chip === null) continue' **之后**，驱动整段不执行，该组保持展开 ——
  // 根因A 在真机主路径下完全失效（本轮首版即如此，被审查拦下）。
  // 本场景刻意不给 turn-process 座位（normal 形态 ⇒ segmentChipHost 返回 null）。
  {
    // 独立夹具：**不**建 turn-process 座位 ⇒ segmentChipHost 返回 null ⇒ chip 建不出
    const { env, document, flow, register, cleanup } = boot(3)
    const u2 = seat(flow, 'user', 'u2', 40); textNode('第一问', u2)
    const gA = makeGroup(flow, { turn: 1, activity: 'read' })
    el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't9' }, gA.content)
    const f1 = seat(flow, 'assistant-step', 'a9', 80); addBodyText(f1, '第一段完成')
    document.body.appendChild(flow)
    register(); await env.tick(); await env.tick()
    assert(gA.btn.getAttribute('aria-expanded') === 'true',
      '阻断缺陷前置：段0 唯一组被展开', 'gA=' + gA.btn.getAttribute('aria-expanded'))
    const st2 = seat(flow, 'steering', 'st9', 30); textNode('插话', st2)
    const gB = makeGroup(flow, { turn: 1, activity: 'code' })
    el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't8' }, gB.content)
    const f2 = seat(flow, 'assistant-step', 'a8', 80); addBodyText(f2, '第二段完成')
    register(); await env.tick(); await env.tick()
    assert(gA.btn.getAttribute('aria-expanded') === 'false',
      '阻断缺陷：历史段仅 1 组且 chip 建不出时仍须被驱动收起（驱动先于 chip 创建）',
      'gA=' + gA.btn.getAttribute('aria-expanded'))
    assert(flow.querySelectorAll('.dshcf-seg-chip').length === 0,
      '阻断缺陷前置：本夹具确无段级 chip（驱动与 chip 解耦）',
      'chips=' + flow.querySelectorAll('.dshcf-seg-chip').length)
    cleanup()
  }
}

// ── R7 回归网：chip 文案数字 === 实际被驱动收起的组数（不谎报）────────────────
// 首轮审查实测过谎报：历史段 3 个组时 chip 称「已折叠 1 个」而实际驱动 2 个。
// 根因是 chip 的代表集合（旧口径 partition.covered）与 driveGroups 的目标集合
// （有效覆盖集，含历史段的 last）口径分裂。现已统一为单一真源 effectiveCoveredOf；
// 本用例把「计数 === 实际驱动数」锁死（变异：把 chip 改回旧口径 → FAIL）。
{
  console.log('\n=== 场景: chip 计数与实际驱动组数一致（R7 不谎报） ===')
  const { env, document, flow, register, cleanup } = boot(3)
  const u1 = seat(flow, 'user', 'u1', 40); textNode('多组一段', u1)
  // segmentChipHost 需要原生 turn-process 座位才能挂 chip（与段级 chip 用例同款）。
  const tpR7 = seat(flow, 'turn-process', 'tpR7', 28)
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpR7)
  // 段0：3 个组（全部可驱动）
  const gA = makeGroup(flow, { turn: 1, activity: 'read' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 'c1' }, gA.content)
  const gB = makeGroup(flow, { turn: 1, activity: 'read' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 'c2' }, gB.content)
  const gC = makeGroup(flow, { turn: 1, activity: 'code' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 'c3' }, gC.content)
  const f1 = seat(flow, 'assistant-step', 'q1', 80); addBodyText(f1, '第一段完成')
  document.body.appendChild(flow)
  register(); await env.tick(); await env.tick()
  assert(gC.btn.getAttribute('aria-expanded') === 'true',
    'R7 前置：段0 唯一段的最后一组被展开（gA/gB 为 covered）',
    'gA=' + gA.btn.getAttribute('aria-expanded') + ' gB=' + gB.btn.getAttribute('aria-expanded') + ' gC=' + gC.btn.getAttribute('aria-expanded'))
  // 插话 ⇒ 段0 成历史段：其 3 个组**全部**应被驱动收起（含原 last gC）
  const st = seat(flow, 'steering', 'sq1', 30); textNode('插话', st)
  const gD = makeGroup(flow, { turn: 1, activity: 'read' })
  el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 'c4' }, gD.content)
  const f2 = seat(flow, 'assistant-step', 'q2', 80); addBodyText(f2, '第二段完成')
  register(); await env.tick(); await env.tick()
  const hist = [gA, gB, gC]
  const collapsed = hist.filter((g) => g.btn.getAttribute('aria-expanded') === 'false').length
  assert(collapsed === 3,
    'R7：历史段的 3 个组（含原 last）全部被驱动收起',
    'collapsed=' + collapsed + ' seq=' + hist.map((g) => g.btn.getAttribute('aria-expanded')).join(','))
  const chip = flow.querySelector('.dshcf-seg-chip')
  assert(chip !== null, 'R7 前置：历史段建出段级 chip')
  const m = (chip?.textContent ?? '').match(/已折叠\s*(\d+)\s*个/)
  assert(m !== null, 'R7 前置：chip 文案含「已折叠 N 个」', 'text=' + (chip?.textContent ?? ''))
  assert(m !== null && Number(m[1]) === collapsed,
    'R7：chip 声称的折叠数 === 实际被驱动收起的组数（口径同源，不谎报）',
    'chip=' + (m?.[1] ?? 'null') + ' actual=' + collapsed)
  // 展开 chip ⇒ 历史段全部组恢复展开；再收起 ⇒ 全部收起（幂等）
  chip?.dispatchEvent('click'); await env.tick()
  assert(hist.every((g) => g.btn.getAttribute('aria-expanded') === 'true'),
    'R7：展开 chip 后历史段全部组展开',
    'seq=' + hist.map((g) => g.btn.getAttribute('aria-expanded')).join(','))
  chip?.dispatchEvent('click'); await env.tick()
  assert(hist.every((g) => g.btn.getAttribute('aria-expanded') === 'false'),
    'R7：再次收起 chip 后历史段全部组收起（幂等，无震荡）',
    'seq=' + hist.map((g) => g.btn.getAttribute('aria-expanded')).join(','))
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
