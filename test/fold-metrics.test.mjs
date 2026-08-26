/**
 * fold-metrics.test.mjs — 需求 1/2/3/4 回归测试。
 * 覆盖：异常终止（已停止）无 turn-tail 也折叠；工具名 ×次数 统计；
 * PTC(run_code) 末尾 description；摘要栏字段自定义展示名。
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

/** fields 为摘要栏字段串（含自定义名）；不传时用默认配置。 */
function boot(fields) {
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
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: fields, statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }),
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
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, body))
}

const DEFAULT_FIELDS = 'duration,toolCalls,inputTokens,outputTokens,cacheReadTokens,cacheHitRate'

{
  console.log('\n=== 需求1: 已停止（stopped 行、无 turn-tail）也折叠，摘要显示已停止 ===')
  const { env, document, flow, register, cleanup } = boot(DEFAULT_FIELDS)
  const user = seat(flow, 'user', 'u1', 40); textNode('写一半停掉', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'pwsh', state: 'stopped', summary: 'cmd', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最后输出')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '已停止无 tail 也生成一级行')
  assert(row !== null && row.textContent.includes('已停止'), '摘要显示已停止标签', 'text=' + (row?.textContent ?? ''))
  assert(t1.style.display === 'none', '停止的工作行折叠隐藏', 't1=' + t1.style.display)
  assert(fin.style.display === '', '最终正文保留显示', 'fin=' + fin.style.display)
  cleanup()
}

{
  console.log('\n=== 需求2: 工具调用按「名称 ×次数」统计 ===')
  const { env, document, flow, register, cleanup } = boot(DEFAULT_FIELDS)
  const user = seat(flow, 'user', 'u1', 40); textNode('跑命令', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'bash', summary: 'a.sh', parent: t1 })
  const t2 = seat(flow, 'tool-call', 't2', 30); makeToolRow({ callId: 'call:2', tool: 'bash', summary: 'b.sh', parent: t2 })
  const t3 = seat(flow, 'tool-call', 't3', 30); makeToolRow({ callId: 'call:3', tool: 'read', summary: 'c.txt', parent: t3 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '一级展开后生成二级 chip')
  const summary = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(summary.includes('Bash ×2') && summary.includes('Read ×1'), '工具名×次数展示（Bash ×2 · Read ×1）', 'summary=' + summary)
  assert(!summary.includes('次工具调用'), '不再使用旧「N 次工具调用」文案', 'summary=' + summary)
  cleanup()
}

{
  console.log('\n=== 需求3: PTC(run_code) 折叠末尾显示最后一次 description ===')
  const { env, document, flow, register, cleanup } = boot(DEFAULT_FIELDS)
  const user = seat(flow, 'user', 'u1', 40); textNode('编排工具', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'run_code', summary: 'List project directory structure', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  flow.querySelector('.dshcf-processed').dispatchEvent('click')
  await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '一级展开后生成二级 chip')
  const summary = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(summary.includes('Code ×1'), 'PTC 工具统计为 Code ×1', 'summary=' + summary)
  assert(summary.includes('List project directory structure'), '末尾显示 description 参数', 'summary=' + summary)
  // 展开二级后摘要（含 description）应清空
  chip.dispatchEvent('click')
  await env.tick()
  const summaryAfter = chip?.querySelector('.dshcf-chip-summary')?.textContent ?? ''
  assert(summaryAfter === '', '二级展开后摘要清空（不残留 description）', 'summary=' + summaryAfter)
  cleanup()
}

{
  console.log('\n=== 需求4: 字段自定义展示名（inputTokens(输入上下文)） ===')
  const { env, document, flow, register, cleanup } = boot('duration,inputTokens(输入上下文)')
  const user = seat(flow, 'user', 'u1', 40); textNode('读文件', user)
  const t1 = seat(flow, 'tool-call', 't1', 30); makeToolRow({ callId: 'call:1', tool: 'read', summary: 'a.txt', parent: t1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  const tail = seat(flow, 'turn-tail', 'tt1', 24); textNode('用时 5秒', tail)
  el('div', { 'data-usage': JSON.stringify({ inputTokens: 1500, outputTokens: 400 }) }, tail)
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const row = flow.querySelector('.dshcf-processed')
  assert(row !== null, '闭合后生成一级行')
  const label = row?.firstElementChild?.textContent ?? ''
  assert(label.includes('输入上下文'), '自定义展示名生效', 'label=' + label)
  assert(label.includes('1.5K'), '输入 token 值正确渲染', 'label=' + label)
  assert(label.includes('5秒'), '耗时字段正常', 'label=' + label)
  assert(!label.includes('1.5K输入'), '默认「输入」后缀被自定义名替换', 'label=' + label)
  cleanup()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
