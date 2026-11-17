/**
 * fold-perf-pass.test.mjs —— 流式期「轻量摘要更新」与自写过滤的行为锁（0.3.10）。
 *
 * 背景（真机 390×844@DPR3 + CDP 4x 限速实测）：回合在跑时宿主每 ~60ms 写一次
 * characterData，旧实现每次都跑全量 pass；而全量 pass 里的 `document.activeElement`
 * / `getComputedStyle` 会强制**全文档**样式重算 → 单 pass 20~70ms，是主线程尖峰的
 * 主要来源。修法拆成两条：
 *   1. 纯 characterData 批次 → 只刷新文本派生摘要（不 findBlocks / 不判定显隐）；
 *   2. 插件自己的写入（chip/一级行/实时行/注入 span）不再触发重放。
 *
 * 本文件的鉴别力约定（改回旧实现 ⇒ FAIL）：
 *   - P1 若把 characterData 批次改回全量 pass → `getComputedStyle` 计数 > 0；
 *   - P1b 若轻量路径不刷新 chip 文本 → 摘要停在旧值；
 *   - P2 若不过滤自写 mutation → 模拟徽标插入后会出现第二轮全量 pass；
 *   - P3 若恢复「pass 里直接读 activeElement」→ 无交互时读取次数 > 0；
 *   - P4 若轻量路径不补 status 替换 → 公告文本停在宿主原文。
 *
 * 用法：node test/fold-perf-pass.test.mjs
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
  return textNode(value, md)
}

/** 统计 getComputedStyle 调用次数（全量 pass 的可见性判定会调用它；轻量更新不会）。 */
async function countComputedStyle(fn) {
  const original = globalThis.getComputedStyle
  let calls = 0
  globalThis.getComputedStyle = (...args) => { calls++; return original(...args) }
  try { await fn() } finally { globalThis.getComputedStyle = original }
  return calls
}

// ══ P1：纯 characterData 批次不跑全量 pass，但 chip 摘要仍逐字刷新 ══════════
{
  console.log('\n=== P1：characterData-only 批次走轻量摘要（不重建、不判定显隐） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const step = seat(flow, 'assistant-step', 'a1')
  addBodyText(step, 'working')
  // 两条相邻工具 seat 才成「块」（单条不折叠是产品语义），第二条处于 running。
  // 真实契约：flow 直接子级是 seat，工具视图（带 data-chat-call-id）在 seat 内。
  const s0 = seat(flow, 'tool-call', 't1')
  makeToolRow({ callId: 'c0', tool: 'bash', state: 'ok', summary: 'npm ci', parent: s0 })
  const s1 = seat(flow, 'tool-call', 't2')
  const row = makeToolRow({ callId: 'c1', tool: 'bash', state: 'running', summary: 'npm test', parent: s1 })
  const summaryEl = row.querySelector('.summary')
  const fin = seat(flow, 'assistant-step', 'a2')
  addBodyText(fin, 'streaming')
  // 不挂 turn-tail：段处于「进行中」⇒ 无一级折叠，二级 chip 必须建出来。
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, 'P1-0 运行中工具块建立了二级 chip')
  const before = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(before.includes('npm test'), 'P1-0b chip 摘要含当前命令', 'got=' + before)

  // 模拟流式命令参数（宿主改文本节点，只产生 characterData）
  summaryEl.textContent = 'npm test -- --watch'
  const calls = await countComputedStyle(() => {
    env.notifyMutations([{ type: 'characterData', target: summaryEl }])
    env.flushRaf()
  })
  assert(calls === 0, 'P1-1 characterData 批次不触发全量 pass（getComputedStyle 0 次）', 'calls=' + calls)
  const after = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(after.includes('--watch'), 'P1-2 轻量路径仍刷新 chip 摘要（逐字流式可见）', 'got=' + after)

  // 对照组：同一夹具下结构变化仍必须走全量 pass
  const calls2 = await countComputedStyle(() => {
    env.notifyMutations([{ type: 'childList', target: flow, addedNodes: [], removedNodes: [] }])
    env.flushRaf()
  })
  assert(calls2 > 0, 'P1-3 结构批次仍走全量 pass（可见性判定被调用）', 'calls=' + calls2)
  cleanup()
}

// ══ P2：插件自写 mutation 不再触发重放（否则每次写都自激一轮） ══════════════
{
  console.log('\n=== P2：自写 mutation 过滤（插件注入的徽标/行不算宿主结构变化） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  // 进行中段 + 官方组：全量 pass 一定走到「可见性判定」（isDisplayed）。
  const group = el('div', { 'data-step-process': 'true', 'data-chat-group-key': 'g1' }, flow)
  const header = el('div', {}, group)
  const btn = el('button', { 'data-process-activity': 'code', 'aria-expanded': 'true' }, header)
  const body = el('div', { 'data-step-process-body': 'true' }, group)
  const content = el('div', { 'data-step-process-content': 'true', 'data-chat-flow': '' }, body)
  makeToolRow({ callId: 'c1', tool: 'bash', state: 'running', summary: 'ls', parent: content })
  const s0 = seat(flow, 'tool-call', 't1')
  makeToolRow({ callId: 'c2', tool: 'bash', state: 'ok', summary: 'pwd', parent: s0 })
  const s1 = seat(flow, 'tool-call', 't2')
  makeToolRow({ callId: 'c3', tool: 'bash', state: 'running', summary: 'ls -la', parent: s1 })
  const fin = seat(flow, 'assistant-step', 'a1')
  addBodyText(fin, 'done')
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  const badge = el('span', { class: 'dshcf-group-count', text: '· 1 次工具' })
  btn.appendChild(badge)
  const calls = await countComputedStyle(() => {
    env.notifyMutations([{ type: 'childList', target: btn, addedNodes: [badge], removedNodes: [] }])
    env.flushRaf()
  })
  assert(calls === 0, 'P2-1 插件自建节点插入不触发全量 pass', 'calls=' + calls)

  // 宿主节点插入（非插件自建）仍必须触发
  const hostNode = el('div', { 'data-chat-turn': '1' }, group)
  const calls2 = await countComputedStyle(() => {
    env.notifyMutations([{ type: 'childList', target: group, addedNodes: [hostNode], removedNodes: [] }])
    env.flushRaf()
  })
  assert(calls2 > 0, 'P2-2 宿主节点插入仍触发全量 pass', 'calls=' + calls2)

  // ⚠️ 删除方向必须重放：React 重渲染会清掉插件徽标，下一轮 pass 必须把它补回。
  // 若把「增删全是插件节点」整体当自写（旧判据），这条会被过滤 → 徽标永久缺失。
  const badgeBefore = btn.querySelector('.dshcf-group-count')
  assert(badgeBefore !== null, 'P2-3a 首轮已注入工具计数徽标')
  badgeBefore?.remove()   // 真实移除（模拟 React 清空标题按钮的子节点）
  const calls3 = await countComputedStyle(() => {
    env.notifyMutations([{ type: 'childList', target: btn, addedNodes: [], removedNodes: [badgeBefore] }])
    env.flushRaf()
  })
  assert(calls3 > 0, 'P2-3b 宿主清除插件徽标仍触发全量 pass', 'calls=' + calls3)
  assert(btn.querySelector('.dshcf-group-count') !== null, 'P2-3c 徽标被下一轮 pass 自愈补回')
  cleanup()
}

// ══ P3：无交互时 pass 不读 document.activeElement（避免强制全文档样式重算）══
{
  console.log('\n=== P3：交互状态事件驱动维护（pass 内不再读 activeElement） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const toolSeat = seat(flow, 'tool-call', 't1')
  const row = makeToolRow({ callId: 'c1', tool: 'bash', state: 'ok', summary: 'ls', parent: toolSeat })
  const fin = seat(flow, 'assistant-step', 'a1')
  addBodyText(fin, 'done')
  // 闭合段才会走「交互感知」的完成态循环（hasInteraction 只在那里判定）。
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 4秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()

  let reads = 0
  const desc = Object.getOwnPropertyDescriptor(document, 'activeElement')
  Object.defineProperty(document, 'activeElement', {
    configurable: true,
    get() { reads++; return desc?.get ? desc.get.call(document) : (desc?.value ?? null) },
  })
  try {
    reads = 0
    await env.tick()
    assert(reads === 0, 'P3-1 无选区/焦点时全量 pass 不读 activeElement', 'reads=' + reads)

    // 焦点进入 flow：focusin 事件把状态置真，随后 pass 才做精确判定
    row.dispatchEvent('focusin', { target: row, relatedTarget: null })
    reads = 0
    await env.tick()
    assert(reads > 0, 'P3-2 焦点在 flow 内时才读 activeElement（精确判定保留）', 'reads=' + reads)
  } finally {
    if (desc === undefined) delete document.activeElement
    else Object.defineProperty(document, 'activeElement', desc)
  }
  cleanup()
}

// ══ P4：characterData 批次仍维持 turn-process 公告文本替换 ═════════════════
{
  console.log('\n=== P4：轻量路径补 status 文本替换（公告行不退回宿主原文） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const tpSeat = seat(flow, 'turn-process', 'tp1')
  const status = el('span', { role: 'status' }, tpSeat)
  const statusNode = textNode('Deep diving...', status)
  el('button', { 'data-turn-process': '1', 'aria-expanded': 'false' }, tpSeat)
  const fin = seat(flow, 'assistant-step', 'a1')
  addBodyText(fin, 'done')
  const tail = seat(flow, 'turn-tail', 'tt1')
  textNode('用时 4秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()
  assert(statusNode.data === 'Deep sleeping...', 'P4-0 首轮即替换为设置文案', 'got=' + statusNode.data)

  // 宿主每秒重写公告文本（characterData）→ 轻量批次里必须补一次替换
  statusNode.data = 'Deep diving...'
  env.notifyMutations([{ type: 'characterData', target: statusNode }])
  env.flushRaf()
  assert(statusNode.data === 'Deep sleeping...', 'P4-1 characterData 批次后公告仍被替换', 'got=' + statusNode.data)
  cleanup()
}

// ══ P5：实时行秒表由轻量 pass 续期（无 mutation 也每秒走表） ═══════════════
{
  console.log('\n=== P5：实时行秒表在零 mutation 下仍每秒走表（轻量续期） ===')
  const { env, document, flow, register, cleanup } = boot()
  seat(flow, 'user', 'u1')
  const step0 = seat(flow, 'assistant-step', 'a1')
  addBodyText(step0, 'working')
  const s0 = seat(flow, 'tool-call', 't1')
  makeToolRow({ callId: 'c0', tool: 'bash', state: 'ok', summary: 'npm ci', parent: s0 })
  const s1 = seat(flow, 'tool-call', 't2')
  makeToolRow({ callId: 'c1', tool: 'bash', state: 'running', summary: 'npm test', parent: s1 })
  const fin = seat(flow, 'assistant-step', 'a2')
  addBodyText(fin, 'streaming')
  document.body.appendChild(flow)
  register()
  await env.tick()
  await env.tick()

  const row = flow.querySelector('.dshcf-processing')
  assert(row !== null, 'P5-0 进行中段建立了实时行')
  const before = row?.textContent ?? ''
  // 无任何 mutation：只等秒表定时器 → 轻量 pass 刷新文本**并续期下一次**。
  // 必须比「第一轮」与「第二轮」的文本：第一轮 tick 由全量 pass 排的定时器
  // 触发，续期缺失时第二轮不会发生（只比 before/after 会被第一轮骗过）。
  const calls = await countComputedStyle(async () => {
    await new Promise(resolve => setTimeout(resolve, 1400))
    env.flushRaf()
  })
  const mid = row?.textContent ?? ''
  await countComputedStyle(async () => {
    await new Promise(resolve => setTimeout(resolve, 1400))
    env.flushRaf()
  })
  const after = row?.textContent ?? ''
  assert(mid !== before, 'P5-1 第一轮秒表走表', `before=${before} mid=${mid}`)
  assert(after !== mid, 'P5-2 第二轮秒表继续走表（续期生效）', `mid=${mid} after=${after}`)
  assert(calls === 0, 'P5-3 走表走轻量 pass（不触发全量 pass）', 'calls=' + calls)
  cleanup()
}

console.log(failures === 0 ? '\nfold-perf-pass: failures=0' : `\nfold-perf-pass: failures=${failures}`)
process.exit(failures === 0 ? 0 : 1)
