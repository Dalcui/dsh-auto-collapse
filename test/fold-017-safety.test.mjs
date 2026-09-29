/**
 * fold-017-safety.test.mjs —— DSH 0.1.7 官方折叠契约的安全不变量（规格书 §4.2/§4.3/§5.3-§5.7）。
 *
 * 本文件**只**锁定 0.1.7 新增的硬约束（旧行为回归由既有 28 个文件覆盖）：
 *   A. 组根绝不被当作 block.host / 绝不被写 style.display（§3.1 根因 B1）
 *   B. 组内不被 prepend/insertBefore 任何插件节点（§3.1 B2）
 *   C. 带原生 hidden 的元素绝不被写 display（§4.2 硬约束 1）
 *   D. 正确谓词 groupBodyVisible / groupCollapsibleMode（§4.3 R7）
 *   E. chip 绝不带官方锚点属性（§4.2 第 5 条）
 *   F. 遗留 style.display 残留被清理（R19 / 验收第 9 条）
 *   G. reasoning part 不被判为正文（§6.2 第 13 条）
 *   H. verbose（aria-expanded=true + disabled）⇒ 插件完全不介入（§5.10）
 *   I. findFlow 不选中组内容流（§3.2(1) / 验收第 10 条）
 *   J. 状态词替换：中文界面生效、幂等、不误改错误提示行（§3.2(3) / 验收 11/12）
 *   K. A1 覆盖集恰为「除最后一组外」（§5.3）
 *   L. outerHidden 组不进覆盖集、chip 不谎报（§4.3 R7 第一轴）
 *   L2. 非折叠模式（data-group-expanded-mode）组不进覆盖集（R7 **第二轴**）
 *       ——复审发现：覆盖集曾只排 [hidden]，漏了 groupCollapsibleMode；
 *         因 grouped 与 outerHidden 互斥，L1 结构上抓不到本轴，故 L2 专测。
 *   M. verbose（原生恒展开）不建任何 chip（§5.10）
 *   N. muting **记录并延迟重放**（§5.5 第 4 条）
 *   O. 淡出动画在途期间元素新获得 hidden → onfinish 回调不得写 display（§4.2 回调侧）
 *   Q. 插件隐藏过的元素在 stop() 后**必被恢复**（不留 B1 类永久 display 残留）
 *
 * ## 鉴别力（变异测试，2026-09-28）
 * 本文件的目标是**回退修复后必须 FAIL**。实测（回退 src/fold.ts 的对应改动后
 * 重跑 run-all）：
 * ```
 * KILLED   删 isNativeProtected 的 hidden 分支        → A2/C2 抓到
 * KILLED   删 hideElement 入口守卫                     → C2 抓到
 * KILLED   releaseMuting 改为丢弃不重放（M10）          → N2 抓到
 * KILLED   stripFieldFromSummary 正则回退（M11）        → fold-group-scope 场景 1b
 * KILLED   chip 改挂 column（M12）                     → E2 抓到
 * KILLED   A1 把最后一组也纳入覆盖集（M13）             → K1/L1 抓到
 * KILLED   coveredGroupsOf 恒空（M14）                 → E0/K0/L1 抓到
 * KILLED   给 restoreElement 加「受保护元素放弃恢复」守卫 → Q2 抓到
 *          （该守卫会留下永久 display:none，正是 B1 类破坏，故已撤销）
 * KILLED   覆盖集漏掉 groupCollapsibleMode（R7 第二轴） → L2-1 抓到
 * ```
 *
 * ⚠️ **已删除的假断言（如实留档）**：曾有一条编号 C5、标题声称『杀 M15：删掉
 * `-body` 分支』的断言。复审实测它是**假绿**（删分支后仍 PASS，因构造的孤立 div
 * 从不进入折叠账本），且与 C2-1 语义重复，故**已删除**——不保留「假装覆盖」的断言。
 * **仍存活（如实记录，均为纵深/不可达，非缺陷）**：
 * ```
 * 删 onfinish 回调守卫（M4）   —— hideElement 入口守卫已先拦下，回调守卫是第二道；
 *                                 同时 restoreElement 也有守卫，三条路径互为冗余。
 * 删 driveGroups outerHidden 门禁（M8）—— coveredGroupsOf 已在覆盖集阶段排除
 *                                 outerHidden 组，门禁是第二道。
 * 删 -body / -content 分支（M15/M16）—— 组根分支（data-step-process）已先命中，
 *                                 且组永不进入折叠账本，这两个分支当前不可达。
 * ```
 * 保留这些冗余守卫是有意的（P0 项宁可多一道），但**它们的单独失效不会被 CI 发现**
 * ——若将来调整调用顺序使某条路径变为可达，需补针对性用例。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installDomGlobals, el, textNode, makeThinkRow, makeToolRow } from './fake-dom.mjs'

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
  const root = el('div', { class: 'assistant-markdown-root' }, node)
  const body = el('div', { class: 'assistant-markdown-body' }, root)
  const markdown = el('div', { class: 'markdown' }, body)
  textNode(value, markdown)
  return markdown
}

/**
 * 0.1.7 官方工具组（真机形状，见 DOM_SNAPSHOT_0.1.7.md §2）：
 *   div[data-step-process] [data-chat-group-key] [data-chat-flow-key] [data-chat-anchor-key] [data-chat-turn]
 *     div[hidden]  ← hidden={!grouped}
 *       button[data-process-activity] [aria-expanded]
 *     div[data-step-process-body] [hidden="until-found"]
 *       div[data-step-process-content] [data-chat-flow]
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
  // 官方折叠：body hidden 只在 grouped && !open 时写
  if (grouped && !open) body.setAttribute('hidden', 'until-found')
  const content = el('div', { 'data-step-process-content': 'true', 'data-chat-flow': '' }, body)
  return { group, header, btn, body, content }
}

// ── A/B：组是**不透明容器**——不被当 host、不被写 display、不被插入节点 ──────
{
  console.log('\n=== A/B：组根不被当作 block.host，chip 不插入组内（§3.1 B1/B2） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const { group, body } = makeGroup(flow, { turn: 1, activity: 'code' })
  // 组内放工具行（真机：工具行全部在组内）
  const toolSeat = el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't1' }, group.querySelector('[data-step-process-content]'))
  makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd', parent: toolSeat })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 2秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  assert(group.style.display === '' && group.getAttribute('style') === null,
    'A1 组根 style.display 恒为空串（插件从未写它）', 'style=' + String(group.getAttribute('style')))
  assert(group.querySelector('.dshcf-chip') === null,
    'B1 组内没有插件 chip（chip 不 prepend 进组）',
    'chips=' + group.querySelectorAll('.dshcf-chip').length)
  // 组根绝不应成为 chip/host 的记录：检查没有任何插件节点挂在 group 下
  const pluginInside = [...group.querySelectorAll('.dshcf-chip, .dshcf-processed, .dshcf-processing, .dshcf-merged-think, .dshcf-merged-body')]
  assert(pluginInside.length === 0, 'B2 组内不存在任何插件节点', 'found=' + pluginInside.length)
  // 组内工具行不得被插件写 display
  const toolRoot = group.querySelector('[data-chat-call-id]')
  assert(toolRoot === null || toolRoot.style.display === '',
    'A2 组内工具行未被插件写 display', 'disp=' + String(toolRoot?.style.display))
  cleanup()
}

// ── C：带原生 hidden 的元素绝不被写 display（§4.2 硬约束 1）────────────────
{
  console.log('\n=== C：原生 hidden 元素只读不写（§4.2 硬约束 1） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const { group, body } = makeGroup(flow, { turn: 1, activity: 'thinking' })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 3秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(body.style.display === '', 'C1 组 body（原生 hidden="until-found"）未被写 display',
    'disp=' + String(body.style.display))
  assert(body.getAttribute('hidden') === 'until-found', 'C2 原生 hidden 属性保持原值',
    'hidden=' + String(body.getAttribute('hidden')))
  const content = group.querySelector('[data-step-process-content]')
  assert(content.style.display === '', 'C3 组 content 未被写 display', 'disp=' + String(content.style.display))
  // ⚠️ **如实记录（复审修正）**：此处曾有一条编号 C5、标题声称『杀 M15：删掉
  // `-body` 分支』的断言。经复审实测，它是**假绿**——删掉 `-body` / `-content`
  // 分支后该断言仍然 PASS。根因：孤立挂在 flow 上的 div 从不进入折叠账本，
  // `isNativeProtected` 根本不参与判定，`style.display === ''` 恒真。
  // 且它与 C2-1（真实可达、确有鉴别力）覆盖同一语义、纯属冗余。
  // 故**已删除**，不保留任何『假装覆盖』的断言——`-body`/`-content` 两个分支
  // 当前不可达（见文件头「仍存活」清单），它们是有意的纵深守卫。
  // 已完成回合的组根带 outerHidden：同样不得被写
  const { group: g2 } = makeGroup(flow, { turn: 2, activity: 'read', outerHidden: true })
  register()
  await env.tick()
  assert(g2.style.display === '' && g2.getAttribute('style') === null,
    'C4 outerHidden 组根未被写 style', 'style=' + String(g2.getAttribute('style')))
  cleanup()
}

// ── C2：**会进入插件账本**的受保护元素也不得被写（§4.2 硬约束 1 的判别性用例）──
{
  console.log('\n=== C2：进入插件账本的受保护行也不得被写（hideElement 入口守卫） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  // 状态装饰行（model-retry）会被 findBlocks 收进 block.statusRows → 会走 hideElement。
  // 给它挂上原生 hidden：此时插件**必须**放弃写 display（该元素由官方/R9 管理）。
  const retrySeat = seat(flow, 'model-retry', 'mr1')
  retrySeat.setAttribute('hidden', 'until-found')
  // 再加两条普通工具行让块可折叠（否则单条不折叠、不建 chip）
  const t1 = seat(flow, 'tool-call', 't1')
  makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2')
  makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 9秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  // 判定：无论走哪条折叠路径，带原生 hidden 的元素都不该被写 style.display
  const hasHiddenAndDisplay = [...flow.querySelectorAll('[hidden]')].filter(n => n.style.display !== '')
  assert(hasHiddenAndDisplay.length === 0,
    'C2-1 任何带原生 hidden 的元素都未被写内联 display（含进入账本的状态行）',
    'offenders=' + hasHiddenAndDisplay.map(n => n.getAttribute('data-chat-flow-kind') + '=' + n.style.display).join(','))
  assert(retrySeat.hasAttribute('hidden'), 'C2-2 原生 hidden 属性保持原值',
    'hidden=' + String(retrySeat.getAttribute('hidden')))
  cleanup()
}

// ── D：正确谓词——data-group-expanded-mode 存在 ⇔ 【非】折叠模式（§4.3 R7）──
{
  console.log('\n=== D：谓词语义（data-group-expanded-mode 存在 ⇔ 非折叠模式，§4.3） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  // 折叠模式（grouped=true，无该属性）+ body 有 hidden
  const a = makeGroup(flow, { turn: 1, activity: 'code', open: false, grouped: true })
  // 非折叠模式（grouped=false，**有**该属性）+ body 无 hidden + 标题层 hidden
  const b = makeGroup(flow, { turn: 2, activity: 'read', open: true, grouped: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 4秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(!a.group.hasAttribute('data-group-expanded-mode'),
    'D1 折叠模式的组**没有** data-group-expanded-mode（属性语义相反）')
  assert(b.group.hasAttribute('data-group-expanded-mode'),
    'D2 非折叠模式的组**有** data-group-expanded-mode')
  // 关键：非折叠模式的组，插件**不应**建 chip 声称折叠了它（body 可见、无可折叠）
  const chips = [...flow.querySelectorAll('.dshcf-seg-chip')]
  assert(chips.length === 0 || chips.every(c => c.parentElement?.getAttribute('data-chat-flow-kind') === 'turn-process'),
    'D3 chip 只挂在 turn-process 座位内（不落 column.children）',
    'parents=' + chips.map(c => String(c.parentElement?.getAttribute('data-chat-flow-kind'))).join(','))
  cleanup()
}

// ── E：chip 绝不带官方锚点属性（§4.2 第 5 条）──────────────────────────────
{
  console.log('\n=== E：chip 属性面（§4.2 第 5 条 / 验收第 21 条） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  // ⚠️ 审查修正：原 fixture 只有 2 个组（一可见一 hidden）→ 覆盖集为空 →
  // chips 数组恒空 → 下面的 for 循环不执行、E2 变成**永真的假断言**。
  // 改为 3 个非 outerHidden 组：最后组由原生维持展开，前两组进入覆盖集 →
  // 必定产出 1 个段级 chip，断言才有鉴别力。
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  const btn = el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  void btn
  makeGroup(flow, { turn: 1, activity: 'code', open: false, grouped: true, outerHidden: false })
  makeGroup(flow, { turn: 1, activity: 'read', open: false, grouped: true, outerHidden: false })
  makeGroup(flow, { turn: 1, activity: 'search', open: true, grouped: true, outerHidden: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  const chips = [...flow.querySelectorAll('.dshcf-chip')]
  // 前置：确认 fixture 真的产出了 chip，否则后续断言仍是假绿。
  assert(chips.length > 0, 'E0 前置：fixture 确实产出了 chip（防假绿）', 'chips=' + chips.length)
  for (const chip of chips) {
    for (const forbidden of ['data-chat-anchor-key', 'data-chat-paging-anchor', 'data-chat-flow-key', 'data-chat-node-key', 'data-chat-turn']) {
      assert(!chip.hasAttribute(forbidden),
        `E chip 不带 ${forbidden}`, 'value=' + String(chip.getAttribute(forbidden)))
    }
  }
  // §4.4 的主体是 **chip**：所有 chip 都不得是 flow（column）的直接子级，
  // 否则会进入 readVisibleTurn 的二分序列（CHAT:4589 column.children）。
  const chipsDirect = [...flow.children].filter(c => c.classList.contains('dshcf-chip'))
  assert(chipsDirect.length === 0, 'E2 没有任何 chip 是 flow（column）的直接子级',
    'found=' + chipsDirect.map(c => String(c.className)).join(','))
  // ⚠️ 如实记录的剩余风险（**非本次引入**，属既有设计）：插件的一级行
  // `.dshcf-processed` 仍然是 flow 的直接子级（placeProcessedRow 的既定摆放）。
  // 它同样参与 readVisibleTurn 的二分序列；其 rect.top 随 DOM 序单调（不破坏
  // 单调性），且无 data-chat-turn → Number(null)=NaN → 只是推进 low 而不改
  // reading，因此**不改变**读到的回合值。此处显式断言该前提成立（它必须无
  // data-chat-turn 且无官方锚点属性），以便未来若有人给它加属性时立刻失败。
  for (const row of [...flow.children].filter(c => c.classList.contains('dshcf-processed'))) {
    assert(!row.hasAttribute('data-chat-turn'), 'E3 一级行不带 data-chat-turn（否则会污染二分读数）')
    assert(!row.hasAttribute('data-chat-anchor-key'), 'E4 一级行不带 data-chat-anchor-key')
  }
  cleanup()
}

// ── F：遗留 style.display 残留被清理（R19 / 验收第 9 条）────────────────────
{
  console.log('\n=== F：老会话遗留 style.display 被清理（R19 / 验收 9） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const { group } = makeGroup(flow, { turn: 1, activity: 'code' })
  // 模拟旧版插件留下的残渣：组根被写了 display:none（永久性——组根无 style prop）
  group.style.display = 'none'
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 2秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(group.style.display === '', 'F1 组根遗留的 display:none 被清除',
    'disp=' + String(group.style.display))
  assert(group.getAttribute('style') === null, 'F2 随之清掉空的 style 属性（验收 9 要求 style.display 恒空串）',
    'style=' + String(group.getAttribute('style')))
  cleanup()
}

// ── G：reasoning part 不被判为正文（§6.2 第 13 条）──────────────────────────
{
  console.log('\n=== G：data-chat-group-part="reasoning" 不是正文（验收 13） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  // reasoning 座位：内容全在 think 行内（真机 reasoningHasBody=0/53）
  const reas = seat(flow, 'assistant-step', 'r1')
  reas.setAttribute('data-chat-group-part', 'reasoning')
  makeThinkRow({ summary: '思考中', parent: reas })
  // response 座位：真正文
  const resp = seat(flow, 'assistant-step', 's1')
  resp.setAttribute('data-chat-group-part', 'response')
  addBodyText(resp, '真正的正文')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 6秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(resp.style.display === '', 'G1 response（正文）保持可见', 'disp=' + String(resp.style.display))
  // reasoning 座位应被视为「思考工作」而非正文——它不该被当成 finalStep 而单独保留。
  // 判定方式：它与 response 同回合；最终正文是 response，reasoning 应随折叠收起。
  const rows = flow.querySelectorAll('.dshcf-processed')
  assert(rows.length <= 1, 'G2 reasoning 不额外制造一级行', 'rows=' + rows.length)
  cleanup()
}

// ── H：verbose（aria-expanded=true + disabled）⇒ 插件完全不介入（§5.10）─────
{
  console.log('\n=== H：原生恒展开且不可折叠 ⇒ 插件不介入（§5.10 / 验收 15） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  // verbose：原生行 aria-expanded="true" 且 disabled（CHAT:6185-6186）
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  const btn = el('button', { 'data-turn-process': '1', 'aria-expanded': 'true' }, tpSeat)
  btn.setAttribute('disabled', '')
  // 该回合的工作：两个工具行（正常 compact 下会被折叠）
  const t1 = seat(flow, 'tool-call', 't1')
  makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2')
  makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 7秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(flow.querySelectorAll('.dshcf-chip').length === 0,
    'H1 verbose 下插件不建任何 chip', 'chips=' + flow.querySelectorAll('.dshcf-chip').length)
  const r1 = t1.querySelector('[data-chat-call-id]')
  assert(r1 === null || r1.style.display === '', 'H2 verbose 下工具行未被插件隐藏',
    'disp=' + String(r1?.style.display))
  assert(t1.style.display === '', 'H3 verbose 下工具 seat 未被插件隐藏', 'disp=' + String(t1.style.display))
  cleanup()
}

// ── I：findFlow 不选中组内容流（§3.2(1) / 验收第 10 条）─────────────────────
{
  console.log('\n=== I：嵌套 flow 下操作作用于外层会话列（验收 10） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const { group, content } = makeGroup(flow, { turn: 1, activity: 'code' })
  const inner = el('div', { 'data-chat-flow-kind': 'tool-call', 'data-chat-anchor-key': 't1' }, content)
  makeToolRow({ callId: 'call:1', tool: 'read', summary: 'inner', parent: inner })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 8秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  // 组内容流自身也是 [data-chat-flow]：插件必须仍作用于外层列（否则一级行会挂错容器）
  assert(content.hasAttribute('data-chat-flow'), 'I0 前置：组内容流确实带 data-chat-flow（双命中场景成立）')
  const pluginRows = [...flow.children].filter(c => String(c.className).includes('dshcf'))
  assert(pluginRows.every(c => c.parentNode === flow), 'I1 插件节点挂在外层列', 'n=' + pluginRows.length)
  // 关键：组 content 内不得出现插件的 row/chip
  const inside = [...content.querySelectorAll('.dshcf-chip, .dshcf-processed, .dshcf-processing, .dshcf-merged-think, .dshcf-merged-body')]
  assert(inside.length === 0, 'I2 组内容流内无插件节点', 'found=' + inside.length)
  cleanup()
}

// ── J：状态词替换——生效、幂等、不误改错误行（验收 11/12）───────────────────
{
  console.log('\n=== J：状态词替换（验收 11/12） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  // 0.1.7 中文界面：公告文案是「深度求索中」，**不含** "Deep diving"
  const announce = el('span', { role: 'status', 'aria-live': 'polite', class: 'visuallyHidden' }, tpSeat)
  textNode('深度求索中', announce)
  // 三处**不得**被误改的提示行（R9）
  const errSeat = seat(flow, 'turn-error', 'e1')
  const errStatus = el('span', { role: 'status' }, errSeat)
  textNode('处理失败', errStatus)
  const retrySeat = seat(flow, 'model-retry', 'mr1')
  const retryStatus = el('span', { role: 'status' }, retrySeat)
  textNode('已重试模型请求（6/30） · 10s', retryStatus)
  const maxSeat = seat(flow, 'turn-max-tokens', 'mt1')
  const maxStatus = el('span', { role: 'status' }, maxSeat)
  textNode('已达到输出 token 上限', maxStatus)
  document.body.appendChild(flow)
  register()
  await env.tick()
  assert(announce.textContent === 'Deep sleeping...', 'J1 中文界面下状态词被替换（旧实现按 "Deep diving" 字面量门禁 → 静默失效）',
    'text=' + announce.textContent)
  assert(errStatus.textContent === '处理失败', 'J2 turn-error 提示行未被误改', 'text=' + errStatus.textContent)
  assert(retryStatus.textContent === '已重试模型请求（6/30） · 10s', 'J3 model-retry 提示行未被误改',
    'text=' + retryStatus.textContent)
  assert(maxStatus.textContent === '已达到输出 token 上限', 'J4 turn-max-tokens 提示行未被误改',
    'text=' + maxStatus.textContent)
  // 幂等：再跑多轮 pass，文本不应变化（旧实现在 statusText 含 "Deep diving" 时逐 pass 累加）
  await env.tick()
  await env.tick()
  assert(announce.textContent === 'Deep sleeping...', 'J5 幂等：多轮 pass 后仍是单份文案（不累加）',
    'text=' + announce.textContent)
  cleanup()
  assert(announce.textContent === '深度求索中', 'J6 stop() 还原宿主原文', 'text=' + announce.textContent)
}

// ── K：A1 覆盖集语义（§5.3）——「除最后一组外」+ 只含可驱动组 ─────────────
{
  console.log('\\n=== K：A1 覆盖集（§5.3 / 杀 M13/M14） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  const g1 = makeGroup(flow, { turn: 1, activity: 'code', open: false, grouped: true, outerHidden: false })
  const g2 = makeGroup(flow, { turn: 1, activity: 'read', open: false, grouped: true, outerHidden: false })
  // 最后一组：open=true 且非 hidden → 由原生维持展开，插件**不得**收起它（M13 会杀）
  const g3 = makeGroup(flow, { turn: 1, activity: 'search', open: true, grouped: true, outerHidden: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 2秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  const chip = flow.querySelector('.dshcf-seg-chip')
  assert(chip !== null, 'K0 前置：产出段级 chip')
  // M13 的变异是「把最后一组也纳入覆盖集」→ chip 计数会变成 3。
  assert((chip?.textContent ?? '').indexOf('2 个工具组') >= 0,
    'K1 覆盖集恰为「除最后一组外」的 2 组（不是 3）', 'text=' + (chip?.textContent ?? ''))
  assert(g1.btn.getAttribute('aria-expanded') === 'false', 'K2 覆盖组 1 被驱动为收起', 'aria=' + String(g1.btn.getAttribute('aria-expanded')))
  assert(g2.btn.getAttribute('aria-expanded') === 'false', 'K3 覆盖组 2 被驱动为收起', 'aria=' + String(g2.btn.getAttribute('aria-expanded')))
  assert(g3.btn.getAttribute('aria-expanded') === 'true', 'K4 最后一组**不被**驱动（保持原生展开）', 'aria=' + String(g3.btn.getAttribute('aria-expanded')))
  cleanup()
}

// ── L：outerHidden 组不进覆盖集（§4.3 R7：chip 不谎报）────────────────────
{
  console.log('\\n=== L：outerHidden 组不纳入覆盖集（§4.3 / 杀 M8/M14） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  // 第 1 组 outerHidden（已闭合历史回合的常态）→ 必须被**排除**在覆盖集外
  const hiddenGroup = makeGroup(flow, { turn: 1, activity: 'code', open: false, grouped: true, outerHidden: true })
  const g2 = makeGroup(flow, { turn: 1, activity: 'read', open: false, grouped: true, outerHidden: false })
  const g3 = makeGroup(flow, { turn: 1, activity: 'search', open: false, grouped: true, outerHidden: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 3秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  const chip = flow.querySelector('.dshcf-seg-chip')
  // 覆盖集 = 「最后一个非 outerHidden 组」之前的**可见**组 = 仅 g2 → 计数 1。
  // 若把 outerHidden 组也算进来（旧实现），计数会变成 2 → chip 谎报折叠数。
  assert((chip?.textContent ?? '').indexOf('1 个工具组') >= 0,
    'L1 chip 计数只含真正可驱动的组（不谎报 outerHidden 组）', 'text=' + (chip?.textContent ?? ''))
  assert(hiddenGroup.btn.getAttribute('aria-expanded') === 'false',
    'L2 outerHidden 组的按钮**未被插件驱动**（避免 c2 反冲）', 'aria=' + String(hiddenGroup.btn.getAttribute('aria-expanded')))
  assert(g2.btn.getAttribute('aria-expanded') === 'false', 'L3 覆盖组被驱动为收起')
  cleanup()
}

// ── M：verbose（原生恒展开）不建任何 chip（§5.10，杀相关变异）──────────────
{
  console.log('\\n=== M：verbose 下不介入（§5.10） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  const btn = el('button', { 'data-turn-process': '1', 'aria-expanded': 'true' }, tpSeat)
  btn.setAttribute('disabled', '')
  makeGroup(flow, { turn: 1, activity: 'code', open: true, grouped: false })
  makeGroup(flow, { turn: 1, activity: 'read', open: true, grouped: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 4秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(flow.querySelectorAll('.dshcf-seg-chip').length === 0,
    'M1 verbose 下不建段级 chip', 'n=' + flow.querySelectorAll('.dshcf-seg-chip').length)
  cleanup()
}
// ── N：muting **记录并延迟重放**（§5.5 第 4 条，杀 M10）─────────────────────
{
  console.log('\\n=== N：muting 记录并延迟重放（不丢弃） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  const g1 = makeGroup(flow, { turn: 1, activity: 'code', open: false, grouped: true, outerHidden: false })
  const g2 = makeGroup(flow, { turn: 1, activity: 'read', open: false, grouped: true, outerHidden: false })
  const g3 = makeGroup(flow, { turn: 1, activity: 'search', open: true, grouped: true, outerHidden: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 6秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  // 【M10 的判别】把 driveGroups 的 muting 语义破坏成「丢弃不重放」时，
  // 插件会在 click 驱动期间丢失 flow 内的真实变化。这里制造一个**必然发生**
  // 的重放场景：click 驱动后（muting 窗口内）宿主又追加一条新的工作行。
  // 断言：插件在 muting 解除后仍能对该次变化做出反应（重放生效）。
  assert(flow.querySelector('.dshcf-seg-chip') !== null, 'N0 前置：产出段级 chip')
  // 【M10 的判别】制造**恰好发生在 muting 窗口内**的 mutation：
  // 给 g1 的标题按钮装一个同步点击处理器（模拟 React 的 onClick 同步改 DOM），
  // 它在 driveGroups 调用 button.click() 期间（muting=true）往段内插入一个新组。
  //
  // · 若 records 被**重放** → 插件 schedule 下一 pass → 新组被纳入并驱动（aria=false）；
  // · 若 records 被**丢弃** → 新组永远不被评估（保持初始 aria=true）。
  assert(g1.btn.getAttribute('aria-expanded') === 'false', 'N0 前置：初始驱动已把 g1 收起')
  // 现在把 g1 恢复为展开（模拟用户/宿主把它打开），并**预装**注入处理器：
  // 下一次 driveGroups 驱动 g1 时（muting=true 窗口内）同步插入一个新组。
  g1.btn.setAttribute('aria-expanded', 'true')
  let injected = false
  let nExtra = null
  g1.btn.addEventListener('click', () => {
    if (injected) return
    injected = true
    // 插到**最前**：这样它落在「除最后一组外」的覆盖集内，能验证重放后
    // 新组被纳入驱动。若插到最后，它自己就是「最后组」，按 A1 本就不该被驱动。
    const extra = makeGroup(flow, { turn: 1, activity: 'write', open: true, grouped: true, outerHidden: false })
    flow.insertBefore(extra.group, g1.group)
    env.notifyMutations([{ type: 'childList', target: flow, addedNodes: [extra.group], removedNodes: [] }])
    nExtra = extra
  })
  // 触发一轮 pass：插件发现 g1 又变成 true（≠ 目标 false）→ 进入 muting 驱动 →
  // 注入的 mutation 必须被重放，下一 pass 才能把新组纳入覆盖集。
  env.notifyMutations([])
  env.flushRaf()
  // ⚠️ 这里**只能**用 flushRaf，不能再用 env.tick()：`tick()` 内部会先调
  // `notifyMutations()`（空 records → shouldSchedule 恒真）→ **无条件**调度新一轮
  // pass，从而掩盖「重放是否发生」。用 flushRaf 就只消费插件**自己排队的** rAF
  // ——这正是 muting 重放路径唯一会排的东西（M10 把它改成丢弃后队列为空）。
  env.flushRaf()
  env.flushRaf()
  assert(injected, 'N1 前置：驱动确实触发了同步 mutation 注入', 'injected=' + injected)
  // 【M10 的判别断言】桩里 `button.click()` 没有 React 帮忙翻转 aria-expanded，
  // 所以「驱动是否生效」在桩中不可观测；但「muting 期间的 mutation 是否被重放」
  // 完全可观测：重放 → 插件 schedule 新一轮 pass → 重新 findBlocks/buildSegments →
  // **新组进入覆盖集** → chip 计数从 2 变 3。
  // 若把 releaseMuting 改成「丢弃不重放」（M10），这一轮 pass 不会被调度，
  // chip 会停在 2 → 本断言 FAIL。
  const label = flow.querySelector('.dshcf-seg-chip')?.textContent ?? ''
  assert(label.indexOf('3 个工具组') >= 0,
    'N2 muting 窗口内的 mutation 被重放（新组进入覆盖集，chip 计数 2→3）',
    'text=' + label)
  cleanup()
}
// ── O：onfinish 回调路径守卫（§4.2 回调侧，杀 M4）────────────────────────────
{
  console.log('\\n=== O：淡出动画在途期间元素新获得 hidden 时，回调不得写 display（杀 M4） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  // 一个普通工具块（无原生 turn-process 座位：走插件自建一级行的动画路径）。
  const t1 = seat(flow, 'tool-call', 't1')
  makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2')
  makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 7秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  // 一级展开 → 二级 chip 出现；再点 chip 展开、再点 chip 收起 → 走 startFadeCollapse。
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, 'O0a 前置：存在一级行')
  row?.dispatchEvent('click')
  await env.tick()
  let chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, 'O0b 前置：一级展开后出现二级 chip', 'chips=' + flow.querySelectorAll('.dshcf-chip').length)
  chip?.dispatchEvent('click')   // 二级展开
  await env.tick()
  chip = flow.querySelector('.dshcf-chip')
  // 【关键】先记录动画条目数，再在**动画在途期间**给行挂原生 hidden。
  const rows = [t1.querySelector('[data-chat-call-id]'), t2.querySelector('[data-chat-call-id]')].filter(r => r !== null)
  assert(rows.length > 0, 'O0c 前置：存在待动画的工具行', 'n=' + rows.length)
  const before = rows.map(r => (r._animations ?? []).length)
  chip?.dispatchEvent('click')   // 手势收起：只置状态 + schedule（动画在 pass 里起）
  // 用 flushRaf（**同步**跑 pass）启动动画，且不让 5ms 的 tick 窗口把动画提前结算。
  env.flushRaf()
  const after = rows.map(r => (r._animations ?? []).length)
  assert(after.some((n, i) => n > before[i]),
    'O0d 前置：收起方向确实启动了渐隐动画（否则本用例是假绿）',
    'before=' + before.join(',') + ' after=' + after.join(','))
  // 【关键】动画仍在途（onfinish 尚未执行）：此刻给行挂上原生 hidden，
  // 再等动画结算——回调若写 display:none 就会被下面抓到。
  for (const r of rows) r.setAttribute('hidden', 'until-found')
  const pending = rows.filter(r => !(r._animations ?? []).every(a => a._done))
  assert(pending.length > 0, 'O0e 前置：断言时动画确实仍在途（未结算）', 'pending=' + pending.length)
  await new Promise(r => setTimeout(r, 25))   // 排干 FakeAnimation 的 setTimeout(0) settle
  env.flushRaf()
  const offenders = [...flow.querySelectorAll('[hidden]')].filter(n => n.style.display === 'none')
  assert(offenders.length === 0,
    'O1 动画结算时已带 hidden 的元素未被写 display:none（回调路径守卫）',
    'offenders=' + offenders.map(n => (n.getAttribute('data-chat-flow-kind') ?? n.className) + '=' + n.style.display).join(','))
  cleanup()
}
// ── Q：不留永久残留——插件隐藏过的元素必须能恢复（撤销 restoreElement 守卫的回归锁）──
{
  console.log('\\n=== Q：插件隐藏过的元素必被恢复，不留永久 display:none ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const t1 = seat(flow, 'tool-call', 't1')
  makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2')
  makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 8秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  const rowInT1 = t1.querySelector('[data-chat-call-id]')
  assert(rowInT1 !== null, 'Q0 前置：存在插件管理过的工具行')
  // 折叠后插件把该行写成 display:none —— 契约要求 stop() 后必须能还原。
  assert(rowInT1.style.display === 'none', 'Q1 折叠态：行被插件隐藏', 'disp=' + String(rowInT1.style.display))
  // 【关键】模拟 React 在此之后给该行挂上原生 hidden（真实重渲染会出现）。
  rowInT1.setAttribute('hidden', 'until-found')
  cleanup()   // stop()：插件必须清掉**自己写的** display:none，绝不留下永久残留
  assert(rowInT1.style.display === '',
    'Q2 stop() 后插件写的 display 被清除（即使该元素已带原生 hidden）——不留 B1 类永久残留',
    'disp=' + String(rowInT1.style.display))
}
// ── L2：mixed fixture——非折叠模式（data-group-expanded-mode）组不进覆盖集 ──
// ★ 复审发现的缺口：L1 只覆盖 outerHidden 轴，而 groupCollapsibleMode 是**另一条**
// 门禁（driveGroups 两者都查）。因 grouped 与 outerHidden 互斥，L1 结构上抓不到本轴。
// 本用例专测它：chip 计数必须与实际可驱动组数恒等（R7 不许谎报）。
{
  console.log('\\n=== L2：非折叠模式组不进覆盖集（§4.3 R7 第二轴） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  // 中间组处于**非折叠模式**（grouped=false → 写 data-group-expanded-mode、body 无 hidden）。
  // 它不可被驱动（driveGroups 会 continue），因此**不得**计入 coverage。
  const nonGrouped = makeGroup(flow, { turn: 1, activity: 'code', open: true, grouped: false })
  const g2 = makeGroup(flow, { turn: 1, activity: 'read', open: false, grouped: true, outerHidden: false })
  const g3 = makeGroup(flow, { turn: 1, activity: 'search', open: false, grouped: true, outerHidden: false })
  const fin = seat(flow, 'assistant-step', 'f1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 10秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(nonGrouped.group.hasAttribute('data-group-expanded-mode'),
    'L2-0 前置：中间组确实处于非折叠模式（有 data-group-expanded-mode）')
  const chip = flow.querySelector('.dshcf-seg-chip')
  // 可驱动组 = {g2}（nonGrouped 被排除；g3 是最后一个可驱动组 → 排除）。
  // 若覆盖集漏掉这条门禁，计数会是 2（把 nonGrouped 也算上）→ 谎报。
  assert(chip === null || (chip.textContent || '').indexOf('1 个工具组') >= 0,
    'L2-1 chip 计数只含真正可驱动的组（非折叠模式组被排除，不谎报）',
    'text=' + (chip?.textContent ?? '<no chip>'))
  assert(nonGrouped.btn.getAttribute('aria-expanded') === 'true',
    'L2-2 非折叠模式的组未被插件驱动（保持原状）', 'aria=' + String(nonGrouped.btn.getAttribute('aria-expanded')))
  cleanup()
}
console.log(`\n${failures === 0 ? '[ALL PASS]' : `[${failures} FAILURE(S)]`}`)
process.exitCode = failures === 0 ? 0 : 1
