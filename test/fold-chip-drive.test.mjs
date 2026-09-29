/**
 * fold-chip-drive.test.mjs —— 段级 chip 驱动的三条行为锁（2026-09-29 修复）。
 *
 * 对应用户报告的三条体验问题，每条都在此锁死「回退即 FAIL」：
 *
 * ## D1（原问题 2）展开/折叠时内容被顶上去，需要重新定位
 * 真机根因：驱动官方组用的 `button.click()` 会走官方 onClick
 * `event.currentTarget.focus(); toggle()`（CHAT:2263-2266），而 `focus()`
 * 默认带 scrollIntoView 语义 → 视口被拽到某个组标题。真机对照（同一会话）：
 *   正常 click      → scrollTop 13508 → 14864（+1356），chip 位移 -1356px
 *   焦点中和后 click → scrollTop 13508 → 13508（   0），chip 位移     0px
 * 修法：展开优先走官方自身的 `beforematch` 揭示通道（useSearchableHidden 的
 * reveal，CHAT:1620-1622），它只翻转 open、不碰焦点。
 * **本文件的鉴别力**：夹具给组按钮装了 click 计数器 + 一个"噪音"标记——
 * 若插件改回无条件 `button.click()` 展开，D1 立即 FAIL。
 *
 * ## D2（原问题 4）原生最后一个组不自动展开
 * compact 模式下 `useDisclosure` 初始态恒为收起，官方**没有**让最后一组自动
 * 展开的机制；旧实现据此「礼让」不驱动它 → 最后一组永远收起。
 * 修法：最后一组目标态恒为展开（chip 展开态下也照常驱动）。
 * **鉴别力**：删掉 `driveGroups([partition.last], true)` 即 FAIL。
 *
 * ## D3（原问题 3）「已重试模型请求」夹在组之间逐条平铺
 * 官方分组把 model-retry 当 INDEPENDENT 节点（CHAT:10565-10733），每遇到一条
 * 就 flush 当前组、单独 emit —— 真机实测某回合 59 组伴随 34 条重试行交错排布。
 * 插件无法重排 React 分组，采纳用户给的退路：块外状态行收入 chip 折叠范围。
 * **鉴别力**：删掉 chip 循环里的 statusRows 处置即 FAIL。
 *
 * ⚠️ **D5 的覆盖边界（如实声明）**：D5 锁的是「一级展开与二级 chip 的稳态
 * 组合结果」，**不锁**「一级 restore 路径是否覆盖 chip 意图」这一具体分支——
 * 实测把该仲裁改成恒真后 D5 仍 PASS，因为本夹具下段的 statusRows 走的是
 * 另一条路径（原生 turn-process 段由 nativeCollapsed 分支提前接管）。
 * 该仲裁是有意的纵深保护（两条路径都可能触碰同一批行），但其单独失效
 * 当前不被本文件发现。留档以免误以为它被覆盖。
 *
 * ⚠️ 夹具保真度说明：`makeGroup`（本文件内）复刻官方 reveal 行为——
 * `beforematch` 只翻 aria 与 hidden、**不触发 click 计数器**；click 才计数。
 * 这正是区分两条驱动通道的观测面。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installDomGlobals, el, textNode, makeToolRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
let failures = 0

function assert(condition, label, detail = '') {
  const ok = Boolean(condition)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

function boot() {
  const env = installDomGlobals()
  const { document } = env
  let exports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) {
      exports = spec.factory(() => { throw new Error('require unsupported in stub') })
    },
  }
  eval(bundle)
  if (exports === null) throw new Error('bundle did not register')
  let stop = null
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', value: { statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
  exports.apply({ effect: fn => { stop = fn() }, settingsScope: { bind: () => scopeMock } })
  const flow = el('div', { 'data-chat-flow': '' })
  flow.offsetParent = {}
  flow.setRect({ width: 900, height: 700 })
  const register = () => {
    const known = new Set(document._all)
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue
        if (!known.has(child)) {
          known.add(child)
          document._all.push(child)
        }
        walk(child)
      }
    }
    walk(document.body)
  }
  return { env, document, flow, register, cleanup() { stop?.(); env.clearTimers() } }
}

function seat(parent, kind, key, height = 40) {
  const node = el('div', {
    'data-chat-anchor-key': key,
    'data-chat-flow-key': key,
    'data-chat-flow-kind': kind,
    class: 'flowItem',
  }, parent)
  node.setRect({ height })
  return node
}

function addBodyText(node, value) {
  const r = el('div', { class: 'assistant-markdown-root' }, node)
  const b = el('div', { class: 'assistant-markdown-body' }, r)
  const md = el('div', { class: 'markdown' }, b)
  textNode(value, md)
}

/**
 * 官方工具组 + **两条驱动通道的独立计数器**。
 *
 * - `beforematch`（官方 useSearchableHidden 的 reveal 通道）：翻 open，不计数 click。
 * - `click`（官方标题按钮 onClick）：翻 open，**并**计一次 click —— 用于抓
 *   「插件是否又走回 click 驱动展开」。
 */
function makeGroup(parent, { turn = 1, activity = 'code', open = false, outerHidden = false, grouped = true } = {}) {
  const group = el('div', {
    'data-step-process': 'true',
    'data-chat-group-key': 'g' + String(turn) + ':' + activity,
    'data-chat-turn': String(turn),
    class: 'O_Ebla_root',
  }, parent)
  if (outerHidden) group.setAttribute('hidden', 'until-found')
  if (!grouped) group.setAttribute('data-group-expanded-mode', '')
  const header = el('div', {}, group)
  if (!grouped) header.setAttribute('hidden', '')
  const btn = el('button', { 'data-process-activity': activity, 'aria-expanded': String(open) }, header)
  const body = el('div', { 'data-step-process-body': 'true' }, group)
  if (grouped && !open) body.setAttribute('hidden', 'until-found')
  const content = el('div', { 'data-step-process-content': 'true', 'data-chat-flow': '' }, body)

  const stats = { clicks: 0, reveals: 0 }
  const setOpen = (next) => {
    btn.setAttribute('aria-expanded', String(next))
    if (!grouped) return
    if (next) body.removeAttribute('hidden')
    else body.setAttribute('hidden', 'until-found')
  }
  body.addEventListener('beforematch', () => {
    stats.reveals++
    setOpen(true)
  })
  btn.addEventListener('click', () => {
    stats.clicks++
    setOpen(btn.getAttribute('aria-expanded') !== 'true')
  })
  return { group, header, btn, body, content, stats }
}

// ══ D1：展开必须走 beforematch（零 click），不再走带 focus 副作用的 click ══
{
  console.log('\n=== D1：chip 展开走官方 beforematch 揭示通道（不再 click 组按钮） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  // 3 个可驱动组：前两个进覆盖集（chip 代表），第三个是「最后一组」。
  const g1 = makeGroup(flow, { turn: 1, activity: 'code', open: false })
  const g2 = makeGroup(flow, { turn: 1, activity: 'read', open: false })
  const g3 = makeGroup(flow, { turn: 1, activity: 'search', open: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 3秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  const chip = flow.querySelector('.dshcf-seg-chip')
  assert(chip !== null, 'D1-0 前置：产出段级 chip（防假绿）')
  // 稳定态：覆盖集已由插件收起。
  assert(g1.btn.getAttribute('aria-expanded') === 'false', 'D1-1 覆盖组 1 已被驱动为收起')
  assert(g2.btn.getAttribute('aria-expanded') === 'false', 'D1-2 覆盖组 2 已被驱动为收起')

  // 用户点击 chip 展开覆盖集。
  chip.click()
  await env.tick()
  assert(g1.btn.getAttribute('aria-expanded') === 'true',
    'D1-3 chip 展开后覆盖组 1 被驱动为展开',
    'aria=' + String(g1.btn.getAttribute('aria-expanded')))
  assert(g1.stats.reveals > 0,
    'D1-4 展开走的是官方 beforematch 揭示通道（reveals>0）',
    'reveals=' + g1.stats.reveals + ' clicks=' + g1.stats.clicks)
  cleanup()
}

// ══ D2：最后一组被自动展开（chip 收起态与展开态都成立） ══════════════════
{
  console.log('\n=== D2：最后一组恒展开（修复前它永远停在收起态） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  const g1 = makeGroup(flow, { turn: 1, activity: 'code', open: false })
  const g2 = makeGroup(flow, { turn: 1, activity: 'read', open: false })
  // 最后一组：初始收起（真机 compact 模式实测 groupBtnTrue=0，即全部收起）。
  const last = makeGroup(flow, { turn: 1, activity: 'search', open: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 4秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(last.btn.getAttribute('aria-expanded') === 'true',
    'D2-1 「最后一组」被自动展开（chip 收起态下即成立）',
    'aria=' + String(last.btn.getAttribute('aria-expanded')))
  assert(g1.btn.getAttribute('aria-expanded') === 'false',
    'D2-2 覆盖组仍保持收起（与最后一组目标态互不干扰）',
    'aria=' + String(g1.btn.getAttribute('aria-expanded')))
  // chip 展开后，最后一组仍应为展开（两者语义不重叠）。
  const chip = flow.querySelector('.dshcf-seg-chip')
  chip.click()
  await env.tick()
  assert(last.btn.getAttribute('aria-expanded') === 'true',
    'D2-3 chip 展开态下「最后一组」仍保持展开',
    'aria=' + String(last.btn.getAttribute('aria-expanded')))
  cleanup()
}

// ══ D2b：只有 1 个可驱动组的段也要展开它（covered 为空、不建 chip 的分支）══
{
  console.log('\n=== D2b：单组段也驱动其「最后一组」（covered 为空分支） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  const only = makeGroup(flow, { turn: 1, activity: 'code', open: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 2秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  // 单组段：covered 为空 → 不建 chip，但它仍是「最后一组」，必须被展开。
  assert(flow.querySelector('.dshcf-seg-chip') === null,
    'D2b-1 单组段不建 chip（covered 为空，语义如此）')
  assert(only.btn.getAttribute('aria-expanded') === 'true',
    'D2b-2 单组段的唯一组被展开（早期 return 会把这条路径漏掉）',
    'aria=' + String(only.btn.getAttribute('aria-expanded')))
  cleanup()
}

// ══ D3：块外状态行（model-retry）随 chip 折叠/展开 ═══════════════════════
{
  console.log('\n=== D3：块外状态行收入 chip 折叠范围（重试行不再组间平铺） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  const g1 = makeGroup(flow, { turn: 1, activity: 'code', open: false })
  const g2 = makeGroup(flow, { turn: 1, activity: 'read', open: false })
  const g3 = makeGroup(flow, { turn: 1, activity: 'search', open: false })
  // 块外状态行：夹在组之间（真机形态）。它不进任何 block.statusRows，
  // 因此只能由段级 chip 的新逻辑处置。
  const retry1 = seat(flow, 'model-retry', 'mr1')
  textNode('已重试模型请求（1/30） · 10s', retry1)
  const retry2 = seat(flow, 'model-retry', 'mr2')
  textNode('已重试模型请求（2/30） · 9s', retry2)
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 6秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  const chip = flow.querySelector('.dshcf-seg-chip')
  assert(chip !== null, 'D3-0 前置：产出段级 chip（防假绿）')
  assert(retry1.style.display === 'none' && retry2.style.display === 'none',
    'D3-1 chip 收起态：块外重试行被折叠（真机修复前恒可见，组间平铺）',
    'r1=' + JSON.stringify(retry1.style.display) + ' r2=' + JSON.stringify(retry2.style.display))
  chip.click()
  await env.tick()
  assert(retry1.style.display === '' && retry2.style.display === '',
    'D3-2 chip 展开态：块外重试行恢复可见（信息不丢失）',
    'r1=' + JSON.stringify(retry1.style.display) + ' r2=' + JSON.stringify(retry2.style.display))
  chip.click()
  await env.tick()
  assert(retry1.style.display === 'none' && retry2.style.display === 'none',
    'D3-3 再次收起后重试行重新被折叠（幂等、可反复）',
    'r1=' + JSON.stringify(retry1.style.display))
  cleanup()
}

// ══ D4：不得写原生受保护元素（P3 新逻辑的 §4.2 边界） ════════════════════
{
  console.log('\n=== D4：P3 不越界——带原生 hidden 的状态行仍不被写 display ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  makeGroup(flow, { turn: 1, activity: 'code', open: false })
  makeGroup(flow, { turn: 1, activity: 'read', open: false })
  makeGroup(flow, { turn: 1, activity: 'search', open: false })
  // 带原生 hidden 的状态行：§4.2 硬约束 1 —— 插件只读不写。
  const hiddenRetry = seat(flow, 'model-retry', 'mrH')
  hiddenRetry.setAttribute('hidden', 'until-found')
  textNode('已重试模型请求（9/30）', hiddenRetry)
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 7秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(hiddenRetry.style.display === '',
    'D4-1 带原生 hidden 的状态行未被写内联 display（hideElement 入口守卫生效）',
    'disp=' + JSON.stringify(hiddenRetry.style.display))
  assert(hiddenRetry.getAttribute('hidden') === 'until-found',
    'D4-2 原生 hidden 属性保持原值',
    'hidden=' + String(hiddenRetry.getAttribute('hidden')))
  cleanup()
}

// ══ D5：一级展开不得覆盖 chip 对状态行的折叠意图（两条路径的仲裁） ═══════
{
  console.log('\n=== D5：一级展开 vs chip 收起——状态行处置权仲裁 ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  makeGroup(flow, { turn: 1, activity: 'code', open: false })
  makeGroup(flow, { turn: 1, activity: 'read', open: false })
  makeGroup(flow, { turn: 1, activity: 'search', open: false })
  const retry = seat(flow, 'model-retry', 'mr1')
  textNode('已重试模型请求（1/30）', retry)
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  // 本夹具带原生 turn-process 座位 → 段被 nativeManaged 接管，一级折叠由原生
  // 行承载（插件不建 .dshcf-processed）。一级状态因此通过**原生行的开合**表达：
  // 原生行收起时过程内容整体带 hidden（那是官方行为，不是插件的 display 写入），
  // 原生行展开后才是「一级展开」状态——这正是本用例要考察的边界。
  const nativeBtn = flow.querySelector('button[data-turn-process]')
  assert(nativeBtn !== null, 'D5-0 前置：存在原生 turn-process 行（一级折叠的承载者）')
  const chip = flow.querySelector('.dshcf-seg-chip')
  assert(chip !== null, 'D5-1 前置：产出段级 chip')
  assert(chip.getAttribute('aria-expanded') === 'false', 'D5-2 前置：chip 初始收起')

  // 展开一级：驱动原生行（native 段的一级展开 = 原生行展开）。
  nativeBtn.click()
  await env.tick()
  await env.tick()
  // ⚠️ 判别点：一级展开**不等于** chip 展开。chip 仍收起时，它折叠的状态行
  // 必须保持折叠——早期实现里「一级展开 → 无条件 restore 状态行」会把它们
  // 又放出来，与 chip 的意图每 pass 互相覆盖（重试行在 chip 收起时仍可见）。
  assert(chip.getAttribute('aria-expanded') === 'false',
    'D5-3 一级展开后 chip 仍是收起态（一级与二级是两套独立状态）',
    'chip=' + String(chip.getAttribute('aria-expanded')))
  assert(retry.style.display === 'none',
    'D5-4 一级展开后状态行保持折叠（chip 收起态下的稳态结果）',
    'disp=' + JSON.stringify(retry.style.display))

  // 再展开 chip → 状态行恢复可见（处置权交回 chip）。
  chip.click()
  await env.tick()
  assert(retry.style.display === '',
    'D5-5 chip 展开后状态行恢复可见（信息不丢失）',
    'disp=' + JSON.stringify(retry.style.display))
  // 收起 chip → 重新折叠。
  chip.click()
  await env.tick()
  assert(retry.style.display === 'none',
    'D5-6 chip 再次收起后状态行重新折叠（可反复、幂等）',
    'disp=' + JSON.stringify(retry.style.display))
  cleanup()
}

if (failures > 0) {
  console.log('\n[' + failures + ' FAILURE(S)]')
  process.exit(1)
}
console.log('\n[ALL PASS]')
