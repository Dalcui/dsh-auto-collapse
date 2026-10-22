/**
 * fold-steer-live.test.mjs — 「插话进行中」的三类回归（2026-10-22 用户报告）。
 *
 * 真机取证（DSH 0.2.1-rc.2，playwright 实测，见 commit message / AGENTS.md）：
 * 用户在回合进行中按 Ctrl+Enter 插话后，插话节点（kind=steering）进入当前回合，
 * 回合被切成段 A / 段 B，但**回合本身仍在 running**。修复前用户看到：
 *   ① 段 A 的非最后一条正文被隐藏（被当成已完成回合做一级折叠）；
 *   ② 段 A 的「指标行」（dshcf-processed）与段级 chip 同时出现，而 chip 挂在
 *      turn-process 座位内（回合顶部）⇒ **指标行反而在 chip 下方**（位置颠倒）；
 *   ③ 回合结束后（插话回合 alwaysOpen）插件仍建 chip / 驱动组收起 —— 违反
 *      「原生恒展开 ⇒ 插件完全不介入」。
 *
 * 根因与修法：
 *   - 段「被 steering 边界收尾」≠「回合已结束」→ provisionalSegmentKeys 只在回合
 *     确实仍在跑（后续未闭合段 / [data-chat-running]）时把段判为「临时段」：
 *     不建一级行、不建段级 chip、不折叠中间正文；实时行按回合只保留一条。
 *   - 0.2.1 原生 turn-process 行的展开态改用 data-open（插话回合 hasContent=false
 *     ⇒ 官方不写 aria-expanded）→ nativeTurnRowOpen 同时认两者，passive 判定恢复
 *     「插话回合插件完全不介入」。
 *
 * 用法：node test/fold-steer-live.test.mjs
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
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration,modelCalls,toolCalls', statusText: '工作中...', keepLastRows: 3 }, base: {}, user: {}, writable: true }),
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

/** 0.2.1 形态会话列：[列[data-chat-flow] > 扩展位[data-slot=conversation.chat.flow]] */
function buildSlot(document) {
  const wrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const column = el('div', { 'data-chat-flow': '' }, wrap)
  const slot = el('div', { 'data-slot': 'conversation.chat.flow' }, column)
  slot.setRect({ width: 0, height: 0 })
  slot.offsetParent = null
  column.setRect({ width: 680, height: 900 })
  column.offsetParent = {}
  return { column, slot }
}

function seat(slot, kind, key, h = 30) {
  const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, slot)
  s.setRect({ height: h })
  return s
}

function addBody(seatEl, text) {
  const r = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const b = el('div', { class: 'assistant-markdown-body' }, r)
  const md = el('div', { class: 'markdown' }, b)
  textNode(text, md)
}

function makeGroup(slot, key, activity, open = false) {
  const group = el('div', {
    'data-step-process': 'true',
    'data-chat-group-key': key,
    'data-chat-turn': '1',
    class: 'O_Ebla_root',
  }, slot)
  const header = el('div', {}, group)
  const btn = el('button', { 'data-process-activity': activity, 'aria-expanded': String(open) }, header)
  const body = el('div', { 'data-step-process-body': 'true' }, group)
  if (!open) body.setAttribute('hidden', 'until-found')
  const content = el('div', { 'data-step-process-content': 'true', 'data-chat-flow': '' }, body)
  return { group, btn, body, content }
}

function addToolRow(group, callId) {
  const row = el('div', { 'data-chat-call-id': callId, 'data-tool': 'bash', 'data-state': 'ok', 'data-variant': 'others' }, group.content)
  textNode('cmd ' + callId, row)
}

/** 0.2.1 原生 turn-process 行（闭合后出现）：data-open=展开；disabled=不可折叠。 */
function nativeRow(seatEl, turn, { open = true, passive = false, aria = 'auto' } = {}) {
  const attrs = { 'data-turn-process': String(turn), 'data-turn-process-messages': '1', 'data-turn-process-tool-calls': '2', 'data-turn-process-subagents': '0' }
  if (open) attrs['data-open'] = 'true'
  if (passive) attrs.disabled = ''
  if (aria === 'auto') {
    // 0.2.1：hasContent=false（插话回合）⇒ 官方不写 aria-expanded
    if (!passive) attrs['aria-expanded'] = String(open)
  } else if (aria !== null) {
    attrs['aria-expanded'] = aria
  }
  return el('button', attrs, seatEl)
}

function runningMarker(slot) {
  return el('div', { 'data-chat-running': '' }, slot)
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 A: 插话进行中（回合仍在跑）—— 不建一级行/chip、中间正文不隐藏、实时行在回合顶部 ===')
  const { env, document, register, cleanup } = boot()
  const { slot } = buildSlot(document)
  seat(slot, 'user', 'u1', 40)
  const tp = seat(slot, 'turn-process', 'tp1', 28)   // 真机 running 期：座位存在但无按钮
  // ── 阶段 1：真实用户时序——先只有段 A（工具 running、正文 B1），实时行先建出来
  const toolSeat = seat(slot, 'tool-call', 't1', 30)
  const toolRow = makeToolRow({ callId: 'c1', tool: 'bash', state: 'running', summary: 'sleep 30', parent: toolSeat })
  const g1 = makeGroup(slot, 'g1', 'read')
  addToolRow(g1, 'c0')
  const b1 = seat(slot, 'assistant-step', 'b1', 60); addBody(b1, 'B1 中间正文')
  document.body.appendChild(slot)   // 挂载（必然重复 append 无害：父节点已是 slot）
  register(); await env.tick(); await env.tick()
  const liveBefore = slot.querySelector('.dshcf-processing')
  assert(liveBefore !== null && /已工作\s+\d+秒/.test(liveBefore.textContent ?? ''),
    '前置：插话前实时行为「已工作 X秒」', 'text=' + (liveBefore?.textContent ?? ''))
  // ── 阶段 2：工具完成 + 插话送达 + 段 B 尚无内容（宿主仍 running）
  const toolRoot = toolRow.querySelector('[data-tool]')
  toolRoot.setAttribute('data-state', 'ok')
  const g2 = makeGroup(slot, 'g2', 'code')
  addToolRow(g2, 'c2')
  const b2 = seat(slot, 'assistant-step', 'b2', 60); addBody(b2, 'B2 段A最终正文')
  seat(slot, 'steering', 'st1', 30)
  runningMarker(slot)
  register(); await env.tick(); await env.tick()

  const processed = slot.querySelectorAll('.dshcf-processed')
  const chips = slot.querySelectorAll('.dshcf-seg-chip')
  assert(processed.length === 0, '插话进行中不建一级「指标行」（§3 工作中无一级折叠）', 'processed=' + processed.length)
  assert(chips.length === 0, '插话进行中不建段级 chip（否则 chip 在回合顶部、指标行在其下方）', 'chips=' + chips.length)
  assert(b1.style.display !== 'none', '段 A 的非最后一条正文保持可见（修复前被一级折叠隐藏）', 'b1=' + b1.style.display)
  assert(b2.style.display !== 'none', '段 A 的最后一条正文同样可见', 'b2=' + b2.style.display)

  const live = slot.querySelector('.dshcf-processing')
  assert(live !== null, '插话进行中保留实时摘要行（回合仍在工作）')
  assert(/已工作\s+\d+秒/.test(live?.textContent ?? ''), '实时行沿用回合起点计时（已工作 X秒）', 'text=' + (live?.textContent ?? ''))
  // 位置：turn-process 座位之后、第一个官方组之前（视觉上就是「指标行在折叠行上方」）
  const kids = [...slot.children]
  const iTp = kids.indexOf(tp)
  const iLive = kids.indexOf(live)
  const iG1 = kids.indexOf(g1.group)
  assert(iLive > iTp && iLive < iG1, '实时行位于回合顶部（turn-process 座位之后、官方组之前）', 'tp=' + iTp + ' live=' + iLive + ' g1=' + iG1)
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 B: 回合结束 + 插话回合 passive（data-open）—— 插件完全不介入 ===')
  const { env, document, register, cleanup } = boot()
  const { slot } = buildSlot(document)
  seat(slot, 'user', 'u1', 40)
  const tp = seat(slot, 'turn-process', 'tp1', 28)
  nativeRow(tp, 1, { open: true, passive: true })   // 真机插话回合：data-open=true + disabled，无 aria-expanded
  const r1 = seat(slot, 'model-retry', 'r1', 24); textNode('已重试模型请求（1/30）', r1)
  const g1 = makeGroup(slot, 'g1', 'read', true)
  addToolRow(g1, 'c1')
  const b1 = seat(slot, 'assistant-step', 'b1', 60); addBody(b1, 'B1 段A中间正文')
  const g2 = makeGroup(slot, 'g2', 'code', true)
  addToolRow(g2, 'c2')
  const b2 = seat(slot, 'assistant-step', 'b2', 60); addBody(b2, 'B2 段A最终正文')
  seat(slot, 'steering', 'st1', 30)
  const g3 = makeGroup(slot, 'g3', 'read', true)
  addToolRow(g3, 'c3')
  const b3 = seat(slot, 'assistant-step', 'b3', 60); addBody(b3, 'B3 段B正文')
  const tail = seat(slot, 'turn-tail', 'tt1', 24)
  tail.setAttribute('data-turn-tail', '1')
  textNode('用时 8秒', tail)
  register(); await env.tick(); await env.tick()

  assert(slot.querySelectorAll('.dshcf-seg-chip').length === 0,
    'passive 回合不建段级 chip（data-open 判定修复；旧实现判不出 passive ⇒ 遗留孤儿 chip）',
    'chips=' + slot.querySelectorAll('.dshcf-seg-chip').length)
  assert(slot.querySelectorAll('.dshcf-processed').length === 0, 'passive 回合不建一级行（原生行接管）')
  assert(b1.style.display !== 'none', 'passive 回合段 A 中间正文保持可见（修复前被 chip 收起）', 'b1=' + b1.style.display)
  assert(r1.style.display !== 'none', 'passive 回合块外状态行（重试链）保持可见（修复前随 chip 隐藏）', 'r1=' + r1.style.display)
  assert(g1.btn.getAttribute('aria-expanded') === 'true', 'passive 回合插件不驱动组收起（保持原生展开态）', 'g1=' + g1.btn.getAttribute('aria-expanded'))
  const nativeMetrics = tp.querySelector('.dshcf-native-metrics')
  assert(nativeMetrics !== null, '指标仍注入原生 turn-process 行（passive 不影响指标注入）')
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 C: 旧版 passive 判据（aria-expanded=true + disabled）不回归 ===')
  const { env, document, register, cleanup } = boot()
  const { slot } = buildSlot(document)
  seat(slot, 'user', 'u1', 40)
  const tp = seat(slot, 'turn-process', 'tp1', 28)
  nativeRow(tp, 1, { open: true, passive: true, aria: 'true' })   // 0.2.0 形态：只有 aria-expanded
  const g1 = makeGroup(slot, 'g1', 'read')
  addToolRow(g1, 'c1')
  const b1 = seat(slot, 'assistant-step', 'b1', 60); addBody(b1, '正文')
  const tail = seat(slot, 'turn-tail', 'tt1', 24)
  tail.setAttribute('data-turn-tail', '1')
  register(); await env.tick(); await env.tick()
  assert(slot.querySelectorAll('.dshcf-seg-chip').length === 0, '旧版 aria-expanded passive 仍被识别（不建 chip）',
    'chips=' + slot.querySelectorAll('.dshcf-seg-chip').length)
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 D: 多次插话进行中 —— 只有一个实时行，全部正文可见 ===')
  const { env, document, register, cleanup } = boot()
  const { slot } = buildSlot(document)
  seat(slot, 'user', 'u1', 40)
  seat(slot, 'turn-process', 'tp1', 28)
  const g1 = makeGroup(slot, 'g1', 'read'); addToolRow(g1, 'c1')
  const b1 = seat(slot, 'assistant-step', 'b1', 60); addBody(b1, 'B1')
  seat(slot, 'steering', 'st1', 30)
  const g2 = makeGroup(slot, 'g2', 'code'); addToolRow(g2, 'c2')
  const b2 = seat(slot, 'assistant-step', 'b2', 60); addBody(b2, 'B2')
  seat(slot, 'steering', 'st2', 30)
  runningMarker(slot)
  register(); await env.tick(); await env.tick()
  assert(slot.querySelectorAll('.dshcf-processing').length === 1, '多段插话进行中只有一个实时行（按回合归属）',
    'liveRows=' + slot.querySelectorAll('.dshcf-processing').length)
  assert(slot.querySelectorAll('.dshcf-seg-chip').length === 0, '多段插话进行中不建任何段级 chip')
  assert(b1.style.display !== 'none' && b2.style.display !== 'none', '多段插话进行中全部正文可见',
    'b1=' + b1.style.display + ' b2=' + b2.style.display)
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 E: 回合真正结束后（无原生行）恢复正常一级折叠 ===')
  const { env, document, register, cleanup } = boot()
  const { slot } = buildSlot(document)
  seat(slot, 'user', 'u1', 40)
  seat(slot, 'turn-process', 'tp1', 28)
  const g1 = makeGroup(slot, 'g1', 'read'); addToolRow(g1, 'c1')
  const b1 = seat(slot, 'assistant-step', 'b1', 60); addBody(b1, 'B1 中间正文')
  const b2 = seat(slot, 'assistant-step', 'b2', 60); addBody(b2, 'B2 段A最终正文')
  seat(slot, 'steering', 'st1', 30)
  const g2 = makeGroup(slot, 'g2', 'code'); addToolRow(g2, 'c2')
  const b3 = seat(slot, 'assistant-step', 'b3', 60); addBody(b3, 'B3 段B最终正文')
  const tail = seat(slot, 'turn-tail', 'tt1', 24)
  tail.setAttribute('data-turn-tail', '1')
  textNode('用时 8秒', tail)
  register(); await env.tick(); await env.tick()
  assert(slot.querySelectorAll('.dshcf-processing').length === 0, '回合结束后实时行消失', 'liveRows=' + slot.querySelectorAll('.dshcf-processing').length)
  assert(slot.querySelectorAll('.dshcf-processed').length >= 1, '回合结束后按段建出一级行（多分组）', 'processed=' + slot.querySelectorAll('.dshcf-processed').length)
  assert(b1.style.display === 'none', '回合结束后中间正文按一级折叠隐藏（恢复既有语义）', 'b1=' + b1.style.display)
  assert(b2.style.display !== 'none' && b3.style.display !== 'none', '各段最终正文保持可见', 'b2=' + b2.style.display + ' b3=' + b3.style.display)
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 F: 插话恰好发生在回合结束（turn-tail 紧跟 steering）—— 不算临时段 ===')
  const { env, document, register, cleanup } = boot()
  const { slot } = buildSlot(document)
  seat(slot, 'user', 'u1', 40)
  const tp = seat(slot, 'turn-process', 'tp1', 28)
  nativeRow(tp, 1, { open: false, passive: false, aria: 'false' })
  const g1 = makeGroup(slot, 'g1', 'read')
  addToolRow(g1, 'c1')
  const b1 = seat(slot, 'assistant-step', 'b1', 60); addBody(b1, 'B1')
  seat(slot, 'steering', 'st1', 30)
  const b2 = seat(slot, 'assistant-step', 'b2', 60); addBody(b2, 'B2')
  const tail = seat(slot, 'turn-tail', 'tt1', 24)
  tail.setAttribute('data-turn-tail', '1')
  register(); await env.tick(); await env.tick()
  assert(slot.querySelectorAll('.dshcf-processing').length === 0, '回合已结束 ⇒ 不建实时行（无临时段）')
  // 原生行在场（收起态）⇒ 一级折叠交给原生 disclosure，插件只注入指标。
  // 注入发生 = 段已按「已结算」建出状态（临时段不会走 syncNativeDisclosure）。
  assert(tp.querySelector('.dshcf-native-metrics') !== null,
    '回合已结束 ⇒ 段按已结算处理（指标注入原生行）',
    'text=' + (tp.textContent ?? '').slice(0, 120))
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 G: 原生行由「可折叠展开」变「恒展开不可折叠」—— 遗留 chip 必须撤销 ===')
  const { env, document, register, cleanup } = boot()
  const { slot } = buildSlot(document)
  seat(slot, 'user', 'u1', 40)
  const tp = seat(slot, 'turn-process', 'tp1', 28)
  const btn = nativeRow(tp, 1, { open: true, passive: false })   // 阶段 1：可折叠且展开（非 passive）
  const g1 = makeGroup(slot, 'g1', 'read', true); addToolRow(g1, 'c1')
  const g2 = makeGroup(slot, 'g2', 'code', true); addToolRow(g2, 'c2')
  const b1 = seat(slot, 'assistant-step', 'b1', 60); addBody(b1, '正文')
  const tail = seat(slot, 'turn-tail', 'tt1', 24)
  tail.setAttribute('data-turn-tail', '1')
  register(); await env.tick(); await env.tick()
  assert(slot.querySelectorAll('.dshcf-seg-chip').length === 1,
    '前置：可折叠展开的原生行下确实建出了段级 chip（否则本场景无鉴别力）',
    'chips=' + slot.querySelectorAll('.dshcf-seg-chip').length)
  // 阶段 2：宿主把该回合改为 alwaysOpen（例如插话输入到达 / 会话被中断）——
  // 按钮变 disabled；插件必须撤销上一 pass 建出的 chip（不能留孤儿）。
  btn.setAttribute('disabled', '')
  register(); await env.tick(); await env.tick()
  assert(slot.querySelectorAll('.dshcf-seg-chip').length === 0,
    '转为 passive 后遗留 chip 被撤销（不出现「原生恒展开行下方挂着折叠行」）',
    'chips=' + slot.querySelectorAll('.dshcf-seg-chip').length)
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 H: data-open="false"（未来若改为 data-open={open}）不得被误读为展开 ===')
  const { env, document, register, cleanup } = boot()
  const { slot } = buildSlot(document)
  seat(slot, 'user', 'u1', 40)
  const tp = seat(slot, 'turn-process', 'tp1', 28)
  // 关键组合：按钮 disabled（不可折叠）+ data-open="false"（收起）。
  // 正确读法 = 未展开 ⇒ **不是** passive ⇒ 插件照常建段级 chip；
  // 错误读法（裸 hasAttribute）= 展开 ⇒ 误判 passive ⇒ 插件完全不介入、不建 chip。
  nativeRow(tp, 1, { open: false, passive: true, aria: 'false' })
  tp.querySelector('[data-turn-process]').setAttribute('data-open', 'false')
  const g1 = makeGroup(slot, 'g1', 'read'); addToolRow(g1, 'c1')
  const g2 = makeGroup(slot, 'g2', 'code'); addToolRow(g2, 'c2')
  const b1 = seat(slot, 'assistant-step', 'b1', 60); addBody(b1, '正文')
  const tail = seat(slot, 'turn-tail', 'tt1', 24)
  tail.setAttribute('data-turn-tail', '1')
  register(); await env.tick(); await env.tick()
  // passive 会把插件完全推开（不建 chip）；正确读法 = 非 passive ⇒ 原生行展开后仍建 chip。
  // 这里用「块级 chip 是否产出」间接判定：先点开原生行（模拟用户展开）。
  const btn = tp.querySelector('[data-turn-process]')
  assert(btn.getAttribute('data-open') === 'false' && btn.hasAttribute('disabled'),
    '前置：原生行为 data-open="false" 且 disabled')
  // 判据选 chip 而不是一级行：有原生行在场时一级折叠由原生接管（本就不建 dshcf-processed），
  // 唯一能被「误判 passive」改变的就是「插件是否还建段级 chip / 驱动组」。
  assert(slot.querySelectorAll('.dshcf-seg-chip').length === 1,
    'data-open="false" 不被误读为展开 ⇒ 该回合不判 passive（插件照常建段级 chip）',
    'chips=' + slot.querySelectorAll('.dshcf-seg-chip').length)
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
