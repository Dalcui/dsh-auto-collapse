/**
 * fold-group-count.test.mjs — 每组工具调用数挂在官方组标题末尾（0.3.5）。
 *
 * 覆盖：
 *   1) 计数口径 = 插件块级统计：普通工具行 1；PTC(run_code) 按子工具数计
 *      （子工具替代 Code）；嵌套流（子代理面板）不计；
 *   2) 纯思考 / 上下文组无徽标；有工具才出现；
 *   3) 徽标只挂在 button[data-process-activity] 末尾，组根 children 不变
 *      （§4.2「组是不透明容器」的最小例外：标题按钮内的 inert span）；
 *   4) React 重渲染清掉徽标后，下一 pass 自愈重建；数量变化时原地更新；
 *   5) 段级 chip 不再显示活动类别统计摘要（统计已下沉到每组标题）；
 *   6) 0.3.6：段级 chip 仅在有块外状态行时创建，点击只开/合重试行，
 *      不驱动任何工具组；没有状态行或原生行收起时不建 chip。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow, makeSubcall, makeRetryRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

function boot() {
  const env = installDomGlobals()
  const { document } = env
  let exports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) { exports = spec.factory(() => { throw new Error('require unsupported in stub') }) },
  }
  eval(bundle)
  if (exports === null) throw new Error('bundle did not register')
  let stop = null
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration', statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
  exports.apply({ effect: fn => { stop = fn() }, settingsScope: { bind: () => scopeMock } })
  const flow = el('div', { 'data-chat-flow': '' }, document.body)
  flow.offsetParent = {}
  flow.setRect({ width: 900, height: 700 })
  const register = () => {
    const known = new Set(document._all)
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue
        if (!known.has(child)) { known.add(child); document._all.push(child) }
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
  return md
}

/** 官方组（0.1.7+ 真机形状）：root > header > button[data-process-activity]；root > body > content。 */
function makeGroup(parent, { turn = 1, activity = 'code', open = false } = {}) {
  const group = el('div', {
    'data-step-process': 'true',
    'data-chat-group-key': 'g' + String(turn) + ':' + activity,
    'data-chat-turn': String(turn),
    class: 'O_Ebla_root',
  }, parent)
  const header = el('div', {}, group)
  const label = el('span', { class: 'O_Ebla_label', text: '已调用工具' }, header)
  const btn = el('button', { 'data-process-activity': activity, 'aria-expanded': String(open) }, header)
  const body = el('div', { 'data-step-process-body': 'true' }, group)
  if (!open) body.setAttribute('hidden', 'until-found')
  const content = el('div', { 'data-step-process-content': 'true', 'data-chat-flow': '' }, body)
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-expanded') !== 'true'
    btn.setAttribute('aria-expanded', String(next))
    if (next) body.removeAttribute('hidden')
    else body.setAttribute('hidden', 'until-found')
  })
  return { group, header, label, btn, body, content }
}

function addTool(content, { callId, tool = 'read', state = 'ok', summary = 'a.txt' }) {
  const s = seat(content, 'tool-call', 'call:' + callId, 30)
  return makeToolRow({ callId, tool, state, summary, parent: s })
}

function badgeOf(btn) {
  return btn.querySelector('.dshcf-group-count')
}

/** 原生 compact 回合（0.2.2 真机顺序）：user → turn-process(open) → groups → 正文 → tail。 */
function buildTurn(flow, { withRetry = true } = {}) {
  const u = seat(flow, 'user', 'u1')
  textNode('问题', u)
  const tp = seat(flow, 'turn-process', 'tp1', 33)
  tp.setAttribute('data-chat-turn', '1')
  const tpBtn = el('button', {
    'data-turn-process': '1',
    'data-open': 'true',
    'aria-expanded': 'true',
  }, tp)

  const gA = makeGroup(flow, { activity: 'code' })
  addTool(gA.content, { callId: 'a1', tool: 'read', summary: 'a.txt' })
  addTool(gA.content, { callId: 'a2', tool: 'bash', summary: 'ls' })

  const gB = makeGroup(flow, { activity: 'code' })
  const ptc = addTool(gB.content, { callId: 'b1', tool: 'run_code', summary: 'inspect' })
  const subcalls = el('div', { 'data-subcalls': '' }, ptc)
  makeSubcall({ callId: 'b1-1', tool: 'bash', parent: subcalls })
  makeSubcall({ callId: 'b1-2', tool: 'read', parent: subcalls })

  const gC = makeGroup(flow, { activity: 'thinking' })
  const thinkSeat = seat(gC.content, 'assistant-step', 'think:c', 30)
  makeThinkRow({ parent: thinkSeat, summary: '纯思考' })

  // D：run_code 无子工具 → 1；同一组里的斜杠命令不计（不是工具调用）
  const gD = makeGroup(flow, { activity: 'code' })
  addTool(gD.content, { callId: 'd1', tool: 'run_code', summary: 'no subcalls' })
  const cmdD = seat(gD.content, 'command', 'cmd:d', 30)
  el('div', { 'data-variant': 'others', 'data-state': 'ok' }, cmdD)

  // E：纯命令组 → 无徽标
  const gE = makeGroup(flow, { activity: 'commands' })
  const cmdE = seat(gE.content, 'command', 'cmd:e', 30)
  el('div', { 'data-variant': 'others', 'data-state': 'ok' }, cmdE)

  // 块外状态行（重试记录）：0.3.6 起段级 chip 只在有这类行时创建。
  let retry = null
  if (withRetry) {
    retry = seat(flow, 'model-retry', 'mr1', 24)
    makeRetryRow({ label: '已重试模型请求（1/30）', parent: retry })
  }

  const fin = seat(flow, 'assistant-step', 'a1-fin', 60)
  addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  tail.setAttribute('data-turn-tail', '1')
  textNode('用时 5秒', tail)
  return { tp, tpBtn, gA, gB, gC, gD, gE, retry, fin }
}

{
  console.log('\n=== 场景 1: 每组独立计数（顶层工具行；PTC 子工具替代 Code） ===')
  const { env, flow, register, cleanup } = boot()
  const { tp, gA, gB, gC, gD, gE, retry } = buildTurn(flow)
  register()
  await env.tick(); await env.tick()

  const a = badgeOf(gA.btn)
  const b = badgeOf(gB.btn)
  assert(a !== null && a.textContent === '· 2 次工具', 'A 组徽标 = 2 次工具', 'text=' + (a?.textContent ?? 'null'))
  assert(b !== null && b.textContent === '· 2 次工具', 'B 组 run_code 按 2 条子工具计（不重复计 run_code 自身）', 'text=' + (b?.textContent ?? 'null'))
  assert(badgeOf(gC.btn) === null, '纯思考组不生成徽标')
  assert(badgeOf(gD.btn)?.textContent === '· 1 次工具', 'run_code 无子工具计 1；同组斜杠命令不计', 'text=' + (badgeOf(gD.btn)?.textContent ?? 'null'))
  assert(badgeOf(gE.btn) === null, '纯斜杠命令组不生成徽标')

  // 只挂标题按钮、组根 children 仍是 [header, body]
  assert(a !== null && a.parentElement === gA.btn, '徽标挂在 button[data-process-activity] 内')
  assert(gA.group.children.length === 2, '组根 children 仍为 [header, body]（未插入新节点）', 'n=' + gA.group.children.length)
  assert(gC.content.querySelector('.dshcf-group-count') === null, '组内容流内无插件徽标')

  // 段级 chip 0.3.6：只在有块外状态行时出现，只开重试记录，不驱动工具组。
  const chip = tp.querySelector('.dshcf-seg-chip')
  assert(chip !== null, '有块外重试行时生成段级 chip（重试记录开关）')
  assert(chip?.textContent === '1 条重试记录', 'chip 标题 = 重试记录条数', 'text=' + (chip?.textContent ?? ''))
  assert(chip?.querySelector('.dshcf-chip-summary') === null, '段级 chip 不再创建统计摘要 span')
  assert((chip?.textContent ?? '').indexOf('\u00d7') < 0, '段级 chip 文本不含「×N」活动统计', 'text=' + (chip?.textContent ?? ''))
  assert(gA.btn.getAttribute('aria-expanded') === 'false' && gB.btn.getAttribute('aria-expanded') === 'false',
    'chip 收起态：覆盖组保持收起')
  assert(gE.btn.getAttribute('aria-expanded') === 'true', '最后一组保持展开')
  assert(retry?.style.display === 'none', 'chip 收起态：重试行被折叠')
  chip?.click()
  await env.tick()
  assert(retry?.style.display === '', 'chip 展开后重试行可见')
  assert(gA.btn.getAttribute('aria-expanded') === 'false' && gB.btn.getAttribute('aria-expanded') === 'false',
    'chip 展开不驱动工具组（0.3.6 职责拆分）')
  chip?.click()
  await env.tick()
  assert(retry?.style.display === 'none', 'chip 再次收起后重试行重新折叠')
  cleanup()
}

{
  console.log('\n=== 场景 2: 数量随新增工具行更新；嵌套流不计入本组 ===')
  const { env, flow, register, cleanup } = boot()
  const { gA, gB } = buildTurn(flow)
  register()
  await env.tick(); await env.tick()
  assert(badgeOf(gA.btn)?.textContent === '· 2 次工具', '前置：A 组初始 2 次工具')

  addTool(gA.content, { callId: 'a3', tool: 'edit', summary: 'b.ts' })
  // 嵌套流（子代理面板）内的工具行：最近流根不是本组 content，不得计入
  const hostSeat = seat(gA.content, 'assistant-step', 'nested-host', 30)
  const nested = el('div', { 'data-chat-flow': '' }, hostSeat)
  addTool(nested, { callId: 'nested-1', tool: 'read', summary: 'nested.txt' })
  register()
  await env.tick(); await env.tick()
  assert(badgeOf(gA.btn)?.textContent === '· 3 次工具', '新增工具后徽标更新为 3（嵌套流不计）', 'text=' + (badgeOf(gA.btn)?.textContent ?? 'null'))
  assert(gA.btn.querySelectorAll('.dshcf-group-count').length === 1, '每按钮只有一个徽标（无重复追加）')
  assert(badgeOf(gB.btn)?.textContent === '· 2 次工具', 'B 组计数不受 A 组变化影响')
  cleanup()
}

{
  console.log('\n=== 场景 3: React 重渲染把官方节点插到徽标之后 → 补回末尾；清掉徽标 → 自愈 ===')
  const { env, flow, register, cleanup } = boot()
  const { gA } = buildTurn(flow)
  register()
  await env.tick(); await env.tick()
  const first = badgeOf(gA.btn)
  assert(first !== null, '前置：徽标已注入')

  // 复刻 React 在徽标之后插入官方节点（徽标不再是 lastElementChild）
  const official = el('span', { class: 'O_Ebla_label', text: '官方节点' }, gA.btn)
  assert(gA.btn.lastElementChild === official, '前置：官方节点被插到徽标之后')
  await env.notifyMutations([])
  env.flushRaf(); env.flushRaf()
  assert(gA.btn.lastElementChild === badgeOf(gA.btn), '徽标被补回标题按钮末尾（不在官方节点之前）')
  assert(gA.btn.querySelectorAll('.dshcf-group-count').length === 1, '补回后仍只有一个徽标')
  official.remove()

  // 复刻 React 重渲染：整个标题按钮的子节点被官方重建（徽标随之消失）
  badgeOf(gA.btn)?.remove()
  assert(badgeOf(gA.btn) === null, '模拟 React 清掉徽标')
  register()
  await env.notifyMutations([])
  env.flushRaf(); env.flushRaf()
  const healed = badgeOf(gA.btn)
  assert(healed !== null && healed.textContent === '· 2 次工具', '下一 pass 自愈重建（数量不变）', 'text=' + (healed?.textContent ?? 'null'))
  cleanup()
}

{
  console.log('\n=== 场景 4: 工具行全部消失 → 徽标移除（不残留 0 次工具） ===')
  const { env, flow, register, cleanup } = boot()
  const { gA } = buildTurn(flow)
  register()
  await env.tick(); await env.tick()
  assert(badgeOf(gA.btn) !== null, '前置：A 组有徽标')

  for (const s of [...gA.content.children]) s.remove()
  register()
  await env.tick(); await env.tick()
  assert(badgeOf(gA.btn) === null, '组内无工具后徽标被移除')
  cleanup()
}

{
  console.log('\n=== 场景 5: 切流/销毁时清掉旧 flow 的徽标 ===')
  const { env, flow, register, cleanup } = boot()
  const { gA } = buildTurn(flow)
  register()
  await env.tick(); await env.tick()
  assert(badgeOf(gA.btn) !== null, '前置：A 组有徽标')

  flow.remove()
  await env.notifyMutations([])
  env.flushRaf(); env.flushRaf()
  assert(badgeOf(gA.btn) === null, 'flow 不可见后旧徽标被移除（不污染宿主）')
  cleanup()
}

{
  console.log('\n=== 场景 6: 没有块外状态行 → 不建段级 chip（0.3.6 职责拆分） ===')
  const { env, flow, register, cleanup } = boot()
  const { tp, gA, gB } = buildTurn(flow, { withRetry: false })
  register()
  await env.tick(); await env.tick()
  assert(tp.querySelector('.dshcf-seg-chip') === null, '无重试行时不建 chip（顶部不再有多余一行）')
  assert(gA.btn.getAttribute('aria-expanded') === 'false' && gB.btn.getAttribute('aria-expanded') === 'false',
    '无 chip 时覆盖组仍被驱动为收起')
  cleanup()
}

{
  console.log('\n=== 场景 7: 原生行收起 → 不建 chip（即使有重试行） ===')
  const { env, flow, register, cleanup } = boot()
  const { tp, tpBtn } = buildTurn(flow)
  // 原生行收起：过程内容由宿主整体隐藏，插件不应在折叠行下方再挂一个 chip。
  tpBtn.setAttribute('data-open', 'false')
  tpBtn.setAttribute('aria-expanded', 'false')
  register()
  await env.tick(); await env.tick()
  assert(tp.querySelector('.dshcf-seg-chip') === null,
    '原生行收起时不建 chip（否则折叠行下方会多出一行重试记录）')
  cleanup()
}

console.log('\nfold-group-count: failures=' + failures)
if (failures > 0) process.exitCode = 1
