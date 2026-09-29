/**
 * fold-keep-last-rows.test.mjs —— 【已软降级】「进行中尾行保留」（R9 / keepLastRows）移除后的降级语义锁定。
 *
 * ⚠️ 降级声明（ADAPTATION_PLAN_0.1.7.md §5.8【决策 B-移除】）
 * ---------------------------------------------------------------------------
 * 本文件原名「R9 进行中尾行保留回归测试」，锁定的是「进行中回合最后 N 个系统提示行
 * 保留原生可见、更早的行才折进 chip」。该能力已按 §5.8 **在用户可见层面彻底移除**：
 *   - src/settings.ts：设置卡片的「进行中保留行数」UI 入口已删除；
 *   - src/fold.ts：keepTrailing 恒空、keepRows = KEEP_NONE、keepRow = () => false
 *     （reconcileBlock 签名不变；DEFAULT_KEEP_LAST_ROWS 常量与 roster 字段保留读兼容）。
 * 因此本文件改为锁定**降级后的行为**与**降级声明**本身：
 *   S0 单条非模型输出内容不折叠（需求4，与 keepLastRows 无关，继续成立）；
 *   S1 进行中段：**全部**系统提示行（含 running 行）都折进 chip，无尾行保留；
 *   S2 keepLastRows 取 0 / 3 / 999 时同一 fixture 的 DOM 指纹**逐字相同**（「不再生效」的直接证明）；
 *   S3 状态装饰行（model-retry）同样全部折进 chip 并计入「N 次重试」；
 *   S4 running 思考不再镜像「正在思考」+ 实时内容到 chip；
 *   S5 [data-follow-end] 兜底行同样折进 chip，且仍从计数中排除；
 *   S6 设置卡片里不再有 dshcf-keep-last-rows（UI 入口已移除）。
 *
 * ❗ 被移除的能力**没有**原生等价物：原生组滚动窗口
 * （\`.O_Ebla_body{max-height:min(400px,50vh);overflow-y:auto}\`）**只能**替代
 * 「展开后防 70+ 行淹没」，**不能**替代「最新 N 行不被折叠」。六处差异见规格书 §5.2：
 *   ① 组收起时根本没有滚动窗口；② 保留对象不同（行 vs 滚动位置）；
 *   ③ 量纲不可互译（行数 vs 400px/50vh）；④ 保留行在 chip 外 vs 在被折叠组内；
 *   ⑤ 跨组尾 N vs 每组独立 scrollport（CHAT:2073）；⑥ 折叠模式下 follow.reset()（CHAT:2082/:2099）。
 *
 * 用法：node test/fold-keep-last-rows.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode, makeThinkRow, makeRetryRow } from './fake-dom.mjs'

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
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration', statusText: 'Deep sleeping...', keepLastRows }, base: {}, user: {}, writable: true }),
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

function seat(flow, kind, key, h = 26) {
  const s = el('div', { 'data-chat-anchor-key': key, 'data-chat-flow-kind': kind, class: 'flowItem' }, flow)
  s.setRect({ height: h })
  return s
}
// 在同一个 assistant-step 里放一个 think 行（供同一块内多思考行测试）
function addThinkRow(seatEl, summary, state = 'ok', followEnd = false) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const b = el('div', { class: 'assistant-markdown-body' }, md)
  return makeThinkRow({ state, summary, followEnd: followEnd || state === 'running', parent: b })
}
function addBodyText(seatEl, text) {
  const md = el('div', { class: 'assistant-markdown-root' }, seatEl)
  const body = el('div', { class: 'assistant-markdown-body' }, md)
  textNode(text, el('div', { class: 'markdown' }, body))
}
const disp = (node) => (node === null || node === undefined ? 'null' : (node.style.display === '' ? "''" : node.style.display))
const chipText = (flow) => flow.querySelector('.dshcf-chip')?.textContent ?? 'null'

/**
 * flow 子树的「DOM 指纹」：深度 + 标签 + class + 关键属性 + 内联 display + 文本。
 *
 * 用于 S2 的「同一 fixture、不同 keepLastRows 取值 ⇒ 结果逐字相同」比较。
 * 只用公开 DOM 面（childNodes / getAttribute / textContent / style.display）。
 * ⚠️ 唯一的时间依赖文本是实时摘要行的「已工作 N秒」（时钟读数），比较前归一化，
 * 否则两次 boot 之间秒数进位会造成与 keepLastRows 无关的假失败。
 */
function fingerprint(flow) {
  const ATTRS = ['data-chat-anchor-key', 'data-chat-flow-kind', 'data-chat-call-id', 'data-state',
    'data-variant', 'aria-expanded', 'data-dshcf-block-key', 'data-follow-end']
  const out = []
  const walk = (node, depth) => {
    if (node.nodeType === 3) {
      out.push(depth + ':text:' + String(node.textContent).replace(/已工作 \d+秒/, '已工作 N秒'))
      return
    }
    const attrs = ATTRS.map(a => a + '=' + (node.getAttribute(a) ?? '')).join(',')
    out.push(depth + ':' + node.tagName + ':' + (node.getAttribute('class') ?? '') + ':' + attrs
      + ':display=' + node.style.display + ':text=' + node.textContent.replace(/已工作 \d+秒/, '已工作 N秒'))
    for (const child of node.childNodes) walk(child, depth + 1)
  }
  walk(flow, 0)
  return out.join('\n')
}

{
  console.log('\n=== S0: 单条不折叠语义保留——进行中单条 think 不出 chip、行原生可见 ===')
  // 改自原「场景 5/6」的 P3 口径中的一个仍然成立的子集：blockFoldableCount < 2
  // （单条非模型输出内容，无相邻同类）仍然不折叠。这与 keepLastRows 无关，
  // 是「需求4：单条不折叠」的独立语义，能力移除后继续成立。
  const { env, document, flow, register, cleanup } = boot(3)
  seat(flow, 'user', 'u1', 40); textNode('想问题', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  const only = addThinkRow(s1, '只思考一次', 'ok')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-chip') === null, '单条 think 不折叠（不出 chip）', 'chip=' + chipText(flow))
  assert(only.style.display === '', '单条 think 行原生可见', 'row=' + disp(only))
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-chip') === null, '多次 tick 后仍不折叠', 'chip=' + chipText(flow))
  cleanup()
}

{
  console.log('\n=== S1: 进行中段——全部系统提示行（含 running）都折进 chip，无尾行保留 ===')
  // §5.8 降级后的核心行为：keepRow 恒 false ⇒ 段内块的所有 rows 一律折进 chip。
  // 原「最后 3 行保留可见」的期望（think2/think3/think4 可见）在降级后**不再成立**。
  const { env, document, flow, register, cleanup } = boot(3)
  seat(flow, 'user', 'u1', 40); textNode('多步推理', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  const think1 = addThinkRow(s1, '第一步', 'ok')
  const think2 = addThinkRow(s1, '第二步', 'ok')
  const think3 = addThinkRow(s1, '第三步', 'ok')
  const think4 = addThinkRow(s1, '第四步', 'running')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '进行中生成二级 chip')
  assert(chip !== null && chip.getAttribute('aria-expanded') === 'false', 'chip 保持收起（进行中不强制展开）', 'aria=' + chip?.getAttribute('aria-expanded'))
  assert(think1.style.display === 'none', 'think1 折进 chip', 'think1=' + disp(think1))
  assert(think2.style.display === 'none', 'think2 也折进 chip（旧语义下它在尾行窗口内）', 'think2=' + disp(think2))
  assert(think3.style.display === 'none', 'think3 也折进 chip（旧语义下它在尾行窗口内）', 'think3=' + disp(think3))
  assert(think4.style.display === 'none', 'running think4 也折进 chip（旧语义下 running 行不保留）', 'think4=' + disp(think4))
  const text = chipText(flow)
  assert(text.includes('已思考') && text.includes('3 段思考'), 'chip 计数含全部已完成思考（3 段思考）', 'text=' + text)
  cleanup()
}

{
  console.log('\n=== S1b: 2 行块（原「尾行全保留⇒不出空 chip」场景）——现恒出 chip 且两行都折进 ===')
  // 原场景 5/6 断言「keepLastRows=3 覆盖全部行 ⇒ 不出 chip」。降级后不再有窗口，
  // 该断言已不适用；改为锁定新行为：只要块内 ≥2 行就出 chip，且无行被保留。
  const { env, document, flow, register, cleanup } = boot(3)
  seat(flow, 'user', 'u1', 40); textNode('想问题', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  const first = addThinkRow(s1, '先想一点', 'ok')
  const running = addThinkRow(s1, '正在想', 'running')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  const chip = flow.querySelector('.dshcf-chip')
  assert(chip !== null, '2 行块出 chip（原「不出空 chip」口径随能力移除而消失）', 'chip=' + chipText(flow))
  assert(first.style.display === 'none' && running.style.display === 'none', '两行都折进 chip（无尾行保留）', 'first=' + disp(first) + ' running=' + disp(running))
  assert(chipText(flow).includes('1 段思考'), 'running 行不计入计数（1 段思考）', 'text=' + chipText(flow))
  cleanup()
}

{
  console.log('\n=== S2: keepLastRows 取 0 / 3 / 999 结果逐字相同（「不再生效」的直接证明） ===')
  const build = async (keepLastRows) => {
    const { env, document, flow, register, cleanup } = boot(keepLastRows)
    seat(flow, 'user', 'u1', 40); textNode('多步推理', flow.lastChild)
    const s1 = seat(flow, 'assistant-step', 's1', 26)
    addThinkRow(s1, '第一步', 'ok')
    addThinkRow(s1, '第二步', 'ok')
    addThinkRow(s1, '第三步', 'ok')
    addThinkRow(s1, '第四步', 'running')
    const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/3）', parent: r1 })
    const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
    document.body.appendChild(flow)
    register()
    await env.tick(); await env.tick()
    const fp = fingerprint(flow)
    cleanup()
    return fp
  }
  const fp0 = await build(0)
  const fp3 = await build(3)
  const fp999 = await build(999)
  assert(fp0 === fp3, 'keepLastRows=0 与 3 的 DOM 指纹逐字相同', 'diff=' + (fp0 === fp3 ? '' : 'yes'))
  assert(fp3 === fp999, 'keepLastRows=3 与 999 的 DOM 指纹逐字相同', 'diff=' + (fp3 === fp999 ? '' : 'yes'))
  if (fp0 !== fp3) {
    const a = fp0.split('\n'); const b = fp3.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { console.log('    首个差异 @' + i + '\n      0: ' + a[i] + '\n      3: ' + b[i]); break }
  }
  // 反向防假绿：指纹必须真的反映了折叠（4 条 think 行都 display=none、chip 计数为 3 段思考）。
  assert(fp3.includes('3 段思考') && fp3.includes('1 次重试'), '指纹确实包含折叠产物（非空树假绿）', 'fp=' + fp3.length + '字符')
  assert((fp3.match(/display=none/g) ?? []).length >= 5, '指纹里确有被折叠的行（≥5 处 display=none）', 'none=' + (fp3.match(/display=none/g) ?? []).length)
}

{
  console.log('\n=== S3: 状态装饰行（model-retry）同样全部折进 chip 并计入「N 次重试」 ===')
  // 原场景 7/8：keepLastRows=2/3 时最新一次重试保留可见、不计入计数。
  // 降级后窗口消失 ⇒ 重试行与思考行同一规则，一律折进 chip 并计数。
  const { env, document, flow, register, cleanup } = boot(2)
  seat(flow, 'user', 'u1', 40); textNode('多步推理', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  const think1 = addThinkRow(s1, '第一步', 'ok')
  const think2 = addThinkRow(s1, '第二步', 'ok')
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（1/3）', parent: r1 })
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(think1.style.display === 'none', 'think1 折进 chip', 'think1=' + disp(think1))
  assert(think2.style.display === 'none', 'think2 折进 chip（不再因尾行窗口保留）', 'think2=' + disp(think2))
  assert(r1.style.display === 'none', '重试行折进 chip（不再保留在尾行窗口内）', 'r1=' + disp(r1))
  const text = chipText(flow)
  assert(text.includes('2 段思考'), 'chip 统计全部折叠的思考（2 段思考）', 'text=' + text)
  assert(text.includes('1 次重试'), '重试行折进后计入 chip「1 次重试」', 'text=' + text)
  cleanup()
}

{
  console.log('\n=== S3b: 块外状态行（被正文隔开）——进行中仍可见，且不计入 chip 计数 ===')
  // 原场景 10 的口径仍然成立且与 keepLastRows 无关：块外状态行不参与二级 chip 折叠，
  // 进行中段无一级折叠（segment 未收起）⇒ 它保持原生可见，也不计入「N 次重试」。
  const { env, document, flow, register, cleanup } = boot(1)
  seat(flow, 'user', 'u1', 40); textNode('多步推理', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  const think1 = addThinkRow(s1, '第一步', 'ok')
  const think2 = addThinkRow(s1, '第二步', 'ok')
  const mid = seat(flow, 'assistant-step', 'm1', 60); addBodyText(mid, '过程正文')
  const r1 = seat(flow, 'model-retry', 'r1', 24); makeRetryRow({ label: '已重试模型请求（2/3）', parent: r1 })
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(think1.style.display === 'none' && think2.style.display === 'none', '块内两条思考都折进 chip', 't1=' + disp(think1) + ' t2=' + disp(think2))
  assert(r1.style.display === '', '块外重试行进行中保持可见（不属二级 chip 折叠范围）', 'r1=' + disp(r1))
  const text = chipText(flow)
  assert(text.includes('2 段思考'), 'chip 统计两条折叠的思考', 'text=' + text)
  assert(!text.includes('次重试'), '块外可见的重试不计入 chip 计数', 'text=' + text)
  cleanup()
}

{
  console.log('\n=== S4: 运行中思考不镜像「正在思考」+ 实时内容到 chip ===')
  // 与 keepLastRows 无关的既有语义（原场景 3 的 1/2/3 条断言）保留；第 4 条
  // 「running think 行原生可见」在降级后不成立 ⇒ 改为两个 think 行都折进 chip。
  const { env, document, flow, register, cleanup } = boot(1)
  seat(flow, 'user', 'u1', 40); textNode('想问题', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  const done = addThinkRow(s1, '先想一点', 'ok')
  const live = addThinkRow(s1, '正在想的实时内容', 'running')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(flow.querySelector('.dshcf-chip') !== null, '进行中生成二级 chip')
  const text = chipText(flow)
  assert(!text.includes('正在思考'), 'chip 不再镜像「正在思考」标题', 'text=' + text)
  assert(!text.includes('正在想的实时内容'), 'chip 不再镜像实时思考内容', 'text=' + text)
  assert(text.includes('已思考') && text.includes('1 段思考'), 'chip 显示已完成折叠计数（已思考 · 1 段思考）', 'text=' + text)
  assert(done.style.display === 'none' && live.style.display === 'none', '两个 think 行都折进 chip（running 行不再保留在 chip 外）', 'done=' + disp(done) + ' live=' + disp(live))
  cleanup()
}

{
  console.log('\n=== S5: [data-follow-end] 兜底行同样折进 chip，且仍从计数中排除 ===')
  // 原场景 4 的两条语义分开锁定：① data-state 缺失 + [data-follow-end] 仍被识别为
  // running ⇒ 从 thinkCount 中排除（这与 keepLastRows 无关，必须保留）；
  // ② 「该行原生可见」的期望随能力移除而失效 ⇒ 改为折进 chip。
  const { env, document, flow, register, cleanup } = boot(1)
  seat(flow, 'user', 'u1', 40); textNode('想问题', flow.lastChild)
  const s1 = seat(flow, 'assistant-step', 's1', 26)
  const first = addThinkRow(s1, '第一步', 'ok')
  const live = addThinkRow(s1, '还在想', 'ok', true)
  live.removeAttribute('data-state')
  const third = addThinkRow(s1, '第三步', 'ok')
  const fin = seat(flow, 'assistant-step', 'a1', 100); addBodyText(fin, '最终正文')
  document.body.appendChild(flow)
  register()
  await env.tick(); await env.tick()
  assert(live.style.display === 'none', 'data-follow-end 行也折进 chip（降级后无尾行保留）', 'live=' + disp(live))
  assert(first.style.display === 'none' && third.style.display === 'none', '其余 think 行同样折进 chip', 'first=' + disp(first) + ' third=' + disp(third))
  const text = chipText(flow)
  assert(text.includes('2 段思考') && !text.includes('3 段思考'), 'chip 计数仍排除 data-follow-end 行（恰 2 段思考）', 'text=' + text)
  cleanup()
}

// ── S6：设置卡片 UI 入口已移除（§5.8 降风险第 3 步） ─────────────────────────
// 本文件其余场景不渲染 React；这一条单独搭最小 React 桩，直接调用卡片组件的
// view='page' 分支，断言「进行中保留行数」的字段 id 与文案都已从表单消失，
// 同时其余 4 项仍在（防止「卡片渲染成空树」造成假绿）。
function makeReactHarness() {
  const hooks = []
  let index = 0
  let mounted = null
  let tree = null
  const rerender = () => {
    if (mounted === null) return
    index = 0
    tree = mounted.component(mounted.props)
  }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) {
      const i = index++
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        const value = typeof next === 'function' ? next(hooks[i]) : next
        if (Object.is(value, hooks[i])) return
        hooks[i] = value
        rerender()
      }
      return [hooks[i], set]
    },
    useEffect(fn) { const i = index++; if (!(i in hooks)) hooks[i] = fn() },
    useMemo(fn) { const i = index++; if (!(i in hooks)) hooks[i] = fn(); return hooks[i] },
    useRef(initial) { const i = index++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i] },
  }
  return {
    react,
    mount(component, props) { hooks.length = 0; mounted = { component, props }; rerender(); return tree },
  }
}
function bootCard() {
  const harness = makeReactHarness()
  const env = installDomGlobals()
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) {
      moduleExports = spec.factory((id) => {
        if (id === 'react') return harness.react
        throw new Error('unexpected require: ' + id)
      })
    },
  }
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  return { env, harness, m: moduleExports }
}
function collect(node, pred, acc = []) {
  if (node === null || node === undefined || typeof node !== 'object') return acc
  if (Array.isArray(node)) { for (const child of node) collect(child, pred, acc); return acc }
  if (pred(node)) acc.push(node)
  for (const child of node.children ?? []) collect(child, pred, acc)
  return acc
}

{
  console.log('\n=== S6: 设置卡片不再有「进行中保留行数」（UI 入口已移除） ===')
  const { env, harness, m } = bootCard()
  const state = {
    status: 'ready',
    value: { statusText: 'Deep sleeping...', summaryFields: 'duration', codeDescription: 'always', keepLastRows: 3, keepLastBodySteps: 1 },
    base: {}, user: {}, writable: true, revision: 3,
  }
  const form = { state, mutate: async () => true }
  const slots = {
    entries: [],
    inject(slot, cb) { return cb() },
    register(options, component) { this.entries.push({ options, component }); return () => {} },
  }
  const dispose = m.setupSettingsCard({ slots }, { getSnapshot: () => state, subscribe: () => () => {}, set: async () => {}, unset: async () => {} })
  const entry = slots.entries.find(e => e.options.name === 'plugins.item')
  assert(entry !== undefined, 'plugins.item 卡片已注册')
  const tree = harness.mount(entry.component, { view: 'page', form })
  const ids = collect(tree, n => n.props !== undefined && typeof n.props.id === 'string').map(n => n.props.id)
  assert(!ids.includes('dshcf-keep-last-rows'), '不再渲染 dshcf-keep-last-rows 输入框', 'ids=' + ids.join(','))
  assert(!JSON.stringify(tree).includes('进行中保留行数'), '不再出现「进行中保留行数」文案')
  assert(ids.includes('dshcf-status-text') && ids.includes('dshcf-summary-fields')
    && ids.includes('dshcf-code-description') && ids.includes('dshcf-keep-last-body-steps'),
    '其余 4 项仍在（卡片确实渲染，非空树假绿）', 'ids=' + ids.join(','))
  assert(ids.length === 4, '表单恰有 4 个字段（keepLastRows 行已移除）', 'count=' + ids.length)
  dispose()
  env.clearTimers()
}

console.log('\n' + (failures === 0 ? '[ALL PASS]' : '[' + failures + ' FAILURE(S)]'))
process.exitCode = failures === 0 ? 0 : 1
