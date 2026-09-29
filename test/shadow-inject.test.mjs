/**
 * shadow-inject.test.mjs — W2（方案 C）：shadow entry 的 inject 面转发测试。
 *
 * 背景：DSH 0.1.7 起内置 assistant-step 注册时声明了
 * \`inject: () => ({ hooks: { presentation } })\`（CHAT:6736-6741），而 renderer 只按
 * **entry 自己的** options.inject 调 runInject（ui-renderer/client.js:415-422），
 * slot 级声明的 CHAT_NODE_INJECT（CHAT:12311-12315）帮不上忙。shadow entry 不声明
 * inject 就拿不到一级 prop \`usePresentation\`，委托渲染内置 AssistantNodeView 时抛
 * "usePresentation is not a function" → 整条槽位条目崩溃（§2.2 实测 200+ 报错）。
 *
 * 本文件用**复刻框架真实语义**的 slots mock 驱动：
 *   register(spec, comp) 保存 spec.inject 工厂（rc.1：inject 在条目顶层）
 *   runInject(entry) → bindInjectSources(face) → observableHook(source)
 *   把 face.hooks.presentation 包成一级 prop \`usePresentation\`，再按 renderer:772-777 的
 *   \`{...kit, ...injected, ...ownerProps}\` 合并顺序交给组件。
 * observableHook 桩刻意复刻 \`hookCache\`（WeakMap）的 \`.set(undefined, …)\` 抛 TypeError
 * 行为，以此验证「inject 工厂绝不把非法 source 传出去」。
 *
 * ★ presentation source 的真实形状是 **observable 对象** \`{getSnapshot, subscribe}\`
 *   （derivePresentationPolicy(mode)，CHAT:12049-12054），**不是函数**——§2.2 里
 *   「source 不是函数」的观察正是这一点。guard 写成 typeof === 'function' 会把可用
 *   source 丢掉（场景 A/C 专门钉住这条）。
 *
 * 场景：
 *   A inject() 原样转发 observable source，框架包装出可调用的 usePresentation
 *   B 内置 entry 无 inject（旧版 DSH）→ {}，且**仍然注册** shadow（旧降级已删）
 *   C 劣质 face（undefined / null / 原始值 / 非对象 face）→ {}，框架绑定期不抛
 *   D 内置工厂抛错 → 不向外抛，退回 {}
 *   E 注册仍带 key / priority / locale
 *   F 委托渲染直接 {...props}：保留兄弟 prop，且 kit 的 usePresentation 不被覆盖
 *   G 端到端：内置组件真正拿到 usePresentation；对照组证明缺它就抛（改动必需）
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

/** 与 ui-renderer/client.js:219-226 等价：WeakMap 缓存 + bindSnapshotSelector。
 * 刻意保留「source 为 undefined 时 WeakMap.set 抛 TypeError」这一真实行为。 */
const hookCache = new WeakMap()
function observableHook(source) {
  let hook = hookCache.get(source)
  if (hook === undefined) {
    hook = (selector) => selector(source.getSnapshot())
    hookCache.set(source, hook)
  }
  return hook
}
/** 与 ui-renderer/client.js:424-439 等价（含 "{} 早退" 分支）。 */
function bindInjectSources(face) {
  const sources = face['hooks']
  const keyedSources = face['keyedHooks']
  if (sources === undefined && keyedSources === undefined) return face
  const { hooks: _h, keyedHooks: _k, ...rest } = face
  const bound = rest
  for (const [name, source] of Object.entries(sources ?? {})) {
    bound['use' + name[0].toUpperCase() + name.slice(1)] = observableHook(source)
  }
  return bound
}
/** 与 ui-renderer/client.js:415-422 等价。 */
function runInject(entry) {
  if (typeof entry.inject !== 'function') return {}
  return bindInjectSources(entry.inject())
}
/** 与 ui-renderer/client.js:772-777 等价的 prop 合并顺序。
 * 合并后按 React 语义**实际渲染** entry.component（我们的 shadow 渲染器返回
 * 的是 createElement 描述对象，React 会继续实例化它 → 这里模拟这一层，
 * 否则内置组件的抛错/取值都不会发生）。 */
function renderEntry(entry, kit, ownerProps) {
  const out = entry.component({ ...kit, ...runInject(entry), ...(ownerProps ?? {}) })
  return instantiate(out)
}
/** 模拟 React 对 createElement 描述对象的实例化（递归到叶子）。
 * - 函数型 type：调用它（这就是组件真正执行、hook 真正被调用的时刻）；
 * - 字符串型 type（宿主元素）：递归实例化 children；
 * - 其它（纯文本等）：原样返回。 */
function instantiate(el) {
  if (el === null || typeof el !== 'object') return el
  if (typeof el.type === 'function') {
    const rendered = el.type({ ...el.props, children: el.children })
    return instantiate(rendered)
  }
  if (typeof el.type === 'string') {
    const kids = (el.children ?? []).map(instantiate)
    return { type: el.type, props: el.props, children: kids }
  }
  return el
}

/** 内置 presentation 的真实形状：observable 对象（**不是函数**）。
 * 契约 = `{ getSnapshot, subscribe }`（可选 getRevision / getServerSnapshot）；
 * 真实实现见 CHAT:12049-12054 derivePresentationPolicy(mode)。 */
const policySnapshot = { mode: 'standard', stepGrouping: 'collapsed' }
const presentationSource = {
  getSnapshot: () => policySnapshot,
  subscribe: () => () => {},
}
/** 复刻 renderer standardKit/standardProps（renderer:646-657、715-745）：
 * slot 级 inject 面（CHAT:12329 `hooks: { presentation }`）物化出的 kit props。
 * 它和内置 entry 引用**同一个** presentation observable → observableHook 按 source
 * 缓存 → 与 entry 级注入的 usePresentation 是同一个实例，不会造成 prop 冲突。 */
function standardProps(sessionSource) {
  return {
    useSession: observableHook(sessionSource),
    usePresentation: observableHook(presentationSource),
  }
}
/** 复刻 renderer:922-924 assertNoPropOverlap。 */
function assertNoPropOverlap(owner, provided, received) {
  for (const name of Object.keys(received)) {
    if (Object.hasOwn(provided, name)) throw new Error(owner + " received duplicate prop '" + name + "'")
  }
}
function builtinAssistantInject() {
  return { hooks: { presentation: presentationSource } }
}

function makeSlots(opts = {}) {
  // 兼容 makeSlots('chat') 的简写
  if (typeof opts === 'string') opts = { builtinLocale: opts }
  // 注意：不能用解构默认值 —— `{builtinInject: undefined}` 会触发默认值、
  // 拿不到「内置没有 inject 面」这一场景。用 in 判定。
  const builtinInject = 'builtinInject' in opts ? opts.builtinInject : builtinAssistantInject
  const builtinLocale = opts.builtinLocale ?? 'chat'
  const slots = {
    _entries: [],
    entries() { return this._entries },
    inject(_slot, cb) { return cb() },
    register(spec, component) {
      const entry = {
        options: { ...spec },
        // rc.1 SlotCore：inject / locale 在条目顶层（不在 options 里）
        inject: typeof spec.inject === 'function' ? spec.inject : undefined,
        locale: spec.locale,
        component,
      }
      this._entries.push(entry)
      return () => {
        const i = this._entries.indexOf(entry)
        if (i >= 0) this._entries.splice(i, 1)
      }
    },
  }
  slots._entries.push({
    options: { key: 'assistant-step', priority: 0 },
    locale: builtinLocale,
    inject: builtinInject,
    component: function BuiltinStep(props) {
      return reactStub.createElement('span', { className: 'builtin', 'data-hook-type': typeof props.usePresentation }, props.children)
    },
  })
  return slots
}

function shadowEntry(slots) {
  return slots._entries.find(e => e.options && e.options.key === 'assistant-step' && (e.options.priority ?? 0) < 0)
}

function boot(slots) {
  const env = installDomGlobals()
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

// ---------------------------------------------------------------------------
{
  console.log('\n=== A：inject() 原样转发 observable presentation source ===')
  const slots = makeSlots()
  const t = boot(slots)
  const shadow = shadowEntry(slots)
  assert(shadow !== undefined, '安装后注册了 assistant-step shadow')
  assert(typeof shadow.inject === 'function', 'shadow entry 声明了 inject（方案 C 的前提）')
  const face = shadow.inject()
  assert(face !== null && typeof face === 'object', 'inject() 返回对象')
  assert(face.hooks !== undefined && face.hooks.presentation === presentationSource, 'hooks.presentation 是内置的同一个 source（未包装/未复制）')
  assert(Object.keys(face).length === 1 && Object.keys(face.hooks).length === 1, '只转发 presentation 一个 source', JSON.stringify(Object.keys(face)))
  // ★ source 不是函数（observable 对象），guard 不得按 typeof function 判
  assert(typeof presentationSource !== 'function' && typeof face.hooks.presentation !== 'function', 'source 是 observable 对象而非函数（guard 必须放行对象）')
  // 框架侧：复刻 bindInjectSources 得到一级 prop usePresentation
  const bound = runInject(shadow)
  assert(typeof bound.usePresentation === 'function', '框架 observableHook 包装后得到可调用的 usePresentation', Object.keys(bound).join(','))
  assert(bound.usePresentation((v) => v) === policySnapshot, 'usePresentation 能取到内置快照值')
  assert(!('hooks' in bound), 'hooks 隔间被消费掉、不残留为 prop')
  t.cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== B：内置 entry 无 inject（旧版 DSH / 宿主结构变化）→ {} ===')
  const slots = makeSlots({ builtinInject: undefined })
  assert(slots._entries[0].inject === undefined, '夹具：内置 entry 确实没有 inject 面')
  const t = boot(slots)
  const shadow = shadowEntry(slots)
  assert(shadow !== undefined, '内置无 inject 时**仍然注册** shadow（旧「不注册」降级已移除）')
  const face = shadow.inject()
  assert(face !== null && typeof face === 'object' && Object.keys(face).length === 0, 'inject() 返回空 face {}', JSON.stringify(face))
  let bindErr = null
  let bound = null
  try { bound = runInject(shadow) } catch (error) { bindErr = error }
  assert(bindErr === null, '框架绑定期不抛', String(bindErr))
  assert(bound !== null && typeof bound.usePresentation === 'undefined', '空 face → 无 usePresentation prop（命中 bindInjectSources 早退）')
  t.cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== C：劣质 face → {}（绝不把非法 source 交给 WeakMap） ===')
  // 每一例都会让「不做 guard 的实现」在 observableHook 的 WeakMap.set 处崩溃
  const cases = [
    ['hooks.presentation === undefined', () => ({ hooks: { presentation: undefined } })],
    ['hooks 为 {}', () => ({ hooks: {} })],
    ['hooks 为 null', () => ({ hooks: null })],
    ['face 为 null', () => null],
    ['face 为字符串（非对象）', () => 'nope'],
    ['presentation 为 null', () => ({ hooks: { presentation: null } })],
    ['presentation 为数字', () => ({ hooks: { presentation: 42 } })],
    ['presentation 为字符串', () => ({ hooks: { presentation: 'x' } })],
    ['face 无 hooks', () => ({ other: 1 })],
  ]
  for (const [label, builtinInject] of cases) {
    const slots = makeSlots({ builtinInject })
    const t = boot(slots)
    const shadow = shadowEntry(slots)
    let face = null
    let threw = null
    try { face = shadow.inject() } catch (error) { threw = error }
    assert(threw === null, label + '：inject() 不抛错', String(threw))
    assert(face !== null && typeof face === 'object' && Object.keys(face).length === 0, label + '：返回 {}', JSON.stringify(face))
    let bound = null
    let bindErr = null
    try { bound = runInject(shadow) } catch (error) { bindErr = error }
    assert(bindErr === null, label + '：框架绑定期不抛 TypeError（非法 source 已被挡下）', String(bindErr))
    assert(bound !== null && typeof bound.usePresentation === 'undefined', label + '：无 usePresentation prop')
    t.cleanup()
  }
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== D：内置 inject 工厂抛错 → 不向外抛，退回 {} ===')
  const slots = makeSlots({ builtinInject: () => { throw new Error('inner boom') } })
  const t = boot(slots)
  const shadow = shadowEntry(slots)
  let face = null
  let threw = null
  try { face = shadow.inject() } catch (error) { threw = error }
  assert(threw === null, 'inject() 吞掉内置工厂的异常', String(threw))
  assert(face !== null && Object.keys(face).length === 0, '抛错时退回 {}', JSON.stringify(face))
  let bindErr = null
  try { runInject(shadow) } catch (error) { bindErr = error }
  assert(bindErr === null, '框架绑定期同样不抛', String(bindErr))
  t.cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== E：注册仍带 key / priority / locale ===')
  const slots = makeSlots('chat')
  const t = boot(slots)
  const shadow = shadowEntry(slots)
  assert(shadow.options.key === 'assistant-step', 'key = assistant-step')
  assert(shadow.options.priority === -1, 'priority = -1（内置默认 0 之下一档）', 'priority=' + shadow.options.priority)
  assert(shadow.locale === 'chat', "locale = 'chat'（跟随内置 NS）", 'locale=' + shadow.locale)
  assert(typeof shadow.component === 'function', 'shadow 渲染器是函数')
  t.cleanup()
  // 反证旧降级已删除：旧 canShadowBuiltin() 在 source 非函数/工厂抛错时返回 false
  // → **不注册** shadow（指标功能全丢）。现在任何 face 形态都必须照常注册。
  for (const [label, builtinInject] of [
    ['source 为普通对象', () => ({ hooks: { presentation: { notObservable: true } } })],
    ['工厂抛错', () => { throw new Error('boom') }],
  ]) {
    const s2 = makeSlots({ builtinInject })
    const t2 = boot(s2)
    assert(shadowEntry(s2) !== undefined, label + '：仍注册 shadow（旧 canShadowBuiltin 降级已删除）')
    t2.cleanup()
  }
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== F：委托渲染直接 {...props}（保留兄弟 prop、不覆盖 kit 的 usePresentation） ===')
  const node = { key: 'n1', location: { kind: 'step', turn: { turn: 3 } } }
  const state = {
    chat: { order: ['n1'], nodes: { get: (k) => (k === 'n1' ? node : undefined) } },
    turnTimings: new Map([[3, { startTime: 1000, endTime: 4000 }]]),
    sessionId: 'sess-x',
  }
  const useSession = (sel) => sel(state)
  // kit 的 usePresentation = 槽位级 standard binding 物化出来的哨兵。注意：内置
  // entry 与 slot 级 inject 引用的是**同一个** presentation observable，框架
  // observableHook 按 source 缓存 → 两者本就是同一个 hook 实例，不该出现覆盖冲突。
  const kitUsePresentation = (selector) => selector({ sentinel: true })
  // 用探针组件捕获委托 props（在「React 实例化」那一层被调用）。
  let delegatedProps = null
  const probe = function Probe(props) { delegatedProps = props; return reactStub.createElement('span', { className: 'probe' }) }
  const slots2 = makeSlots()
  slots2._entries[0].component = probe
  const t2 = boot(slots2)
  const shadow2 = shadowEntry(slots2)
  renderEntry(shadow2, { node, useSession, usePresentation: kitUsePresentation, sessionId: 'sess-x' })
  assert(delegatedProps !== null, '委托渲染内置组件（Probe 被实际渲染）')
  assert(delegatedProps.node === node && delegatedProps.sessionId === 'sess-x', '兄弟 prop 原样透传（node / sessionId）')
  assert(typeof delegatedProps.useSession === 'function', 'useSession 等 kit prop 保留')
  // kit 与本 entry 的 injected 都走 observableHook(同一个 source) → 同一缓存实例
  assert(delegatedProps.usePresentation === hookCache.get(presentationSource), 'usePresentation 来自框架包装（同一 WeakMap 缓存实例，非手工塞入）')
  assert(delegatedProps.usePresentation !== kitUsePresentation, '不再手工塞 use<Name>（旧 withBuiltinInject 的覆盖风险已消除）')
  // 对照组：kit 完全不提供 usePresentation 时，仍由我们声明的 inject 补上
  delegatedProps = null
  renderEntry(shadow2, { node, useSession, sessionId: 'sess-x' })
  assert(typeof delegatedProps.usePresentation === 'function', 'kit 不提供时仍由 entry 级 inject 补上 usePresentation')

  // ★ 契约面：用**真实框架形状**的 kit（standardKit 物化 + useSession/usePresentation）
  // 走一遍，而不是手写哨兵。
  //
  // 已核实的框架事实（勿误读）：内置 entry 的 inject 面（CHAT:6736-6741）与
  // slot 级 CHAT_NODE_INJECT（CHAT:12329）引用的是**同一个** presentation 对象
  // （CHAT:12271 的局部量两处都用），而 observableHook 按 source 做 WeakMap 缓存
  // → 两侧物化出的 prop 名与实例完全一致。renderer 的 assertNoPropOverlap
  // （renderer:922-924）**只在 factory 路径**被调（renderer:1005），普通 entry 的
  // renderEntry（renderer:790-802 / 861-866）不校验注入面与 kit 的重名——所以
  // 「同名」不是问题：`{...kit, ...injected}` 覆盖上去的仍是同一个 hook 实例，
  // 行为零分歧。下面两条断言把这一点钉死。
  const sessionSource = { getSnapshot: () => state, subscribe: () => () => {} }
  const realKit = { ...standardProps(sessionSource), node, sessionId: 'sess-x' }
  const injectedProps = runInject(shadow2)
  assert(
    Object.keys(injectedProps).length === 1 && Object.hasOwn(injectedProps, 'usePresentation'),
    'entry 级 inject 物化出的 prop 名正是标准名 usePresentation',
    Object.keys(injectedProps).join(','),
  )
  assert(injectedProps.usePresentation === realKit.usePresentation, '与 slot 级 standard binding 是同一 hook 实例（同一 source → observableHook 缓存）')
  // 记录框架的非对称性：factory 路径 assertNoPropOverlap 会真的因同名报错，
  // 普通 entry 路径不会——这解释了为什么本改动安全。
  let overlapErr = null
  try { assertNoPropOverlap("factory 'x' inject", realKit, injectedProps) } catch (error) { overlapErr = error }
  assert(overlapErr !== null, '（记录框架事实）该同名只在 factory 路径被 assertNoPropOverlap 拦下，普通 entry 路径不校验', String(overlapErr))
  // 真正渲染一遍，确认委托链路在「框架形状 props」下也成立
  delegatedProps = null
  renderEntry(shadow2, realKit)
  assert(delegatedProps !== null && typeof delegatedProps.usePresentation === 'function', '框架形状 props 下委托渲染仍持有可用 usePresentation')
  // H 前置：dispose 之后 inject 工厂必须停止转发（否则 HMR 后可能转发旧 bundle 闭包
  // 里的 source）。这里先记录 dispose 前的行为，H 场景单独断言。
  t2.cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== H：R1 dispose 后不再转发内置 source（无 HMR 残留） ===')
  const slots = makeSlots()
  const t = boot(slots)
  const shadow = shadowEntry(slots)
  assert(typeof shadow.inject === 'function' && Object.keys(shadow.inject().hooks ?? {}).length === 1, 'dispose 前 inject() 正常转发 presentation')
  t.cleanup()
  // dispose 已把 builtinAssistantInject 归零 + shadow 从 slots 摘除；调用残留
  // 引用上的 inject 工厂也不得再交出 source（旧 bundle 闭包引用会被释放）。
  let face = null
  let threw = null
  try { face = shadow.inject() } catch (error) { threw = error }
  assert(threw === null, 'dispose 后调用残留 shadow 的 inject() 不抛错', String(threw))
  assert(face !== null && Object.keys(face).length === 0, 'dispose 后 inject() 返回 {}（不转发旧 source）', JSON.stringify(face))
  assert(shadowEntry(slots) === undefined, 'dispose 后宿主 slots 无 shadow 残留')
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== G：端到端——内置组件经我们的 inject 面拿到 usePresentation ===')
  const slots = makeSlots()
  const t = boot(slots)
  const inner = slots._entries.find(e => e.options.key === 'assistant-step' && (e.options.priority ?? 0) === 0)
  const seen = []
  // 复刻内置 AssistantNodeView/ReasoningRow 的失败模式：缺 usePresentation 即抛。
  inner.component = function AssistantNodeView(props) {
    if (typeof props.usePresentation !== 'function') throw new TypeError('usePresentation is not a function')
    seen.push(props.usePresentation((v) => v))
    return reactStub.createElement('span', { className: 'builtin' }, 'ok')
  }
  t.cleanup()
  const t2 = boot(slots)
  const shadow = shadowEntry(slots)
  const node = { key: 'n1', location: { kind: 'step', turn: { turn: 3 } } }
  const state = { chat: { order: ['n1'], nodes: { get: () => node } }, turnTimings: new Map([[3, { startTime: 1, endTime: 2 }]]), sessionId: 's' }
  // 关键：kit **不**提供 usePresentation（复现 §2.2 实测的 shadow props 形状），
  // 只有我们声明的 entry 级 inject 能把它补上。
  let out = null
  let err = null
  try {
    out = renderEntry(shadow, { node, useSession: (sel) => sel(state), sessionId: 's' })
  } catch (error) { err = error }
  assert(err === null, '委托渲染不再抛 usePresentation is not a function', String(err))
  assert(seen.length === 1 && seen[0] === policySnapshot, '内置组件实际用上了框架物化的 usePresentation（取到内置快照）', JSON.stringify(seen))
  assert(
    out !== null && out.type === 'div'
      && Array.isArray(out.children) && out.children[0]?.type === 'span' && out.children[0]?.props?.className === 'builtin',
    '端到端：div 包装内委托渲染到内置组件',
    JSON.stringify({ out: out?.type, child: out?.children?.[0]?.type, cls: out?.children?.[0]?.props?.className }),
  )
  // 对照组：去掉我们的 inject 声明（模拟改动前的 shadow）→ 内置组件立刻抛，证伪旧行为
  let ctrlErr = null
  try { renderEntry({ ...shadow, inject: undefined }, { node, useSession: (sel) => sel(state), sessionId: 's' }) } catch (error) { ctrlErr = error }
  assert(ctrlErr instanceof TypeError && /usePresentation/.test(String(ctrlErr)), '（对照）不声明 inject 时内置组件抛 usePresentation is not a function', String(ctrlErr))
  t2.cleanup()
}

console.log('\nshadow-inject: failures=' + failures)
if (failures > 0) process.exit(1)
