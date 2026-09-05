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
function makeSlots(builtinLocale = 'chat') {
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
  // 内置 assistant-step entry（priority 0），渲染器为占位组件
  slots._entries.push({
    options: { key: 'assistant-step', priority: 0 },
    locale: builtinLocale,
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

console.log('\nturn-metrics-injector: failures=' + failures)
if (failures > 0) process.exit(1)
