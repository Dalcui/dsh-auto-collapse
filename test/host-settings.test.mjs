/**
 * host-settings.test.mjs —— host half 配置链路单测（此前零覆盖）。
 *
 * 背景（P0 B1）：导出运行期 Config schema 后，cordis 用
 * `Config['~standard'].validate()` 解析 profile patch，**volatile 字段被包成
 * `{ get() }` 引用对象（默认值也一样）**。若 apply 不解引用：
 * - sanitizeConfig 只透传字符串/数字 → roster 探针的 config 恒为 null，
 *   R6 远程（LAN/手机）真值兜底静默失效；
 * - 旧版 installSection / register 分支把带引用的 entry 当 base 交给 schema 校验
 *   → ValidationError，settings 子 fiber FAILED、命名空间永不注册。
 *
 * 本文件用**真实 schemastery** 走 cordis 同款解析路径后喂给 apply，把这两条锁死。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

const mod = await import(pathToFileURL(join(root, 'lib/index.js')).href)
const { Config, apply } = mod
assert(typeof apply === 'function', '宿主产物可被普通 node ESM 直接加载')
assert(Config !== undefined && typeof Config.toJSON === 'function', '导出运行期 Config schema（0.1.7 SettingsForms 的唯一表单来源）')
assert(Config.toJSON !== undefined, 'Config 具备 toJSON（SettingsForms.schema() 的判别条件）')

/** cordis 同款解析路径：Config['~standard'].validate(raw).value */
function resolveConfig(raw) {
  const result = Config['~standard'].validate(raw)
  assert(!result.issues, 'schema 解析无 issue', JSON.stringify(result.issues ?? null))
  return result.value
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers },
    end(payload) { this.body = payload ?? '' },
  }
}

/** 调探针 handler 并取出下发配置。 */
function readConfig(handler) {
  const res = fakeRes()
  handler({ method: 'GET' }, res)
  assert(res.statusCode === 200, '探针返回 200', 'status=' + res.statusCode)
  return JSON.parse(res.body).config
}

/** 组装 apply 需要的根 ctx：settings 子 ctx 与 webServer 子 ctx。 */
function makeCtx({ settings } = {}) {
  const record = { logs: [], effects: [], handler: null }
  const settingsChild = {
    settings,
    logger: { warn: (e) => record.logs.push(e), error: (e) => record.logs.push(e) },
    effect(fn) { record.effects.push(fn()); return () => {} },
  }
  const webChild = {
    get: (name) => (name === 'clientModules' ? { graph: () => ({ entries: [{ id: 'dsh-auto-collapse' }] }) } : undefined),
    logger: { warn: (e) => record.logs.push(e) },
    webServer: {
      register({ handler }) { record.handler = handler; return () => { record.handler = null } },
    },
  }
  const ctx = {
    fiber: { state: 2 },
    inject(deps, cb) {
      if (deps.includes('settings') && settings !== undefined) return cb(settingsChild)
      if (deps.includes('webServer')) return cb(webChild)
      return () => {}
    },
  }
  return { ctx, record }
}

/** SettingsForms（0.1.7+）mock：有 describe/configure，无 installSection/register。 */
function makeSettingsForms(valuesByNs) {
  const record = { configure: [], describeCalls: 0 }
  return {
    record,
    describe() {
      record.describeCalls += 1
      return Object.entries(valuesByNs).map(([ns, value]) => ({ ns, value }))
    },
    configure(presentation, owner) {
      record.configure.push({ presentation, owner })
      return () => {}
    },
  }
}

// ── 前提事实：volatile 字段被解析成引用对象 ────────────────────────────────
{
  console.log('\n=== H0：schemastery 把 volatile 字段解析成 { get() } 引用对象（B1 的前提） ===')
  const raw = resolveConfig({ statusText: 'Deep resting...', keepLastRows: 5 })
  // 版本门禁：volatile 包装是 schemastery 3.18.4 才有的能力。仓库 devDependency
  // 与 DSH 运行时都已固定 3.18.4（package-lock 亦为 3.18.4），但若某台机器上
  // node_modules 陈旧（实测过：lock 3.18.4 / 实装 3.18.1），本文件不应因此变红——
  // 该断言描述的是**宿主能力**，不是本插件的行为。能力缺失时跳过，其余用例照跑。
  if (typeof raw.statusText !== 'object' || raw.statusText === null || typeof raw.statusText.get !== 'function') {
    console.log('SKIP  statusText 是引用对象（本机 schemastery 无 volatile 包装，需 3.18.4）')
    console.log('SKIP  引用对象 get() 拿到真值')
    console.log('SKIP  keepLastRows 同样被包裹')
    console.log('SKIP  未配置的默认值也被包裹（关键：不能只处理显式值）')
    console.log('SKIP  默认值解引用正确')
  } else {
    assert(raw.statusText.get() === 'Deep resting...', '引用对象 get() 拿到真值')
    assert(typeof raw.keepLastRows === 'object' && raw.keepLastRows.get() === 5, 'keepLastRows 同样被包裹')
    const defaults = resolveConfig({})
    assert(typeof defaults.statusText === 'object', '未配置的默认值也被包裹（关键：不能只处理显式值）')
    assert(defaults.statusText.get() === 'Deep sleeping...', '默认值解引用正确')
  }
}

// ── B1 回归：apply 必须解引用，否则探针 config 恒 null ─────────────────────
{
  console.log('\n=== H1：volatile 引用被解引用（B1 回归，settings 未就绪时的静态兜底） ===')
  const raw = resolveConfig({ statusText: 'Deep resting...', keepLastRows: 5 })
  const settings = makeSettingsForms({}) // 不服务任何命名空间 → describe 返回空 → 走静态 entry
  const { ctx, record } = makeCtx({ settings })
  apply(ctx, raw)
  const config = readConfig(record.handler)
  assert(config !== null, 'volatile 引用被解引用（config 不为 null）')
  assert(config !== undefined && config.statusText === 'Deep resting...', 'statusText 解引用正确')
  assert(config.keepLastRows === 5, 'keepLastRows 解引用正确')
}

{
  console.log('\n=== H2：全默认值同样被解引用 ===')
  const raw = resolveConfig({})
  const settings = makeSettingsForms({})
  const { ctx, record } = makeCtx({ settings })
  apply(ctx, raw)
  const config = readConfig(record.handler)
  assert(config !== null, '空 patch 也解引用出普通值')
  assert(config.statusText === 'Deep sleeping...', '默认 statusText 正确')
  assert(config.keepLastRows === 3, '默认 keepLastRows 正确')
  assert(config.codeDescription === 'always', '默认 codeDescription 正确')
}

// ── 旧版分支：entry 必须是普通值，否则 schema 校验抛错 ─────────────────────
{
  console.log('\n=== H3：installSection 分支收到普通值 entry（0.1.2~0.1.6 不再抛 ValidationError） ===')
  const raw = resolveConfig({ statusText: 'X' })
  const captured = { installSection: null }
  const settings = {
    installSection(owner, ns, schema, entry, hooks) { captured.installSection = { owner, ns, schema, entry, hooks } },
  }
  const { ctx } = makeCtx({ settings })
  apply(ctx, raw)
  assert(captured.installSection !== null, '走 installSection')
  const entry = captured.installSection.entry
  assert(typeof entry.statusText === 'string', 'entry.statusText 是普通字符串（非 { get() } 引用）', typeof entry.statusText)
  assert(typeof entry.keepLastRows === 'number', 'entry.keepLastRows 是普通数字', typeof entry.keepLastRows)
  // 旧版 register 会把 base 交回 schema 校验——带引用时这里会抛
  const validated = Config['~standard'].validate(entry)
  assert(!validated.issues, 'entry 可被 Config schema 校验（旧版 register 不再抛）', JSON.stringify(validated.issues ?? null))
  assert(captured.installSection.ns === 'dsh-auto-collapse', '命名空间正确')
  assert(captured.installSection.schema === Config, '传入的 schema 是导出的 Config')
}

{
  console.log('\n=== H4：register 分支的 base 不含 volatile 引用 ===')
  const raw = resolveConfig({ statusText: 'Y' })
  const captured = { register: null, watch: 0 }
  const settings = {
    register(ns, schema, options) {
      captured.register = { ns, schema, options }
      return { get: () => options.base, watch: () => { captured.watch += 1 } }
    },
  }
  const { ctx } = makeCtx({ settings })
  apply(ctx, raw)
  assert(captured.register !== null, '走 register')
  assert(captured.register.options.base.statusText === 'Y', 'base.statusText 是普通值')
  const validated = Config['~standard'].validate(captured.register.options.base)
  assert(!validated.issues, 'base 可被 schema 校验', JSON.stringify(validated.issues ?? null))
  assert(captured.watch === 1, '接上 scope.watch')
}

// ── SettingsForms（0.1.7+）分支 ───────────────────────────────────────────
{
  console.log('\n=== H5：describe() 运行期真值优先于静态 config ===')
  const raw = resolveConfig({})
  const settings = makeSettingsForms({ 'dsh-auto-collapse': { statusText: 'FROM-DESCRIBE', keepLastRows: 9 } })
  const { ctx, record } = makeCtx({ settings })
  apply(ctx, raw)
  assert(settings.record.configure.length === 1, 'configure 被调用一次')
  assert(settings.record.configure[0].presentation.auto === false, 'auto:false（本插件自带配置卡片）')
  assert(settings.record.configure[0].owner === ctx.fiber, 'configure 的 owner 是本插件 fiber')
  const config = readConfig(record.handler)
  assert(config.statusText === 'FROM-DESCRIBE', 'roster config 取自 describe 运行期真值')
  assert(config.keepLastRows === 9, 'describe 数字字段透传')
}

{
  console.log('\n=== H6：describe 未列出本命名空间时回退静态 config ===')
  const raw = resolveConfig({ statusText: 'STATIC2' })
  const settings = makeSettingsForms({ 'other-plugin': { statusText: 'X' } })
  const { ctx, record } = makeCtx({ settings })
  apply(ctx, raw)
  assert(readConfig(record.handler).statusText === 'STATIC2', '回退静态 config')
}

{
  console.log('\n=== H7：describe 抛错只丢 config、探针仍 200 ===')
  const raw = resolveConfig({ statusText: 'STATIC' })
  const settings = {
    describe() { throw new Error('describe-boom') },
    configure() { return () => {} },
  }
  const { ctx, record } = makeCtx({ settings })
  apply(ctx, raw)
  const config = readConfig(record.handler)
  assert(config.statusText === 'STATIC', 'describe 抛错回退静态 config')
}

{
  console.log('\n=== H8：describe 返回畸形值时安全回退 ===')
  const raw = resolveConfig({ statusText: 'STATIC3' })
  const settings = { describe: () => 'not-an-array', configure: () => () => {} }
  const { ctx, record } = makeCtx({ settings })
  apply(ctx, raw)
  assert(readConfig(record.handler).statusText === 'STATIC3', 'describe 返回非数组时回退静态 config')
}

{
  console.log('\n=== H9：configure 抛错被兜住（降级为日志，不拖垮 entry） ===')
  const raw = resolveConfig({})
  const settings = {
    describe() { return [] },
    configure() { throw new Error('already-registered') },
  }
  const { ctx, record } = makeCtx({ settings })
  let threw = false
  try { apply(ctx, raw) } catch { threw = true }
  assert(!threw, 'configure 抛错不向外传播')
  assert(record.logs.length >= 1, 'configure 抛错被记录', 'logs=' + record.logs.length)
  assert(readConfig(record.handler) !== null, 'configure 抛错后探针仍能下发静态 config')
}

if (failures > 0) {
  console.error('\nhost-settings: failures=' + failures)
  process.exit(1)
}
console.log('\nhost-settings: failures=0')
