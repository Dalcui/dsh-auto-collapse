/**
 * turn-metrics-injector.test.mjs — T1 注入器集成层测试。
 *
 * 此前 20 个测试全部靠手工放置 data-dshcf-* 属性模拟注入器产物，注入器
 * 本身（TurnMetricsNodeView / registerShadow / resolveBuiltinAssistant /
 * locale 解析 / 卸载清理）零执行。本文件用最小 React 桩 + slots mock 直接
 * 驱动 shadow 渲染器：覆盖安装注册（key/priority/locale）、R1 卸载可逆、
 * HMR 循环无残留、渲染器 DOM 属性输出、无内置渲染器时 children 直出兜底、
 * 已有外部 shadow 时优先级降档。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

/** 最小 React 桩：hooks 同步求值；createElement 返回普通对象供断言。 */
const reactStub = {
  useMemo: (fn) => fn(),
  useEffect: (fn) => fn(),
  useRef: (initial) => ({ current: initial }),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
}

/** slots 服务 mock：entries 即注册表；register 返回「从表移除」的 disposer；
 * inject 同步执行回调并返回其返回值（与 cordis 即时注入语义一致）。 */
function makeSlots(builtinLocale = 'chat', builtinInject) {
  const slots = {
    _entries: [],
    entries() { return this._entries },
    inject(slot, cb) { return cb() },
    register(spec, component) {
      const entry = { options: { ...spec }, locale: spec.locale, component }
      this._entries.push(entry)
      return () => {
        const i = this._entries.indexOf(entry)
        if (i >= 0) this._entries.splice(i, 1)
      }
    },
  }
  // 内置 assistant-step entry（priority 0），渲染器为占位组件。
  // builtinInject：可选的内置 entry 级 inject 工厂——0.2.1 为
  // `() => ({ hooks: { presentation } })`，0.2.2 起为
  // `(sessionId) => ({ hooks, resolveFilePath, fileMentions })`（见 T1-I）。
  slots._entries.push({
    options: { key: 'assistant-step', priority: 0 },
    locale: builtinLocale,
    inject: builtinInject,
    component: function BuiltinStep(props) { return reactStub.createElement('span', null, 'builtin', props.children) },
  })
  return slots
}

function shadowEntry(slots) {
  return slots._entries.find(e => e.options && e.options.key === 'assistant-step' && (e.options.priority ?? 0) < 0)
}

function boot(slots) {
  const env = installDomGlobals()
  const { document } = env
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) {
      moduleExports = spec.factory((id) => {
        if (id === 'react') return reactStub
        throw new Error('unexpected require: ' + id)
      })
    },
  }
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  let cleanup = null
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration', statusText: 'Deep sleeping...', keepLastRows: 1 }, base: {}, user: {}, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
  moduleExports.apply({
    inject: (keys, cb) => cb({ slots }),
    effect: (fn) => { cleanup = fn() },
    slots,
    settingsScope: { bind: () => scopeMock },
  })
  return { env, slots, cleanup: () => { cleanup?.(); env.clearTimers() } }
}

{
  console.log('\n=== T1-A：安装注册 shadow（key/priority/locale 跟随内置） ===')
  const slots = makeSlots('chat')
  const t = boot(slots)
  const shadow = shadowEntry(slots)
  assert(shadow !== undefined, '安装后注册了 assistant-step shadow')
  assert(shadow.options.priority === -1, '默认优先级 -1', 'priority=' + shadow.options.priority)
  assert(shadow.locale === 'chat', 'locale 跟随内置 entry（rc.1 = chat）', 'locale=' + shadow.locale)
  assert(typeof shadow.component === 'function', 'shadow 渲染器是函数')
  t.cleanup()
}

{
  console.log('\n=== T1-B：卸载（R1）后宿主 slots 无残留 ===')
  const slots = makeSlots()
  const t = boot(slots)
  assert(shadowEntry(slots) !== undefined, '安装后有 shadow')
  t.cleanup()
  assert(shadowEntry(slots) === undefined, 'cleanup 后 shadow 被 dispose（无残留）')
  assert(slots._entries.length === 1, '注册表只剩内置 entry', 'len=' + slots._entries.length)
}

{
  console.log('\n=== T1-C：HMR 循环 3 次 priority 恒 -1、无累积 ===')
  const slots = makeSlots()
  for (let round = 1; round <= 3; round++) {
    const t = boot(slots)
    const shadow = shadowEntry(slots)
    assert(shadow !== undefined && shadow.options.priority === -1, '第 ' + round + ' 次安装 priority=-1（不降档）', 'priority=' + (shadow && shadow.options.priority))
    t.cleanup()
    assert(shadowEntry(slots) === undefined, '第 ' + round + ' 次 cleanup 后无残留')
  }
}

{
  console.log('\n=== T1-D：渲染器输出 data-dshcf-* 属性与委托渲染 ===')
  const slots = makeSlots('chat')
  const t = boot(slots)
  const shadow = shadowEntry(slots)
  const renderer = shadow.component
  const node = { key: 'n1', location: { kind: 'step', turn: { turn: 3 } } }
  const state = {
    chat: { order: ['n1'], nodes: { get: (k) => (k === 'n1' ? node : undefined) } },
    turnTimings: new Map([[3, { startTime: 1000, endTime: 4000 }]]),
    sessionId: 'sess-x',
  }
  const useSession = (sel) => sel(state)
  const out = renderer({ node, useSession, sessionId: 'sess-x' })
  assert(out !== null && out.type === 'div', '渲染输出为 div 包装')
  assert(out.props['data-dshcf-turn'] === '3', 'data-dshcf-turn = 3', String(out.props['data-dshcf-turn']))
  assert(out.props['data-dshcf-session'] === 'sess-x', 'data-dshcf-session = sess-x')
  assert(out.props['data-dshcf-seg'] === '0', '无插话段 seg=0', String(out.props['data-dshcf-seg']))
  assert(Array.isArray(out.children) && out.children.length === 1 && out.children[0].type !== null && out.children[0].props !== undefined, '委托渲染内置组件（children 原样传递）')
  t.cleanup()
}

{
  console.log('\n=== T1-E：无内置 renderer 时 children 直出兜底（正文不丢） ===')
  // 安装时内置 renderer 就不存在（激活顺序竞态/宿主结构变化）：
  // resolveBuiltinAssistant 落空 → 兜底路径。注意必须先清空再 boot——
  // 组件引用在安装期解析并缓存，安装后再移除走的是委托缓存路径。
  const slots = makeSlots('chat')
  slots._entries.splice(0, slots._entries.length)
  const t = boot(slots)
  const shadow = shadowEntry(slots)
  const renderer = shadow.component
  const node = { key: 'n9', location: { kind: 'step', turn: { turn: 9 } } }
  const useSession = () => undefined
  const out = renderer({ node, useSession, sessionId: 'sess-x', children: '原始正文' })
  assert(out !== null && out.type === 'div', '兜底仍输出 div 包装')
  assert(out.props.style.display === 'contents', '兜底 display:contents 不劫持布局', JSON.stringify(out.props.style))
  const fallbackDiv = Array.isArray(out.children) ? out.children[0] : null
  assert(fallbackDiv !== null && Array.isArray(fallbackDiv.children) && fallbackDiv.children[0] === '原始正文', 'children 原样直出（模型最终正文不丢）', JSON.stringify(out.children))
  t.cleanup()
}

{
  console.log('\n=== T1-F：已有外部 shadow（priority -1）时降档到 -2 ===')
  const slots = makeSlots()
  // 模拟 Winter dsh-turn-fold 已注册 -1 shadow
  slots._entries.push({ options: { key: 'assistant-step', priority: -1 }, locale: 'chat', component: function Foreign() {} })
  const t = boot(slots)
  const ours = slots._entries.filter(e => e.options.key === 'assistant-step' && (e.options.priority ?? 0) < 0).find(e => e.options.priority === -2)
  assert(ours !== undefined, '检测到已有 -1 shadow 后降到 -2（注册了 -2 entry）', 'priorities=' + slots._entries.filter(e => e.options.key === 'assistant-step').map(e => e.options.priority).join(','))
  t.cleanup()
  const remaining = slots._entries.filter(e => e.options.key === 'assistant-step' && (e.options.priority ?? 0) < 0)
  assert(remaining.length === 1 && remaining[0].options.priority === -1, 'cleanup 只移除自己的 entry，外部 shadow 保留')
}

{
  console.log('\n=== T1-G：priority 避让基准取全量最小值（不只看负值） ===')
  // SlotCore 规则：priority 升序、最低者渲染，同 key 同 priority 才抛错。
  // 加固后取所有同 key 条目的最小 priority 再减 1（下限 -1），无论内置将来
  // 显式声明何值都能稳定占住最低位；而不是像旧逻辑那样只盯 <0 的条目。
  const slots = makeSlots()
  // 另一个已存在的阴影插件占了 -2：我们必须落到 -3，否则与它同 priority 抛错。
  slots._entries.push({ options: { key: 'assistant-step', priority: -2 }, locale: 'chat', component: function ForeignShadow() {} })
  const t = boot(slots)
  const ours = slots._entries.filter(e => e.options.key === 'assistant-step').map(e => e.options.priority ?? 0)
  assert(Math.min(...ours) === -3 && ours.includes(-3), '已有 -2 shadow 时我们落到 -3（严格低于全部既有条目）', 'priorities=' + ours.join(','))
  t.cleanup()
}
{
  console.log('\n=== T1-H：无显式 priority 的内置时仍为 -1（默认 0 之下一档） ===')
  const slots = makeSlots()
  const t = boot(slots)
  const ours = slots._entries.filter(e => e.options.key === 'assistant-step').map(e => e.options.priority ?? 0)
  assert(Math.min(...ours) === -1, '内置默认 0 时取 -1', 'priorities=' + ours.join(','))
  t.cleanup()
}

{
  console.log('\n=== T1-I：0.2.2 内置 face 新增 resolveFilePath/fileMentions —— shadow 必须整体透传 ===')
  // 0.2.2（0.2.2-rc.1 实测）把 fileMentions 从 ChatView kit 挪进 node 级 inject
  // face，并新增 resolveFilePath；内置 AssistantNodeView 在「已闭合回合的最终回复」
  // 上会无守卫调用 fileMentions(owner, …)。旧实现只转发 hooks.presentation ⇒
  // shadow 条目渲染内置组件时抛 TypeError: fileMentions is not a function ⇒
  // SlotErrorBoundary 退市 ⇒ 指标注入永久失效（真机页面 data-dshcf-* 全 0）。
  const presentationSource = { getSnapshot: () => ({}), subscribe: () => () => {} }
  let receivedSessionId = null
  const builtinInject = (sessionId) => {
    receivedSessionId = sessionId
    return {
      hooks: { presentation: presentationSource },
      resolveFilePath: (p) => '/abs/' + p,
      fileMentions: (owner, getTriggerProps) => ({ owner, getTriggerProps }),
    }
  }
  const slots = makeSlots('chat', builtinInject)
  // 内置组件按 0.2.2 真机行为：闭合回合最终回复上无条件调用 fileMentions。
  slots._entries[0].component = function BuiltinStep(props) {
    const mentions = props.fileMentions({ turn: 1 }, () => ({}))
    const filePath = props.resolveFilePath('a.txt')
    return reactStub.createElement('span', null, mentions === null || filePath !== '/abs/a.txt' ? 'builtin:bad' : 'builtin:ok')
  }
  const t = boot(slots)
  const shadow = shadowEntry(slots)
  const face = shadow.options.inject('sess-42')
  assert(receivedSessionId === 'sess-42',
    '绑定期 sessionId 原样转给内置 inject 工厂（旧实现无参调用 ⇒ undefined）',
    'got=' + String(receivedSessionId))
  assert(face !== null && typeof face === 'object' && face.hooks && face.hooks.presentation === presentationSource,
    'presentation hook 仍然透传（usePresentation 不能丢）')
  assert(typeof face.resolveFilePath === 'function',
    '0.2.2 新增 resolveFilePath 透传（旧实现丢弃）')
  assert(typeof face.fileMentions === 'function',
    '0.2.2 新增 fileMentions 透传（旧实现丢弃；缺它内置组件抛 TypeError）')
  // 端到端：把 face 的一级 prop 合并进 shadow 渲染器 props（模拟框架 runInject
  // 合并结果），委托渲染内置组件不得抛错，且内置组件拿到两个新 prop。
  const node = { key: 'n1', location: { kind: 'step', turn: { turn: 3 } } }
  const state = {
    chat: { order: ['n1'], nodes: { get: (k) => (k === 'n1' ? node : undefined) } },
    turnTimings: new Map([[3, { startTime: 1000, endTime: 4000 }]]),
    sessionId: 'sess-42',
  }
  const rendererProps = { node, useSession: (sel) => sel(state), sessionId: 'sess-42', usePresentation: () => ({}) }
  for (const [name, value] of Object.entries(face)) {
    if (name !== 'hooks') rendererProps[name] = value
  }
  let renderError = null
  let out = null
  try { out = shadow.component(rendererProps) } catch (error) { renderError = error }
  assert(renderError === null,
    '渲染包装步骤不抛错（防御性：reactStub 不执行内置组件，旧实现也不会在此层抛；真正鉴别在下方 builtinError / rendered）',
    String(renderError))
  let rendered = null
  let builtinError = null
  const builtinEl = renderError === null && out !== null && Array.isArray(out.children) ? out.children[0] : null
  try {
    if (builtinEl !== null && builtinEl !== undefined && typeof builtinEl.type === 'function') rendered = builtinEl.type(builtinEl.props)
  } catch (error) { builtinError = error }
  assert(builtinError === null,
    '内置组件执行时不抛错（旧实现会被这条杀掉）',
    String(builtinError))
  assert(rendered !== null && Array.isArray(rendered.children) && rendered.children[0] === 'builtin:ok',
    '内置组件拿到 fileMentions + resolveFilePath 并正常渲染',
    JSON.stringify(rendered === null ? null : rendered.children))
  t.cleanup()
}

console.log('\nturn-metrics-injector: failures=' + failures)
if (failures > 0) process.exit(1)
