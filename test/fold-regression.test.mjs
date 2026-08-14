/**
 * fold-regression.test.mjs — review 修复的回归测试。用真实 bundle
 * （lib/client.js）驱动会话流 fixture，覆盖：
 *
 *  1. P1-1：最终输出 kind='assistant'（真实 DSH 契约）——中间 assistant-step
 *     过程正文必须整条折叠，不能残留可见。
 *  2. P1-2：正文后的遗留思考行（Think1-正文-Think2）——流末尾无堆积块时
 *     完成态必须折叠，不能残留可见。
 *  3. P2-1：flow 顶层装饰元素（TurnStatus role="status"）不打断工具组合并。
 *  4. 竞态：turn-tail 先于工具 done 到达 → pending → done 后恰一行已处理。
 *  5. 宿主被替换（极端重渲染）→ chip 自愈、无重复行、无残留。
 *  6. 切会话（flow 整体替换）→ 无串味、无残留搬移。
 *  7. stop() 完整性：全部还原、无残留节点、Deep sleeping 还原。
 *  8. 纯文本回合（无 think/tool）不生成一级行（既有产品语义确认）。
 *
 * 用法：node test/fold-regression.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundlePath = join(root, 'lib/client.js')

const code = readFileSync(bundlePath, 'utf8')

let failures = 0
function assert(cond, label, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

// ---------------------------------------------------------------------------
// 通用启动：返回 { env, flow, apply 后的 cleanup, 重新登记 document._all 的 helper }
// ---------------------------------------------------------------------------
function boot() {
  const env = installDomGlobals()
  const { document } = env
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) {
      moduleExports = spec.factory(() => { throw new Error('require unsupported in stub') })
    },
  }
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  let cleanup = null
  moduleExports.apply({ effect: (fn) => { cleanup = fn() } })
  const flow = el('div', { 'data-chat-flow': '' })
  flow.offsetParent = {}
  flow.setRect({ width: 800, height: 600 })
  function register() {
    const seen = new Set(document._all)
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 1) {
          if (!seen.has(c)) { seen.add(c); document._all.push(c) }
          walk(c)
        }
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

function addThink(seatEl, { state = 'ok', summary = '', bodyText = null }) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  return makeThinkRow({ state, summary, bodyText, parent: body })
}

function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  const markdown = el('div', { class: 'markdown' }, body)
  textNode(text, markdown)
  return markdown
}

// ---------------------------------------------------------------------------
// 场景 1：P1-1 最终输出 kind='assistant'
// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 1: P1-1 最终输出 kind=assistant（中间 step 过程正文整条折叠） ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40)
  textNode('帮我读文件', user)
  const step1 = seat(flow, 'assistant-step', 's1', 80)
  addThink(step1, { summary: '第一步思考' })
  addBodyText(step1, '第一步过程正文')
  const tool = seat(flow, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'Get-Content a.txt', parent: tool })
  const step2 = seat(flow, 'assistant-step', 's2', 80)
  addThink(step2, { summary: '第二步思考' })
  addBodyText(step2, '第二步过程正文')
  const final = seat(flow, 'assistant', 'a1', 100)
  addThink(final, { summary: '最终思考' })
  addBodyText(final, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  const rows = () => flow.querySelectorAll('.dshcf-processed')
  assert(rows().length === 1, '恰一行 .dshcf-processed')
  assert(step1.style.display === 'none', '中间 step1 整条折叠', `display=${step1.style.display}`)
  assert(step2.style.display === 'none', '中间 step2 整条折叠（修复前残留可见）', `display=${step2.style.display}`)
  assert(tool.style.display === 'none', '工具卡 seat 折叠', `display=${tool.style.display}`)
  assert(final.style.display === '', '最终输出宿主可见', `display=${final.style.display}`)
  const finalThink = final.querySelector('[data-variant="think"]')
  assert(finalThink.style.display === 'none', '最终输出 think 行折叠', `display=${finalThink.style.display}`)
  cleanup()
}

// ---------------------------------------------------------------------------
// 场景 2：P1-2 遗留思考行（Think1-正文-Think2，流末尾）
// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 2: P1-2 正文后遗留思考行完成态折叠 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40)
  textNode('问个问题', user)
  const final = seat(flow, 'assistant', 'a1', 120)
  const t1 = addThink(final, { summary: '先想' })
  addBodyText(final, '中间正文')
  const t2 = addThink(final, { summary: '再想' })
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  assert(t1.style.display === 'none', 'Think1 完成态折叠', `display=${t1.style.display}`)
  assert(t2.style.display === 'none', 'Think2（遗留行）完成态折叠（修复前残留可见）', `display=${t2.style.display}`)
  // 一级展开：宿主可见，二级 chip 保持收起（思考行仍隐藏，素材对齐）
  const row = flow.querySelector('.dshcf-processed')
  row.dispatchEvent('click')
  await env.tick()
  assert(final.style.display === '', '一级展开后宿主可见', `display=${final.style.display}`)
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '一级展开后生成二级 chip')
  assert(t1.style.display === 'none' && t2.style.display === 'none', '二级收起态思考行保持隐藏')
  // 点击二级 chip 展开：连续思考合并为三级行（设计），原始行由合并行承载
  chip.dispatchEvent('click')
  await env.tick()
  const merged = flow.querySelector('.dshcf-merged-think')
  assert(merged !== null, '二级展开后连续思考合并为三级行')
  assert(t1.style.display === 'none' && t2.style.display === 'none', '原始思考行由合并行承载（隐藏）')
  // 点击三级合并行：显示合并内容块（原始四级行不出现，README 契约）
  merged.dispatchEvent('click')
  await env.tick()
  const body = flow.querySelector('.dshcf-merged-body')
  assert(body !== null, '三级展开后生成合并内容块')
  const bodyText = body.textContent ?? ''
  assert(bodyText.includes('先想') && bodyText.includes('再想'), '内容块包含全部思考文本（含遗留行）', bodyText)
  assert(t1.style.display === 'none' && t2.style.display === 'none', '原始思考行保持隐藏（四级行不出现）')
  cleanup()
}

// ---------------------------------------------------------------------------
// 场景 3：P2-1 装饰元素（TurnStatus）不打断合并
// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 3: P2-1 TurnStatus 装饰元素不打断工具组合并 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40)
  textNode('跑命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd1', parent: t1 })
  const status = el('div', { role: 'status' }, flow)
  textNode('Deep diving...', status)
  const t2 = seat(flow, 'tool-call', 't2', 30)
  makeToolRow({ callId: 'call:2', tool: 'read', summary: 'cmd2', parent: t2 })
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  const chips = () => flow.querySelectorAll('.dshcf-chip')
  assert(chips().length === 0, '完成态 chip 未创建（整块收进已处理行）', `chips=${chips().length}`)
  const st = flow.querySelector('[role="status"]')
  assert(st.textContent.includes('Deep sleeping'), '状态行文本替换为 Deep sleeping')
  // 一级展开 → 工具组合并为恰一个 chip（TurnStatus 未断开合并）
  const row = flow.querySelector('.dshcf-processed')
  row.dispatchEvent('click')
  await env.tick()
  assert(chips().length === 1, '工具组未被装饰元素断开（恰一个 chip）', `chips=${chips().length}`)
  // 点击 chip 第一次：展开（一级展开后二级默认收起）——两条命令行都显示
  const chip = chips()[0]
  chip.dispatchEvent('click')
  await env.tick()
  const r1 = t1.querySelector('[data-chat-call-id]')
  const r2 = t2.querySelector('[data-chat-call-id]')
  assert(r1.style.display === '' && r2.style.display === '', '同一块内两条命令行一起展开', `r1=${r1.style.display} r2=${r2.style.display}`)
  // 再点：一起收起
  chip.dispatchEvent('click')
  await env.tick()
  assert(r1.style.display === 'none' && r2.style.display === 'none', '同一块内两条命令行一起收起', `r1=${r1.style.display} r2=${r2.style.display}`)
  cleanup()
}

// ---------------------------------------------------------------------------
// 场景 4：竞态（turn-tail 先到，工具后 done）
// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 4: 竞态 turn-tail 先到 / 工具后 done ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40)
  textNode('跑命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'long cmd', state: 'running', parent: t1 })
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  assert(flow.querySelectorAll('.dshcf-processed').length === 0, '工具 running 时边界挂起（pending）')
  // 工具完成
  t1.querySelector('[data-tool]').setAttribute('data-state', 'ok')
  await env.tick()
  await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, 'done 后恰生成一行已处理')
  // 再次 tick 不应重复
  await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '后续 pass 不重复插行')
  cleanup()
}

// ---------------------------------------------------------------------------
// 场景 5：宿主被替换（极端重渲染）→ 自愈、无残留
// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 5: 宿主替换后自愈无残留 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40)
  textNode('跑命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd', parent: t1 })
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '完成态一行已处理')
  assert(flow.querySelectorAll('.dshcf-chip').length === 0, '完成态 chip 未创建')

  // 模拟 React 极端重建：移除 t1 宿主，插入同结构新元素
  t1.remove()
  const t1b = seat(flow, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd', parent: t1b })
  t1b.remove()
  flow.appendChild(t1b)
  register()
  await env.tick()
  await env.tick()

  assert(flow.querySelectorAll('.dshcf-chip').length === 1, 'chip 无残留无重复')
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '已处理行不重复')
  assert(!flow.querySelectorAll('.dshcf-chip').some(c => c.isConnected === false), 'chip 均挂载')
  cleanup()
}

// ---------------------------------------------------------------------------
// 场景 6：切会话（flow 整体替换）→ 无串味
// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 6: 切会话 flow 替换无串味 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40)
  textNode('回合A', user)
  const t1 = seat(flow, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmdA', parent: t1 })
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 1, '会话A完成态')

  // 切到会话 B：移除旧 flow，插入新 flow（独立元素）
  flow.remove()
  const flowB = el('div', { 'data-chat-flow': '' })
  flowB.offsetParent = {}
  flowB.setRect({ width: 800, height: 600 })
  const userB = seat(flowB, 'user', 'u1', 40)
  textNode('回合B', userB)
  const tB = seat(flowB, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'read', summary: 'cmdB', parent: tB })
  const tailB = seat(flowB, 'turn-tail', 'tt1', 24)
  textNode('用时 3秒', tailB)
  document.body.appendChild(flowB)
  register()
  await env.tick()
  await env.tick()

  assert(flowB.querySelectorAll('.dshcf-processed').length === 1, '会话B自己收尾一行')
  assert(flowB.querySelectorAll('.dshcf-chip').length === 0, '会话B完成态 chip 未创建（不串味）')
  assert(flowB.querySelectorAll('.dshcf-processed').length === 1, '旧会话的行没有被搬到新 flow')
  // 一级展开后新会话 chip 唯一正常
  flowB.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  assert(flowB.querySelectorAll('.dshcf-chip').length === 1, '新会话 chip 正常')
  cleanup()
}

// ---------------------------------------------------------------------------
// 场景 7：stop() 完整性
// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 7: stop() 完整还原 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40)
  textNode('跑命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd', parent: t1 })
  const final = seat(flow, 'assistant', 'a1', 80)
  addThink(final, { summary: '想' })
  addBodyText(final, '正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  textNode('用时 5秒', tail)
  const status = el('div', { role: 'status' }, flow)
  textNode('Deep diving...', status)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  // 制造一些展开态
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  flow.querySelector('.dshcf-chip').dispatchEvent('click')
  await env.tick()

  const { cleanup: stop } = { cleanup: () => cleanup?.() }
  stop()

  const row = t1.querySelector('[data-chat-call-id]')
  assert(row.style.display === '', '工具行还原')
  assert(t1.style.display === '', '工具 seat 还原')
  assert(final.style.display === '', '最终宿主还原')
  assert(flow.querySelectorAll('.dshcf-chip').length === 0, 'chip 全部移除')
  assert(flow.querySelectorAll('.dshcf-processed').length === 0, '已处理行移除')
  assert(document.getElementById('dshcf-style') === null, 'style 移除')
  assert(status.textContent.includes('Deep diving'), 'Deep sleeping 还原为 Deep diving')
  env.clearTimers()
}

// ---------------------------------------------------------------------------
// 场景 8.5：整分/整小时时长格式（15分00秒 → 15分）
// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 8.5: 整分时长省略秒位 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40)
  textNode('跑命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30)
  makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd', parent: t1 })
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  textNode('用时 15分00秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '整分回合生成已处理行')
  assert(row.textContent.includes('已处理 15分'), '整分省略秒位（15分00秒 → 15分）', row.textContent)
  assert(!row.textContent.includes('00秒'), '不残留 00秒', row.textContent)
  cleanup()
}

// ---------------------------------------------------------------------------
// 场景 9：纯文本回合不生成一级行（产品语义）
// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 8: 纯文本回合无一级行 ===')
  const { env, document, flow, register, cleanup } = boot()
  const user = seat(flow, 'user', 'u1', 40)
  textNode('嗨', user)
  const final = seat(flow, 'assistant', 'a1', 60)
  addBodyText(final, '你好')
  const tail = seat(flow, 'turn-tail', 'tt1', 24)
  textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(flow.querySelectorAll('.dshcf-processed').length === 0, '无 think/tool 回合不生成已处理行')
  assert(final.style.display === '', '纯文本最终输出可见')
  cleanup()
}

console.log(`\n${failures === 0 ? '[ALL PASS]' : `[${failures} FAILURE(S)]`}`)
process.exitCode = failures === 0 ? 0 : 1
