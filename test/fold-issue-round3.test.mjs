/**
 * fold-issue-round3.test.mjs — 第三轮问题修复回归测试。
 * 覆盖：
 *   1) 标准模式 bash keyed toolview（bash-sample，无 data-tool）的工具名/状态解析；
 *   2) 工具行上方已完成块 + 下方进行中 Think 不再被误合并成「正在思考」；
 *   3) 完成态二级折叠「最后一次 Code 工具 description」的 always/hover/never 显示模式。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeToolRow, makeThinkRow, makeBashSampleRow, makeBashSampleSubcall, makeSubcall } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')
let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}
function boot(codeDescription = 'always') {
  const env = installDomGlobals()
  const { document } = env
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = { load(spec) { moduleExports = spec.factory(() => { throw new Error('require unsupported in stub') }) } }
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  let cleanup = null
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration', statusText: 'Deep sleeping...', codeDescription, keepLastRows: 1 }, base: {}, user: {}, writable: true }),
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
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 1) { if (!seen.has(c)) { seen.add(c); document._all.push(c) } walk(c) } } }
    walk(document.body)
  }
  return { env, document, flow, register, cleanup: () => { cleanup?.(); env.clearTimers() } }
}
function seat(flow, kind, key, h) { const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow); s.setRect({ height: h }); return s }
function addThink(s, summary, state = 'ok') { const md = el('div', { class: 'assistant-markdown-root' }, s); const b = el('div', { class: 'assistant-markdown-body' }, md); makeThinkRow({ state, summary, parent: b }) }
function addBody(s, text) { const md = el('div', { class: 'assistant-markdown-root' }, s); const b = el('div', { class: 'assistant-markdown-body' }, md); textNode(text, el('div', { class: 'markdown' }, b)) }

{
  console.log('\n=== 场景 A: 标准模式 bash-sample（无 data-tool）完成态工具名解析 ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('跑命令', b.flow.lastChild)
  const t1 = seat(b.flow, 'tool-call', 't1', 30); makeBashSampleRow({ callId: 'call:1', summary: 'Get-Content a.txt', parent: t1 })
  const t2 = seat(b.flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'b.txt', parent: t2 })
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await b.env.tick()
  const chip = b.flow.querySelector('.dshcf-chip')
  assert(chip !== null, '一级展开后生成二级 chip')
  const summary = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(summary.includes('Bash ×1') && summary.includes('Read ×1'), 'bash-sample 工具名解析为 Bash（非 Tool）', 'summary=' + summary)
  assert(!summary.includes('Tool ×'), '不再出现 Tool ×N 兜底', 'summary=' + summary)
  b.cleanup()
}

{
  console.log('\n=== 场景 B: 标准模式 bash-sample 运行态状态解析（不误折叠 running 行） ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('跑命令', b.flow.lastChild)
  const s1 = seat(b.flow, 'assistant-step', 's1', 26); addThink(s1, '先思考', 'ok')
  const t1 = seat(b.flow, 'tool-call', 't1', 30); makeBashSampleRow({ callId: 'call:1', state: 'running', summary: 'Get-Content a.txt', parent: t1 })
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  const chip = b.flow.querySelector('.dshcf-chip')
  assert(chip !== null, '运行中生成二级 chip')
  assert(chip !== null && chip.textContent.includes('正在运行'), 'bash-sample running 行识别为正在运行（非已运行）', 'text=' + (chip?.textContent ?? ''))
  const chipSummary = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(chipSummary.includes('Get-Content a.txt'), 'bash-sample running 摘要为命令（非 title「Bash」，有 visuallyHidden 状态 span 也不偏）', 'summary=' + chipSummary)
  const row = t1.querySelector('[data-chat-call-id]')
  assert(row.style.display === '', 'bash-sample running 行在 chip 外可见（不误折叠）', 'row=' + row.style.display)
  b.cleanup()
}

{
  console.log('\n=== 场景 C: PTC(run_code) 子调用 bash-sample 工具名解析 ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('编排工具', b.flow.lastChild)
  const t1 = seat(b.flow, 'tool-call', 't1', 30); const trow = makeToolRow({ callId: 'call:1', tool: 'run_code', summary: 'List project directory structure', parent: t1 })
  const subs = el('div', { 'data-subcalls': '' }, trow)
  makeBashSampleSubcall({ callId: 's1', parent: subs })
  makeBashSampleSubcall({ callId: 's2', parent: subs })
  makeSubcall({ callId: 's3', tool: 'read', parent: subs })
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await b.env.tick()
  const chip = b.flow.querySelector('.dshcf-chip')
  const summary = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(summary.includes('Bash ×2') && summary.includes('Read ×1'), '子调用 bash-sample 解析为 Bash ×2（非 Tool）', 'summary=' + summary)
  assert(!summary.includes('Tool ×'), '子调用不再出现 Tool ×N 兜底', 'summary=' + summary)
  b.cleanup()
}

{
  console.log('\n=== 场景 D: 工具行上方已完成块 + 下方进行中 Think 切分（issue 1） ===')
  const b = boot()
  seat(b.flow, 'user', 'u1', 40); textNode('改文件', b.flow.lastChild)
  const t1 = seat(b.flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', summary: 'cmd1', parent: t1 })
  const t2 = seat(b.flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'read', summary: 'a.txt', parent: t2 })
  const s1 = seat(b.flow, 'assistant-step', 's1', 26); addThink(s1, '新一轮思考内容', 'running')
  const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
  b.document.body.appendChild(b.flow)
  b.register()
  await b.env.tick(); await b.env.tick()
  const chips = b.flow.querySelectorAll('.dshcf-chip')
  assert(chips.length === 1, '上方已完成工具块 + 下方 running Think 只生成一个工具 chip', 'chips=' + chips.length)
  const chip = chips[0]
  assert(chip.textContent.includes('运行了命令') && !chip.textContent.includes('正在思考'), '工具 chip 标题为运行了命令（不误报正在思考）', 'text=' + chip.textContent)
  assert(!chip.textContent.includes('新一轮思考内容'), '工具 chip 摘要不含下方 running Think 内容', 'text=' + chip.textContent)
  const thinkRow = s1.querySelector('[data-variant="think"]')
  assert(thinkRow.style.display === '', 'running Think 行原生可见（进行中不折叠）', 'think=' + thinkRow.style.display)
  b.cleanup()
}

{
  console.log('\n=== 场景 E: Code description 显示模式 always/hover/never（issue 2） ===')
  const makePtc = () => {
    const b = boot('always')
    seat(b.flow, 'user', 'u1', 40); textNode('编排工具', b.flow.lastChild)
    const t1 = seat(b.flow, 'tool-call', 't1', 30); const trow = makeToolRow({ callId: 'call:1', tool: 'run_code', summary: 'List project directory structure', parent: t1 })
    const subs = el('div', { 'data-subcalls': '' }, trow)
    makeSubcall({ callId: 's1', tool: 'bash', parent: subs })
    const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
    const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
    b.document.body.appendChild(b.flow)
    b.register()
    return b
  }
  // always（默认）
  {
    const b = makePtc()
    await b.env.tick(); await b.env.tick()
    b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
    await b.env.tick()
    const chip = b.flow.querySelector('.dshcf-chip')
    const codeEl = chip?.querySelector('.dshcf-chip-code')
    assert(codeEl !== null && codeEl !== undefined, 'chip 含 .dshcf-chip-code span')
    assert((codeEl?.textContent ?? '').includes('List project directory structure'), 'always 模式 code 文案存在', 'code=' + (codeEl?.textContent ?? ''))
    assert(codeEl?.style.display === '' && !codeEl?.classList.contains('dshcf-hover-only'), 'always 模式常显（无 hover-only）', 'display=' + (codeEl?.style.display ?? '') + ' cls=' + (codeEl?.className ?? ''))
    b.cleanup()
  }
  // hover
  {
    const b = boot('hover')
    seat(b.flow, 'user', 'u1', 40); textNode('编排工具', b.flow.lastChild)
    const t1 = seat(b.flow, 'tool-call', 't1', 30); const trow = makeToolRow({ callId: 'call:1', tool: 'run_code', summary: 'List project directory structure', parent: t1 })
    const subs = el('div', { 'data-subcalls': '' }, trow)
    makeSubcall({ callId: 's1', tool: 'bash', parent: subs })
    const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
    const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
    b.document.body.appendChild(b.flow)
    b.register()
    await b.env.tick(); await b.env.tick()
    b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
    await b.env.tick()
    const chip = b.flow.querySelector('.dshcf-chip')
    const codeEl = chip?.querySelector('.dshcf-chip-code')
    assert((codeEl?.textContent ?? '').includes('List project directory structure'), 'hover 模式 code 文案存在', 'code=' + (codeEl?.textContent ?? ''))
    assert(codeEl?.classList.contains('dshcf-hover-only') === true, 'hover 模式带 dshcf-hover-only class', 'cls=' + (codeEl?.className ?? ''))
    b.cleanup()
  }
  // never
  {
    const b = boot('never')
    seat(b.flow, 'user', 'u1', 40); textNode('编排工具', b.flow.lastChild)
    const t1 = seat(b.flow, 'tool-call', 't1', 30); const trow = makeToolRow({ callId: 'call:1', tool: 'run_code', summary: 'List project directory structure', parent: t1 })
    const subs = el('div', { 'data-subcalls': '' }, trow)
    makeSubcall({ callId: 's1', tool: 'bash', parent: subs })
    const fin = seat(b.flow, 'assistant-step', 'a1', 100); addBody(fin, '最终正文')
    const tail = seat(b.flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
    b.document.body.appendChild(b.flow)
    b.register()
    await b.env.tick(); await b.env.tick()
    b.flow.querySelector('.dshcf-processed').dispatchEvent('click')
    await b.env.tick()
    const chip = b.flow.querySelector('.dshcf-chip')
    const codeEl = chip?.querySelector('.dshcf-chip-code')
    assert(codeEl?.style.display === 'none', 'never 模式 code 隐藏', 'display=' + (codeEl?.style.display ?? ''))
    b.cleanup()
  }
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
