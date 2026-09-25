/**
 * settings-card.test.mjs —— 设置卡片与两代设置契约适配层单测。
 *
 * 此前这条链路零覆盖，而它恰恰是本插件最容易随 DSH 升级漂移的接缝
 * （0.1.7-rc.2 就是因静态 inject 了被删除的 settingsScope 而整个 boot 失败）。
 * 覆盖：
 * - createLateScope：未就绪占位 / 解析后委托 / 订阅转发 / 监听器异常隔离；
 * - resolveSettingsScope：configForms（0.1.7+）与 settingsScope（旧版）能力
 *   选择、服务晚到经 ctx.inject 接上、bind 抛错不拖垮插件；
 * - cardSourceFromForm / cardSourceFromScope：字段操作翻译、revision 栅栏、
 *   宿主拒绝（false）与旧契约逐字段转发；
 * - setupSettingsCard：两代 slot 各注册一次（plugins.item 的 id/order/label、
 *   settings.plugin.item 的 key）与 disposer 清理；
 * - 卡片组件：summary / page / 旧 disclosure 三种视图分支、就绪门禁、
 *   原子提交与宿主拒绝时保留用户输入。
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

/**
 * 最小 React 桩：useState 的 set 同步更新并触发同步重渲染（卡片用 useState
 * 承载「待提交字段」，测保存路径必须能真正驱动状态流转）；其余 hooks 只求值
 * 一次（首次挂载语义）。
 */
function makeHarness() {
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
    /** 挂载（清空 hooks 模拟首次渲染）并返回首帧树。 */
    mount(component, props) {
      hooks.length = 0
      mounted = { component, props }
      rerender()
      return tree
    },
    /** 最近一帧树（setState 后会同步更新）。 */
    get tree() { return tree },
  }
}

/** 经真实构建产物加载模块（与其余 client 侧测试同款）。 */
function boot() {
  const harness = makeHarness()
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

/**
 * slots 服务 mock。
 *
 * 关键：真实 slots 对**未声明**的 slot 不派发（SlotCore.register 对未声明 slot
 * 会抛 "slot ... is not declared"），所以这里默认只声明本插件要注册的两个
 * key；之前的 mock 对任意 key 都立即执行回调，会给出「两条 slot 都已注册」的
 * 假信心。要测未声明场景传 declared。
 */
function makeSlots(declared = ['plugins.item', 'settings.plugin.item']) {
  const entries = []
  const injected = []
  return {
    entries,
    injected,
    declared,
    inject(slot, cb) {
      injected.push(slot)
      if (!declared.includes(slot)) return () => {}
      const disposer = cb()
      return () => { if (typeof disposer === 'function') disposer() }
    },
    register(options, component) {
      const entry = { options, component, disposed: false }
      entries.push(entry)
      return () => { entry.disposed = true }
    },
  }
}

/** 旧契约 scope mock（可读快照 + 记账写入）。 */
function makeScope(overrides = {}) {
  const calls = []
  const scope = {
    calls,
    getSnapshot: () => ({ status: 'ready', value: { statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true }),
    subscribe: () => () => {},
    set: async (field, value) => { calls.push(['set', field, value]) },
    unset: async (field) => { calls.push(['unset', field]) },
    ...overrides,
  }
  return scope
}

/** 新契约 ConfigPageForm mock。 */
function makeForm({ state, mutate } = {}) {
  const calls = []
  const form = {
    calls,
    state: state ?? { status: 'ready', value: { statusText: 'Deep sleeping...' }, base: {}, user: {}, writable: true, revision: 3 },
    mutate: mutate ?? (async (ops, rev) => { calls.push({ ops, rev }); return true }),
  }
  return form
}

function findAll(node, pred, acc = []) {
  if (node === null || node === undefined || typeof node !== 'object') return acc
  if (Array.isArray(node)) { for (const child of node) findAll(child, pred, acc); return acc }
  if (pred(node)) acc.push(node)
  for (const child of node.children ?? []) findAll(child, pred, acc)
  return acc
}
function textOf(node) {
  if (typeof node === 'string') return node
  if (node === null || node === undefined || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children ?? []).map(textOf).join('')
}
function byClass(node, className) {
  return findAll(node, n => n.props?.className === className)
}

// ── createLateScope ──────────────────────────────────────────────────────
{
  console.log('\n=== L1：未解析前是恒定 unavailable 的占位 scope ===')
  const { m } = boot()
  const late = m.createLateScope()
  const snapshot = late.scope.getSnapshot()
  assert(snapshot.status === 'unavailable', '未解析前 status=unavailable')
  assert(snapshot.writable === false, '未解析前 writable=false')
  assert(snapshot.value === undefined, '未解析前 value=undefined')
  let threw = false
  try {
    await late.scope.set('statusText', 'x')
    await late.scope.unset('statusText')
  } catch { threw = true }
  assert(!threw, '未解析前 set/unset 静默 no-op（不抛）')
}

{
  console.log('\n=== L2：解析后委托内层，订阅在解析时被通知 ===')
  const { m } = boot()
  const late = m.createLateScope()
  let notified = 0
  late.scope.subscribe(() => { notified += 1 })
  assert(notified === 0, '解析前不通知')
  const inner = makeScope({ getSnapshot: () => ({ status: 'ready', value: { statusText: 'A' }, base: {}, user: {}, writable: true }) })
  late.resolve(inner)
  assert(notified === 1, '解析时通知已订阅者', 'notified=' + notified)
  assert(late.scope.getSnapshot().value.statusText === 'A', '解析后委托内层快照')
  await late.scope.set('statusText', 'B')
  assert(inner.calls.length === 1 && inner.calls[0][1] === 'statusText', '解析后 set 转发内层')
}

{
  console.log('\n=== L3：内层通知被转发；同一内层重复解析不重复订阅 ===')
  const { m } = boot()
  const late = m.createLateScope()
  let innerListener = null
  let subscribes = 0
  const inner = makeScope({
    subscribe(listener) { subscribes += 1; innerListener = listener; return () => { innerListener = null } },
  })
  let notified = 0
  late.scope.subscribe(() => { notified += 1 })
  late.resolve(inner)
  assert(subscribes === 1, '解析时订阅内层一次')
  innerListener()
  assert(notified === 2, '内层通知转发给 consumer', 'notified=' + notified)
  late.resolve(inner)
  assert(subscribes === 1, '同一内层重复解析不重复订阅')
}

{
  console.log('\n=== L4：单个监听器抛错不阻断其余监听器 ===')
  const { m } = boot()
  const late = m.createLateScope()
  let reached = false
  late.scope.subscribe(() => { throw new Error('listener-boom') })
  late.scope.subscribe(() => { reached = true })
  const errors = []
  const originalError = console.error
  console.error = (...args) => { errors.push(args[0]) }
  try { late.resolve(makeScope()) } finally { console.error = originalError }
  assert(reached, '后注册的监听器仍被通知')
  assert(errors.length === 1, '抛错被记录一次', 'errors=' + errors.length)
}

// ── resolveSettingsScope ─────────────────────────────────────────────────
{
  console.log('\n=== R1：configForms（0.1.7+）优先于 settingsScope ===')
  const { m } = boot()
  const late = m.createLateScope()
  const inner = makeScope({ getSnapshot: () => ({ status: 'ready', value: { statusText: 'CF' }, base: {}, user: {}, writable: true }) })
  let asked = null
  const ctx = {
    effect: () => {},
    configForms: { get: (id) => { asked = id; return inner } },
    settingsScope: { bind: () => { throw new Error('settingsScope 不应被使用') } },
  }
  m.resolveSettingsScope(ctx, late)
  assert(asked === 'dsh-auto-collapse', 'configForms.get 收到插件命名空间', 'asked=' + asked)
  assert(late.scope.getSnapshot().value.statusText === 'CF', '解析到 configForms 的 scope')
}

{
  console.log('\n=== R2：无 configForms 时回退 settingsScope.bind（旧版） ===')
  const { m } = boot()
  const late = m.createLateScope()
  const inner = makeScope({ getSnapshot: () => ({ status: 'ready', value: { statusText: 'SS' }, base: {}, user: {}, writable: true }) })
  let bound = null
  const ctx = { effect: () => {}, settingsScope: { bind: (spec) => { bound = spec; return inner } } }
  m.resolveSettingsScope(ctx, late)
  assert(bound !== null && bound.namespace === 'dsh-auto-collapse', 'bind 收到插件命名空间')
  assert(late.scope.getSnapshot().value.statusText === 'SS', '解析到 settingsScope 的 scope')
}

{
  console.log('\n=== R3：两个服务都缺席时注册 ctx.inject 等晚到（不抛） ===')
  const { m } = boot()
  const late = m.createLateScope()
  const requested = []
  const ctx = { effect: () => {}, inject: (deps) => { requested.push(deps[0]); return () => {} } }
  let threw = false
  try { m.resolveSettingsScope(ctx, late) } catch { threw = true }
  assert(!threw, '两服务缺席不抛错')
  assert(requested.includes('configForms') && requested.includes('settingsScope'), '两个服务名都登记了等待回调')
  assert(late.scope.getSnapshot().status === 'unavailable', '仍保持占位（不误判就绪）')
}

{
  console.log('\n=== R4：服务晚到经回调接上 ===')
  const { m } = boot()
  const late = m.createLateScope()
  const callbacks = []
  const ctx = { effect: () => {}, inject: (deps, cb) => { callbacks.push([deps[0], cb]); return () => {} } }
  m.resolveSettingsScope(ctx, late)
  const inner = makeScope({ getSnapshot: () => ({ status: 'ready', value: { statusText: 'LATE' }, base: {}, user: {}, writable: true }) })
  const entry = callbacks.find(([name]) => name === 'configForms')
  assert(entry !== undefined, '登记了 configForms 回调')
  entry[1]({ configForms: { get: () => inner } })
  assert(late.scope.getSnapshot().value.statusText === 'LATE', '服务晚到后 scope 接上真值')
}

{
  console.log('\n=== R5：bind 抛错被兜住（不拖垮插件） ===')
  const { m } = boot()
  const late = m.createLateScope()
  const callbacks = []
  const ctx = { effect: () => {}, inject: (deps, cb) => { callbacks.push([deps[0], cb]); return () => {} } }
  m.resolveSettingsScope(ctx, late)
  const errors = []
  const originalError = console.error
  console.error = (...args) => { errors.push(args[0]) }
  let threw = false
  try {
    callbacks.find(([n]) => n === 'configForms')[1]({ configForms: { get: () => { throw new Error('get-boom') } } })
  } catch { threw = true } finally { console.error = originalError }
  assert(!threw, 'bind 抛错不向外传播')
  assert(errors.length === 1, '抛错被记录', 'errors=' + errors.length)
}

// ── 数据源适配器 ──────────────────────────────────────────────────────────
{
  console.log('\n=== S1：cardSourceFromForm 字段操作翻译 + revision 栅栏 ===')
  const { m } = boot()
  const form = makeForm()
  const source = m.cardSourceFromForm(form)
  assert(source.getSnapshot().revision === 3, 'getSnapshot 透传 form.state')
  const accepted = await source.commit([
    { op: 'set', field: 'statusText', value: 'X' },
    { op: 'unset', field: 'keepLastRows' },
  ])
  assert(accepted === true, 'commit 返回宿主接受结果')
  assert(form.calls.length === 1, '一次 mutate 提交全部操作', 'calls=' + form.calls.length)
  assert(form.calls[0].rev === 3, 'mutate 收到 revision 栅栏', 'rev=' + form.calls[0].rev)
  assert(form.calls[0].ops.length === 2, '两个操作一次提交')
  assert(form.calls[0].ops[0].op === 'set' && form.calls[0].ops[0].path[0] === 'statusText' && form.calls[0].ops[0].value === 'X', 'set 翻译为 path 操作')
  assert(form.calls[0].ops[1].op === 'unset' && form.calls[0].ops[1].path[0] === 'keepLastRows', 'unset 翻译为 path 操作')
}

{
  console.log('\n=== S2：cardSourceFromScope 逐字段转发（旧契约无批量接口） ===')
  const { m } = boot()
  const scope = makeScope()
  const source = m.cardSourceFromScope(scope)
  const ok = await source.commit([
    { op: 'set', field: 'statusText', value: 'Y' },
    { op: 'unset', field: 'keepLastRows' },
  ])
  assert(ok === true, '旧契约 commit 返回 true')
  assert(scope.calls.length === 2, '两次字段写入', 'calls=' + scope.calls.length)
  assert(scope.calls[0][0] === 'set' && scope.calls[0][1] === 'statusText' && scope.calls[0][2] === 'Y', 'set 转发 scope.set')
  assert(scope.calls[1][0] === 'unset' && scope.calls[1][1] === 'keepLastRows', 'unset 转发 scope.unset')
}

// ── setupSettingsCard 注册 ────────────────────────────────────────────────
{
  console.log('\n=== C1：两代 slot 各注册一次，disposer 清理两条 ===')
  const { m } = boot()
  const slots = makeSlots()
  const dispose = m.setupSettingsCard({ slots }, makeScope())
  assert(slots.injected.includes('plugins.item'), 'inject plugins.item（0.1.7+）')
  assert(slots.injected.includes('settings.plugin.item'), 'inject settings.plugin.item（旧版）')
  const item = slots.entries.find(e => e.options.name === 'plugins.item')
  const legacy = slots.entries.find(e => e.options.name === 'settings.plugin.item')
  assert(item !== undefined && legacy !== undefined, '两条 slot 都已注册')
  assert(item.options.id === 'dsh-auto-collapse', 'plugins.item id 为插件命名空间')
  assert(item.options.label === 'dsh-auto-collapse', 'plugins.item 带 label')
  assert(typeof item.options.order === 'number', 'plugins.item 带 order')
  assert(legacy.options.key === 'dsh-auto-collapse', 'settings.plugin.item key 为插件命名空间')
  assert(typeof item.component === 'function' && typeof legacy.component === 'function', '两条都带渲染器')
  dispose()
  assert(slots.entries.every(e => e.disposed), 'dispose 后两条注册都被移除')
}

// ── 卡片组件视图分支 ──────────────────────────────────────────────────────
function mountItemCard() {
  const { m, harness } = boot()
  const slots = makeSlots()
  m.setupSettingsCard({ slots }, makeScope())
  const component = slots.entries.find(e => e.options.name === 'plugins.item').component
  return { harness, component }
}
function mountLegacyCard() {
  const { m, harness } = boot()
  const slots = makeSlots()
  const scope = makeScope()
  m.setupSettingsCard({ slots }, scope)
  const component = slots.entries.find(e => e.options.name === 'settings.plugin.item').component
  return { harness, component, scope }
}

{
  console.log('\n=== C2：summary 视图只给一行说明，不渲染表单 ===')
  const { harness, component } = mountItemCard()
  const tree = harness.mount(component, { view: 'summary' })
  assert(textOf(tree).includes('配置折叠行为'), 'summary 渲染卡片说明文案')
  assert(byClass(tree, 'dshcf-settings-body').length === 0, 'summary 不渲染表单主体')
  assert(findAll(tree, n => n.type === 'li').length === 0, 'summary 无自带卡片外壳')
}

{
  console.log('\n=== C3：page 视图直接交出表单主体（外层 chrome 归插件页） ===')
  const { harness, component } = mountItemCard()
  const tree = harness.mount(component, { view: 'page', form: makeForm() })
  assert(tree.type === 'div' && tree.props.className === 'dshcf-settings-body', 'page 返回表单主体 div')
  assert(byClass(tree, 'dshcf-settings-save').length === 1, 'page 含保存按钮')
  assert(findAll(tree, n => n.type === 'li').length === 0, 'page 无自带 li 外壳')
}

{
  console.log('\n=== C4：page 视图的就绪门禁（form 缺失给文案而非空白页） ===')
  const { harness, component } = mountItemCard()
  const missing = harness.mount(component, { view: 'page' })
  assert(missing !== null && textOf(missing).includes('未提供'), 'form 缺失 → 渲染不可用文案')
  const loading = makeForm({ state: { status: 'loading', value: undefined, base: undefined, user: undefined, writable: false } })
  assert(harness.mount(component, { view: 'page', form: loading }) === null, 'state 未就绪（form 存在，瞬时）→ null')
}

{
  console.log('\n=== C5：旧契约渲染自带 disclosure 卡片（默认收起） ===')
  const { harness, component } = mountLegacyCard()
  const tree = harness.mount(component, { scope: makeScope() })
  assert(tree.type === 'li' && String(tree.props.className).includes('dshcf-settings-card'), '旧契约返回 li 卡片')
  assert(byClass(tree, 'dshcf-settings-header').length === 1, '含标题按钮')
  assert(byClass(tree, 'dshcf-settings-body').length === 0, '默认收起（不渲染主体）')
  const header = byClass(tree, 'dshcf-settings-header')[0]
  header.props.onClick()
  assert(byClass(harness.tree, 'dshcf-settings-body').length === 1, '点击标题后展开主体')
}

{
  console.log('\n=== C6：page 视图保存走一次原子 mutate，只提交改动字段 ===')
  const { harness, component } = mountItemCard()
  const form = makeForm()
  harness.mount(component, { view: 'page', form })
  const input = findAll(harness.tree, n => n.type === 'input' && n.props?.id === 'dshcf-status-text')[0]
  assert(input !== undefined, '找到状态提示词输入框')
  input.props.onChange({ target: { value: 'Deep resting...' } })
  const saveButton = byClass(harness.tree, 'dshcf-settings-save')[0]
  assert(saveButton.props.disabled === false, '改动后保存按钮可用')
  await saveButton.props.onClick()
  assert(form.calls.length === 1, '保存触发一次 mutate', 'calls=' + form.calls.length)
  assert(form.calls[0].rev === 3, 'mutate 收到 revision 栅栏')
  assert(form.calls[0].ops.length === 1, '只提交改动的字段', 'ops=' + form.calls[0].ops.length)
  assert(form.calls[0].ops[0].path[0] === 'statusText' && form.calls[0].ops[0].value === 'Deep resting...', '提交值与输入一致')
  assert(byClass(harness.tree, 'dshcf-settings-save')[0].props.disabled === true, '提交后回到无改动（按钮禁用）')
}

{
  console.log('\n=== C7：宿主拒绝时保留用户输入并显示失败提示 ===')
  const { harness, component } = mountItemCard()
  const form = makeForm({ mutate: async () => false })
  harness.mount(component, { view: 'page', form })
  findAll(harness.tree, n => n.type === 'input' && n.props?.id === 'dshcf-status-text')[0]
    .props.onChange({ target: { value: 'Z' } })
  await byClass(harness.tree, 'dshcf-settings-save')[0].props.onClick()
  assert(byClass(harness.tree, 'dshcf-settings-failed').length === 1, '显示「未接受」失败提示')
  const after = findAll(harness.tree, n => n.type === 'input' && n.props?.id === 'dshcf-status-text')[0]
  assert(after.props.value === 'Z', '用户输入被保留供重试', 'value=' + after.props.value)
  assert(byClass(harness.tree, 'dshcf-settings-save')[0].props.disabled === false, '仍可再次保存')
}

{
  console.log('\n=== C8：旧契约保存逐字段写入 scope ===')
  const { harness, component, scope } = mountLegacyCard()
  harness.mount(component, { scope })
  byClass(harness.tree, 'dshcf-settings-header')[0].props.onClick()
  findAll(harness.tree, n => n.type === 'input' && n.props?.id === 'dshcf-status-text')[0]
    .props.onChange({ target: { value: 'Legacy' } })
  await byClass(harness.tree, 'dshcf-settings-save')[0].props.onClick()
  assert(scope.calls.length === 1, '一次写入', 'calls=' + scope.calls.length)
  assert(scope.calls[0][0] === 'set' && scope.calls[0][1] === 'statusText' && scope.calls[0][2] === 'Legacy', '旧契约走 scope.set')
}

{
  console.log('\n=== C9：未声明的 slot 不被派发（真实 slots 语义） ===')
  const { m } = boot()
  const slots = makeSlots(['plugins.item'])
  const dispose = m.setupSettingsCard({ slots }, makeScope())
  assert(slots.entries.length === 1 && slots.entries[0].options.name === 'plugins.item', '只注册被声明的 slot')
  assert(slots.injected.includes('settings.plugin.item'), '旧 slot 仍尝试注册（回调未派发）')
  dispose()
}

{
  console.log('\n=== C10：有 whileServed 时按命名空间是否被服务门禁 ===')
  const { m } = boot()
  const slots = makeSlots()
  const gates = []
  const configForms = {
    get: () => makeScope(),
    whileServed(namespaces, register) {
      const gate = { namespaces, register, disposed: false }
      gates.push(gate)
      return () => { gate.disposed = true }
    },
  }
  const dispose = m.setupSettingsCard({ slots, configForms }, makeScope())
  assert(gates.length === 1, '用 whileServed 包了一层')
  assert(gates[0].namespaces[0] === 'dsh-auto-collapse', '门禁命名空间正确')
  assert(!slots.entries.some(e => e.options.name === 'plugins.item'), '宿主未服务该命名空间时 plugins.item 卡片不出现（而非空白卡片）')
  assert(slots.entries.some(e => e.options.name === 'settings.plugin.item'), '旧 slot 不受该门禁影响（当前版本不派发即可）')
  gates[0].register(new Set(['dsh-auto-collapse']))
  assert(slots.entries.some(e => e.options.name === 'plugins.item'), '宿主服务后卡片被注册')
  dispose()
}

{
  console.log('\n=== C11：slots.inject / register 抛错被兜住 ===')
  const { m } = boot()
  const errors = []
  const originalError = console.error
  console.error = (...args) => { errors.push(args[0]) }
  let threw = false
  try {
    m.setupSettingsCard({
      slots: { inject() { throw new Error('inject-boom') }, register() { throw new Error('register-boom') } },
    }, makeScope())
  } catch { threw = true } finally { console.error = originalError }
  assert(!threw, 'slot 注册抛错不向外传播')
  assert(errors.length >= 1, '抛错被记录', 'errors=' + errors.length)
}

{
  console.log('\n=== S3：旧契约只读时不谎报保存成功 ===')
  const { m } = boot()
  const scope = makeScope({ getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, writable: false }) })
  const source = m.cardSourceFromScope(scope)
  const ok = await source.commit([{ op: 'set', field: 'statusText', value: 'X' }])
  assert(ok === false, '只读 scope 的 commit 返回 false')
  assert(scope.calls.length === 0, '只读时不发起写入')
}

{
  console.log('\n=== R6：形状不符的候选不被绑定（避免 subscribe 抛错打挂 entry） ===')
  const { m } = boot()
  const late = m.createLateScope()
  const errors = []
  const originalError = console.error
  console.error = (...args) => { errors.push(args[0]) }
  let threw = false
  try {
    m.resolveSettingsScope({ effect: () => {}, configForms: { get: () => ({ nope: true }) } }, late)
  } catch { threw = true } finally { console.error = originalError }
  assert(!threw, '形状不符不抛错')
  assert(late.scope.getSnapshot().status === 'unavailable', '形状不符时保持占位（未绑定）')
  assert(errors.length >= 1, '形状不符被记录')
  assert(m.isScopeLike(makeScope()) === true, 'isScopeLike 接受合法 scope')
  assert(m.isScopeLike({}) === false, 'isScopeLike 拒绝空对象')
  assert(m.isScopeLike(null) === false, 'isScopeLike 拒绝 null')
}

{
  console.log('\n=== R7：低优先级服务不得覆盖高优先级真值 ===')
  const { m } = boot()
  const late = m.createLateScope()
  const snap = (label) => () => ({ status: 'ready', value: { statusText: label }, base: {}, user: {}, writable: true })
  late.resolve(makeScope({ getSnapshot: snap('CF') }), m.SCOPE_PRIORITY.configForms)
  late.resolve(makeScope({ getSnapshot: snap('SS') }), m.SCOPE_PRIORITY.settingsScope)
  assert(late.scope.getSnapshot().value.statusText === 'CF', '低优先级 settingsScope 未覆盖 configForms')
  late.resolve(makeScope({ getSnapshot: snap('CF2') }), m.SCOPE_PRIORITY.configForms)
  assert(late.scope.getSnapshot().value.statusText === 'CF2', '同优先级允许换绑')
}

{
  console.log('\n=== R8：dispose 释放内层订阅、拒绝后续装配与订阅 ===')
  const { m } = boot()
  const late = m.createLateScope()
  let innerOff = 0
  const inner = makeScope({ subscribe: () => () => { innerOff += 1 } })
  let notified = 0
  late.scope.subscribe(() => { notified += 1 })
  late.resolve(inner, m.SCOPE_PRIORITY.configForms)
  assert(notified === 1, '绑定时通知一次')
  late.dispose()
  assert(innerOff === 1, 'dispose 释放了内层订阅')
  assert(late.scope.getSnapshot().status === 'unavailable', 'dispose 后回到占位')
  late.resolve(inner, m.SCOPE_PRIORITY.configForms)
  assert(late.scope.getSnapshot().status === 'unavailable', 'dispose 后 resolve 不再生效')
  late.scope.subscribe(() => { notified += 1 })
  assert(notified === 1, 'dispose 后新订阅不被接受')
}

{
  console.log('\n=== R9：resolve(undefined) 清除内层并回退占位 ===')
  const { m } = boot()
  const late = m.createLateScope()
  const inner = makeScope()
  late.resolve(inner, m.SCOPE_PRIORITY.configForms)
  assert(late.scope.getSnapshot().status === 'ready', '先绑定成功')
  late.resolve(undefined, m.SCOPE_PRIORITY.configForms)
  assert(late.scope.getSnapshot().status === 'unavailable', '清除后回退占位')
  late.resolve(inner, m.SCOPE_PRIORITY.configForms)
  late.resolve(undefined, m.SCOPE_PRIORITY.settingsScope)
  assert(late.scope.getSnapshot().status === 'ready', '低优先级不能清掉高优先级真值')
}

{
  console.log('\n=== R10：换绑不同内层时释放旧订阅 ===')
  const { m } = boot()
  const late = m.createLateScope()
  let offA = 0
  let offB = 0
  const a = makeScope({ subscribe: () => () => { offA += 1 } })
  const b = makeScope({ subscribe: () => () => { offB += 1 } })
  late.resolve(a, m.SCOPE_PRIORITY.configForms)
  late.resolve(b, m.SCOPE_PRIORITY.configForms)
  assert(offA === 1, '换绑时释放旧内层订阅')
  assert(offB === 0, '新内层订阅保持')
}

{
  console.log('\n=== R11：两个服务回调都触发时高优先级胜出 ===')
  const { m } = boot()
  const late = m.createLateScope()
  const callbacks = []
  const ctx = { effect: () => {}, inject: (deps, cb) => { callbacks.push([deps[0], cb]); return () => {} } }
  m.resolveSettingsScope(ctx, late)
  const snap = (label) => () => ({ status: 'ready', value: { statusText: label }, base: {}, user: {}, writable: true })
  callbacks.find(([n]) => n === 'settingsScope')[1]({ settingsScope: { bind: () => makeScope({ getSnapshot: snap('SS') }) } })
  callbacks.find(([n]) => n === 'configForms')[1]({ configForms: { get: () => makeScope({ getSnapshot: snap('CF') }) } })
  assert(late.scope.getSnapshot().value.statusText === 'CF', '后到的 configForms 覆盖 settingsScope')
  callbacks.find(([n]) => n === 'settingsScope')[1]({ settingsScope: { bind: () => makeScope({ getSnapshot: snap('SS') }) } })
  assert(late.scope.getSnapshot().value.statusText === 'CF', '低优先级的晚到者不覆盖')
}

{
  console.log('\n=== R12：ctx.inject 抛错被兜住 ===')
  const { m } = boot()
  const late = m.createLateScope()
  const errors = []
  const originalError = console.error
  console.error = (...args) => { errors.push(args[0]) }
  let threw = false
  try {
    m.resolveSettingsScope({ effect: () => {}, inject() { throw new Error('inject-boom') } }, late)
  } catch { threw = true } finally { console.error = originalError }
  assert(!threw, 'ctx.inject 抛错不向外传播')
  assert(errors.length >= 1, '抛错被记录')
}

if (failures > 0) {
  console.error('\nsettings-card: failures=' + failures)
  process.exit(1)
}
console.log('\nsettings-card: failures=0')
