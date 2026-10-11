/**
 * fold-live.test.mjs — 回合进行中实时摘要行 + 二级 chip 分层粒度计数回归测试。
 * 对齐 dsh-turn-fold：
 *   1) open（未闭合）回合显示实时摘要行（.dshcf-processing，含"已工作"耗时），
 *      闭合后由 .dshcf-processed 一级行接管；
 *   2) 完成态"运行了命令"chip 展示思考/工具调用次数，失败数（浅红，独立 span）。
 *
 * 用法：node test/fold-live.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow } from './fake-dom.mjs'

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
  const scopeMock = { getSnapshot: () => ({ status: 'ready', value: { keepLastRows: 1, statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }), subscribe: () => () => {}, set: async () => {}, unset: async () => {} }
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
function addThink(seatEl, summary, state = 'ok') {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  makeThinkRow({ state, summary, parent: body })
}
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, body))
}

{
  console.log('\n=== 场景: open 回合显示实时摘要行，闭合后由已处理行接管 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'running')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', state: 'running', summary: 'Get-Content a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addThink(fin, '最终思考'); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const live = flow.querySelector('.dshcf-processing')
  assert(live !== null, 'open 回合生成实时摘要行')
  assert(live !== null && live.textContent.includes('已工作'), '实时摘要行显示"已工作"耗时', 'text=' + (live?.textContent ?? ''))
  assert(live !== null && live.getAttribute('role') === 'status', '实时摘要行 role=status')
  assert(flow.querySelector('.dshcf-processed') === null, 'open 回合不生成已处理一级行')
  assert(live !== null && live.nextElementSibling === s1, '实时摘要行位于首个工作元素上方')
  // 工具转完成 + 闭合
  t1.querySelector('[data-tool]').setAttribute('data-state', 'ok')
  s1.querySelector('[data-variant="think"]').setAttribute('data-state', 'ok')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') === null, '闭合后实时摘要行移除')
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '闭合后生成已处理一级行')
  cleanup()
}

{
  console.log('\n=== 场景: 完成态"运行了命令"chip 展示思考/工具调用/失败计数 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('改文件', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'pwsh', state: 'error', summary: 'cmd', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '一级展开后生成二级 chip')
  assert(chip !== null && chip.textContent.includes('运行了命令'), 'chip 标题为运行了命令', 'text=' + (chip?.textContent ?? ''))
  assert(chip !== null && chip.textContent.includes('1 段思考'), 'chip 显示思考段数', 'text=' + (chip?.textContent ?? ''))
  assert(chip !== null && chip.textContent.includes('Read ×1') && chip.textContent.includes('Pwsh ×1'), 'chip 按工具名×次数显示调用（Read ×1 · Pwsh ×1）', 'text=' + (chip?.textContent ?? ''))
  const failure = chip?.querySelector('.dshcf-chip-failure')
  assert(failure !== null && failure !== undefined && failure.textContent === '1 个失败', '失败计数独立 span', 'failure=' + (failure?.textContent ?? 'null'))
  assert(failure !== null && failure !== undefined && failure.style.display === '', '失败计数可见', 'display=' + (failure?.style.display ?? 'null'))
  // 展开二级后摘要消失（三级原生行接管展示）
  chip.dispatchEvent('click')
  await env.tick()
  const summaryAfterExpand = chip.querySelector('.dshcf-chip-summary').textContent
  assert(summaryAfterExpand === '', '二级展开后计数摘要清空', 'summary=' + summaryAfterExpand)
  cleanup()
}

{
  console.log('\n=== 场景: 运行中 chip 不显示失败计数（P2-1） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  // 一条已完成 think：§5.8 后 keepRow 恒 false ⇒ 它必然折进 chip，
  // 运行中 chip 因此存在（折叠行只在确有被折叠行时出现）。
  const s0 = seat(flow, 'assistant-step', 's0', 26); addThink(s0, '第一步', 'ok')
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'running')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', state: 'running', summary: 'Get-Content a.txt', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', state: 'error', summary: 'b.txt', parent: t2 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '运行中生成二级 chip')
  assert(chip !== null && chip.textContent.includes('正在运行'), 'chip 标题为正在运行', 'text=' + (chip?.textContent ?? ''))
  const failure = chip?.querySelector('.dshcf-chip-failure')
  assert(failure !== null && failure !== undefined && failure.style.display === 'none', '运行中不显示失败计数', 'display=' + (failure?.style.display ?? 'null'))
  cleanup()
}

{
  console.log('\n=== 场景: 完成态无失败时失败计数 span 隐藏（P2-6） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('改文件', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '一级展开后生成二级 chip')
  assert(chip !== null && chip.textContent.includes('运行了命令'), 'chip 标题为运行了命令', 'text=' + (chip?.textContent ?? ''))
  const failure = chip?.querySelector('.dshcf-chip-failure')
  assert(failure !== null && failure !== undefined && failure.style.display === 'none', '无失败时失败计数 span 隐藏', 'display=' + (failure?.style.display ?? 'null'))
  cleanup()
}


{
  console.log('\n=== 场景: 运行中 chip 收起、块内全部行（含 running）折进 chip（issue #3 / §5.8） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  // 已完成 think + running tool（同一块）
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'ok')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', state: 'running', summary: 'Get-Content a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '运行中生成二级 chip')
  assert(chip !== null && chip.getAttribute('aria-expanded') === 'false', 'chip 保持收起（不再强制展开）', 'aria=' + chip?.getAttribute('aria-expanded'))
  // §5.8：尾行保留窗口已移除 ⇒ running 工具行同样折进 chip（与已完成行同规则）。
  const toolRow = t1.querySelector('[data-chat-call-id]')
  assert(toolRow.style.display === 'none', 'running 工具行同样折进 chip（§5.8 后无尾行保留）', 'row=' + toolRow.style.display)
  // 已完成 think 行折叠进 chip
  const thinkRow = s1.querySelector('[data-variant="think"]')
  assert(thinkRow.style.display === 'none', '已完成 think 行折叠进 chip', 'think=' + thinkRow.style.display)
  // 多次 tick 后不反复折叠/展开（chip 仍收起）
  await env.tick(); await env.tick(); await env.tick()
  assert(chip.getAttribute('aria-expanded') === 'false', '多次 tick 后 chip 仍收起（不反复折叠/展开）', 'aria=' + chip.getAttribute('aria-expanded'))
  assert(toolRow.style.display === 'none', '多次 tick 后 running 行仍折进 chip（无反复折叠/展开）', 'row=' + toolRow.style.display)
  cleanup()
}

{
  console.log('\n=== 场景: 回合结束后出现的回合外 command 节点（dsh-recap 的 /recap 结果卡）不生成实时指标行 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', state: 'ok', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  // dsh-recap 在 conversation.chat.commandview 渲染的原生 command 座位
  // （turn-tail 之后追加）——回合已经结束，但它没有边界可闭合。
  const cmd = seat(flow, 'command', 'c1', 30); textNode('recap 结果文本', cmd)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') === null,
    '回合外 command 残段不生成实时指标行（不再永远计时）',
    'live=' + (flow.querySelector('.dshcf-processing')?.textContent ?? 'none'))
  // 多次 tick 后依然不出现（旧实现会每秒重建并持续走表）
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') === null, '多轮 pass 后仍无实时指标行')
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '已结束回合的"已处理"行不受影响')
  // 反证：同一形态若去掉 command 残段，修复前后行为一致（有工作 + turn-tail ⇒ 已处理行）
  cleanup()
}

{
  console.log('\n=== 场景: command 残段存在时，后续新回合仍照常生成实时指标行 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  const cmd = seat(flow, 'command', 'c1', 30); textNode('recap 结果文本', cmd)
  // 新回合：user 边界把它闭合，新段内有 running 行 ⇒ 实时行成立
  const user2 = seat(flow, 'user', 'u2', 40); textNode('继续', user2)
  const s2 = seat(flow, 'assistant-step', 's2', 26); addThink(s2, '新一轮思考', 'running')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const lives = flow.querySelectorAll('.dshcf-processing')
  assert(lives.length === 1, 'command 残段只影响自身，新回合实时行照常出现', 'count=' + lives.length)
  cleanup()
}

{
  console.log('\n=== 场景: 会话仍在运行（原生 [data-chat-running]）时保留实时指标行（不误伤） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  // 本回合的行全部处于完成态：段级 runningNow 为假，只有原生运行指示器能证明回合在跑；
  // 计来源走注入器（真机同一形态：注入器发布 turnStartTime）。
  const s0 = seat(flow, 'assistant-step', 's0', 26); addThink(s0, '第一步', 'ok')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', state: 'ok', parent: t1 })
  el('div', {
    'data-dshcf-turn-metrics': JSON.stringify({ turnStartTime: Date.now() - 10000, modelCalls: 1 }),
    'data-dshcf-turn': '1', 'data-dshcf-session': 'sess-x', 'data-dshcf-seg': '0',
  }, s0)
  // DSH RunningStatus（CHAT:3920）：flow 的直接子级，仅会话 running 时挂载
  el('div', { 'data-chat-running': '' }, flow)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const live = flow.querySelector('.dshcf-processing')
  assert(live !== null, '原生运行指示器在场时仍生成实时指标行', 'live=' + (live?.textContent ?? 'none'))
  assert(live !== null && live.textContent.includes('已工作'), '实时行照常显示计时（不再被门禁误伤）', 'label=' + (live?.textContent ?? ''))
  cleanup()
}

{
  console.log('\n=== 场景: 无原生指示器且无 running 行 ⇒ 不显示实时行（门禁的另一半） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const s0 = seat(flow, 'assistant-step', 's0', 26); addThink(s0, '第一步', 'ok')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', state: 'ok', parent: t1 })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') === null, '无运行信号时不生成实时指标行', 'live=' + (flow.querySelector('.dshcf-processing')?.textContent ?? 'none'))
  cleanup()
}

{
  console.log('\n=== 场景: /recap 生成中（命令座位 data-state=running）仍不生成实时指标行 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', state: 'ok', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  // GenericCommandCard 在 /recap 执行期间的真实形态：座位内层 data-state="running"
  // （它是官方 INDEPENDENT 节点，渲染在回合工作流之外，不属于任何进行中的回合）。
  const cmd = seat(flow, 'command', 'c1', 30)
  el('div', { 'data-variant': 'others', 'data-state': 'running' }, cmd)
  textNode('recap 正在整理回顾…', cmd)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') === null,
    '回合外命令座位自身的 running 态不触发实时指标行',
    'live=' + (flow.querySelector('.dshcf-processing')?.textContent ?? 'none'))
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') === null, '多轮 pass 后仍无实时指标行')
  cleanup()
}

{
  console.log('\n=== 场景: 会话在跑（[data-chat-running] 在场）时，回合外 command 残段仍不生成实时行 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  // 下一条消息尚未落地、但会话已 running：新回合 user 座位还不是边界 ⇒ 残段仍是末段
  el('div', { 'data-chat-running': '' }, flow)
  const cmd = seat(flow, 'command', 'c1', 30)
  el('div', { 'data-variant': 'others', 'data-state': 'ok' }, cmd)
  textNode('recap 结果文本', cmd)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') === null,
    '会话 running 不解除回合外残段的豁免（审查问题③）',
    'live=' + (flow.querySelector('.dshcf-processing')?.textContent ?? 'none'))
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') === null, '多轮 pass 后仍无实时指标行')
  cleanup()
}

{
  console.log('\n=== 场景: 会话在跑 + 真实工作段 ⇒ 实时行照常（豁免不外溢） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const s0 = seat(flow, 'assistant-step', 's0', 26); addThink(s0, '第一步', 'ok')
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', state: 'ok', parent: t1 })
  el('div', {
    'data-dshcf-turn-metrics': JSON.stringify({ turnStartTime: Date.now() - 10000, modelCalls: 1 }),
    'data-dshcf-turn': '1', 'data-dshcf-session': 'sess-x', 'data-dshcf-seg': '0',
  }, s0)
  el('div', { 'data-chat-running': '' }, flow)
  const cmd = seat(flow, 'command', 'c1', 30); textNode('recap 残段', cmd)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const lives = flow.querySelectorAll('.dshcf-processing')
  assert(lives.length === 1, '真实工作段照常生成 1 条实时行', 'count=' + lives.length)
  assert((lives[0]?.textContent ?? '').includes('已工作'), '实时行显示计时', 'label=' + (lives[0]?.textContent ?? ''))
  // 锚点断言：豁免不外溢，实时行仍锚在真实工作段（command 残段在末尾，不得成为锚点）
  assert(lives[0]?.nextElementSibling !== cmd, '实时行锚点不是末尾的 command 残段', 'next=' + (lives[0]?.nextElementSibling?.getAttribute('data-chat-flow-kind') ?? 'null'))
  cleanup()
}

{
  console.log('\n=== 场景: command 残段后无边界续接 running 工具行 ⇒ 不算外部残段（二轮审查修正） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  // command 座位 + 紧邻的 running 工具行（中间无 user/steering/turn-tail 边界）：
  // findBlocks 的 run 游标会把二者并进同一个 Block（host = 最靠前的 command 座位），
  // 仅按 host kind 判定会误判为纯残段、吞掉实时行。
  const cmd = seat(flow, 'command', 'c1', 30); textNode('recap 结果文本', cmd)
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'pwsh', state: 'running', summary: 'Get-Content b.txt', parent: t2 })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const live = flow.querySelector('.dshcf-processing')
  assert(live !== null,
    '段内含真实工具行时不被判为外部残段（实时行保留）',
    'live=' + (flow.querySelector('.dshcf-processing')?.textContent ?? 'none'))
  // 顺序断言：实时行必须出现在真实工作行**之前**（说明它随真实工作段建立，
  // 而不是被误判为残段后另行挂到别处）。注：本场景里 command 座位与 tool 行被
  // findBlocks 并成同一 Block（host = command 座位），故锚点的 nextElementSibling
  // 可能是该块的 chip —— 因此按文档顺序而非相邻关系断言。
  const kids = [...flow.children]
  assert(live !== null && kids.indexOf(live) < kids.indexOf(t2),
    '实时行位于真实工作行之前（按真实工作段建立）',
    'liveIdx=' + (live === null ? -1 : kids.indexOf(live)) + ' t2Idx=' + kids.indexOf(t2))
  cleanup()
}

{
  console.log('\n=== 场景: command 残段紧邻已完成 think 行（被并块）⇒ 不算外部残段（三轮加固） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  // pre-0.1.7 布局：command 座位紧邻已完成 think 座位（无官方组、无正文），
  // findBlocks 会把 think 行并进 command 块（host = command 座位）。
  const s0 = seat(flow, 'assistant-step', 's0', 26); addThink(s0, '第一步', 'ok')
  const cmd = seat(flow, 'command', 'c1', 30); textNode('recap 结果文本', cmd)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  // 对照：同布局但 think 为 running（真实进行中回合）⇒ think 行并进 command 块
  // 时不得被 external 豁免吞掉——这正是加固要保护的窗口。
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '正在思考', 'running')
  await env.tick(); await env.tick()
  const live = flow.querySelector('.dshcf-processing')
  assert(live !== null,
    'command 紧邻 running think（被并块）不算外部残段（实时行保留）',
    'live=' + (flow.querySelector('.dshcf-processing')?.textContent ?? 'none'))
  // 锚点：实时行应指向含真实 think 行的段（s1 座位）而非纯 recap 卡
  const kids = [...flow.children]
  assert(live !== null && kids.indexOf(live) < kids.indexOf(s1),
    '实时行位于真实工作内容之前', 'liveIdx=' + (live === null ? -1 : kids.indexOf(live)) + ' s1Idx=' + kids.indexOf(s1))
  cleanup()
}

{
  console.log('\n=== 场景: 真实回合工作段（含正文）的 running 不受命令节点豁免影响 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', state: 'running', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '进行中正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') !== null, '含真实工作内容的段仍生成实时指标行', 'live=' + (flow.querySelector('.dshcf-processing')?.textContent ?? 'none'))
  cleanup()
}

{
  console.log('\n=== 场景: 运行中段内的 running 行独立成立（无原生指示器也保留） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const s1 = seat(flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'running')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-processing') !== null, '段内有 running 行时生成实时指标行')
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1