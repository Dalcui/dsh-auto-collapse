/**
 * dsh-auto-collapse — node half.
 */
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-auto-collapse'
export const inject: string[] = []

// M6：默认值与 client 侧权威源 src/locales.ts（DEFAULT_SUMMARY_FIELDS_STRING /
// DEFAULT_CODE_DESCRIPTION / DEFAULT_KEEP_LAST_ROWS / DEFAULT_KEEP_LAST_BODY_STEPS）
// 及 src/settings.ts（DEFAULT_STATUS_TEXT）逐字镜像。host 产物是单文件
// lib/index.js，不能跨文件 import；改默认值必须两侧同步（README 模块地图已标注）。
const DEFAULT_STATUS_TEXT = 'Deep sleeping...'
const DEFAULT_SUMMARY_FIELDS = 'duration,modelCalls(次模型),toolCalls(次工具),inputTokens(输入),cacheReadTokens(命中),cacheHitRate(命中率),outputTokens(输出),contextDelta(上下文)'
const DEFAULT_CODE_DESCRIPTION = 'always'
const DEFAULT_KEEP_LAST_ROWS = 3
const DEFAULT_KEEP_LAST_BODY_STEPS = 1
const AUTO_COLLAPSE_SETTINGS_NAMESPACE = 'dsh-auto-collapse'

/**
 * schemastery 的 `.volatile()` 是 3.18.2 才引入的（DSH 0.1.7-rc.2 实际带的是
 * 3.18.2 / 3.18.4）。更早的 schemastery（如 3.18.1）没有该方法，而旧版 DSH
 * 走 installSection 显式注册命名空间、完全不看 volatile 标记，因此这里按能力
 * 降级为恒等：同一份产物在新旧 DSH 上都能加载，只有新版才拿得到「浏览器可写」
 * 的表单投影。
 *
 * 注意 volatile 不只是「进入表单投影」的开关，它还**改变解析后的值形状**——
 * 见下面 deref 的说明。
 */
function markVolatile<T>(schema: T): T {
  const candidate = schema as unknown as { volatile?: () => T; extra?: (key: string, value: unknown) => T }
  if (typeof candidate.volatile === 'function') return candidate.volatile()
  // 0.1.7-rc.2 的宿主 DSH 自带 schemastery 3.18.4（有 `.volatile()`），但
  // **插件自己被解析到的 schemastery 是 profile 里的 3.18.1**——插件不带
  // node_modules，Node 从安装目录逐级向上找，命中的是 profiles/web/node_modules
  // 下的那一份。3.18.1 **没有** `.volatile()`，旧实现于是静默退化为恒等：
  // schema 上没有任何 volatile 标记 → 宿主 SettingsForms.describe() 的
  // volatileForm() 返回 undefined → 该 entry **整个不进 describe 镜像** →
  // 「插件」面板里本插件的配置页恒显示「当前部署未提供该插件的可写配置。」。
  // 真机实测（2026-09-29）：部署态 Config.toJSON() 的 5 个字段 meta.volatile
  // 全为 false，正是本分支静默失效。
  //
  // 兜底：`.extra('volatile', true)` 是 3.18.1 就有的通用元数据写入，
  // 与 `.volatile()` 的唯一差别是少了「重复标记抛错」这一层保护——对本插件
  // （每个字段各标一次）无影响。标记最终落在 meta.volatile，宿主读得到。
  if (typeof candidate.extra === 'function') return candidate.extra('volatile', true)
  return schema
}

/**
 * 运行期配置 schema。
 *
 * 0.1.7 起设置表单的唯一来源是 `entry.fiber.runtime.Config`（见 dsh-settings
 * SettingsForms.schema()），且只有带 volatile 标记的字段会进入表单投影
 * （volatileForm()）。旧版导出的纯 interface 在运行期被 esbuild 整体擦除，
 * 新版据此拿不到任何表单——所以这里必须导出真实 schema。
 * 配置值类型见 AutoCollapseConfig（等价于本 schema 的推导结果）。
 */
export const Config = z.object({
  statusText: markVolatile(z.string().default(DEFAULT_STATUS_TEXT)),
  summaryFields: markVolatile(z.string().default(DEFAULT_SUMMARY_FIELDS)),
  codeDescription: markVolatile(z.string().default(DEFAULT_CODE_DESCRIPTION)),
  keepLastRows: markVolatile(z.natural().default(DEFAULT_KEEP_LAST_ROWS)),
  keepLastBodySteps: markVolatile(z.natural().default(DEFAULT_KEEP_LAST_BODY_STEPS)),
})

// ★ 让宿主 resolveConfig 产出 volatile 引用（见 withVolatileValidate 注释：
//   这是「保存后无需重启即生效」的最后一环；光有 meta.volatile 标记不够，
//   因为 fiber.config 与 candidate 两条解析路径都必须真的产出 ref 对象）。
const VOLATILE_FIELDS = ['statusText', 'summaryFields', 'codeDescription', 'keepLastRows', 'keepLastBodySteps'] as const
withVolatileValidate(Config, VOLATILE_FIELDS)

/** schemastery volatile 字段在运行期的引用形态（createVolatile 产物）。 */
export interface VolatileRef<T> {
  get(): T
}

/**
 * apply 实际收到的 config 形态。
 *
 * 导出运行期 Config schema 后，cordis 用 `Config['~standard'].validate()` 解析
 * profile patch，volatile 字段会被包成 `{ get() }` 引用对象（**默认值也一样被
 * 包裹**）——官方插件都逐字段 `.get()`（如 dsh-web-search-deepseek 的
 * `config.apiKey.get()`）。本插件 5 个字段全部 volatile，因此这里按
 * 「普通值或引用对象」声明，并在 apply 开头统一解引用。
 */
export interface RawAutoCollapseConfig {
  statusText?: string | VolatileRef<string>
  summaryFields?: string | VolatileRef<string>
  codeDescription?: string | VolatileRef<string>
  keepLastRows?: number | VolatileRef<number>
  keepLastBodySteps?: number | VolatileRef<number>
}

/** 解引用后的普通配置值（内部与 d.ts 消费）。 */
export interface AutoCollapseConfig {
  statusText?: string
  summaryFields?: string
  codeDescription?: string
  keepLastRows?: number
  keepLastBodySteps?: number
}

/**
 * 解引用一个 volatile 字段值（非引用对象原样返回）。
 *
 * 不解引用会直接坏两件事：
 * 1. 旧版 installSection / register 分支把 entry 当 base 交给 schema 校验 →
 *    `ValidationError: $.statusText expected string but got [object Object]`，
 *    settings 子 fiber FAILED、命名空间永不注册（旧设置页空白、折叠静默用默认值）；
 *    0.1.5 的 describe() 还会 structuredClone(base) → DataCloneError。
 * 2. sanitizeConfig 只透传字符串/数字 → 带引用的 config 被整段丢弃，
 *    R6 远程（LAN/手机）真值兜底静默失效。
 */
function deref<T>(value: T | VolatileRef<T> | undefined): T | undefined {
  if (value !== null && typeof value === 'object' && typeof (value as VolatileRef<T>).get === 'function') {
    try {
      return (value as VolatileRef<T>).get()
    } catch {
      return undefined
    }
  }
  return value as T | undefined
}

/**
 * 探针路由：返回当前客户端模块图（roster）的“是否变化”签名与本插件配置。
 *
 * 浏览器侧看门狗轮询该路由，把页面实际加载的插件集合与运行中的 Loader
 * 树实时对比；集合变化（任意客户端插件启停）时自动重载页面。本插件被
 * 禁用时 node half 随 Loader 卸载，路由随之消失（404）——这本身就是
 * “被禁用”的信号，旧页面据此重载，折叠效果即刻消失，无需重启服务。
 *
 * 注意：重新启用本插件后，已经刷新过（不再装载本 bundle）的旧页面没有
 * 任何代码在轮询，无法自动恢复——需要手动刷新一次；页面仍持有旧 bundle
 * 时（禁用后尚未到下一次轮询）则会被 404 恢复信号自动重载。
 *
 * 响应刻意不返回完整插件 id 清单：只返回 id 集合的签名与“自身是否在列”，
 * 既满足看门狗“是否变化”的判定需求，也避免在 LAN 可达（webserver 绑
 * 0.0.0.0）时无鉴权枚举出部署的全部客户端插件。
 *
 * 响应附加 config 字段（R6）：DSH 官方对非回环页面（手机经 LAN/Tailscale
 * 打开）强制 settings 走浏览器内存模式——浏览器端 settingsScope 恒为
 * unavailable，折叠参数全部退化默认值。本字段把宿主端 settings.yaml 真值
 * （经 settings 服务的 scope.get()）只读下发，远程页面据此恢复折叠行为。
 * - 刻意不并入 sig：配置变化不应触发整页重载，客户端每次轮询都会带新值
 *   走轻量 refresh（避免桌面端保存配置引发所有页面的重载风暴）。
 * - 只含本插件 5 个非敏感 UI 字段（不含任何凭据），LAN 暴露面与既有
 *   roster 探针相同。
 */
// M8：与 client 侧 src/roster-constants.ts 逐字镜像（host 产物是单文件
// lib/index.js，不能跨文件 import）。一侧漂移会导致看门狗误判反复重载或
// 404 误判自身被禁用；一致性由 host-roster / roster-watch 单测相同样例锁定。
/** 导出供 host-roster 单测锁定与 client 侧镜像的一致性（不导出则路由
 * 常量只靠注释纪律防漂移）。 */
export const ROSTER_ROUTE = '/dsh-auto-collapse/roster'
const OWN_CLIENT_ID = 'dsh-auto-collapse'

/** 与浏览器侧 rosterSignature（src/roster-constants.ts）同算法的 id 集合签名。 */
export function rosterSignatureOf(ids: readonly string[]): string {
  return [...new Set(ids.map(String))].sort().join('\u0000')
}

/**
 * 归一化配置真值：只透传 5 个已知字段的 JSON 安全值（与 client 侧
 * sanitizeRemoteConfig 同口径），其余字段一律丢弃；数字取非负整。
 * 返回 null 表示没有可下发的配置（未接入 / 取值异常）。
 */
function sanitizeConfig(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (typeof raw.statusText === 'string') out.statusText = raw.statusText
  if (typeof raw.summaryFields === 'string') out.summaryFields = raw.summaryFields
  if (typeof raw.codeDescription === 'string') out.codeDescription = raw.codeDescription
  if (typeof raw.keepLastRows === 'number' && Number.isFinite(raw.keepLastRows)) out.keepLastRows = Math.max(0, Math.floor(raw.keepLastRows))
  if (typeof raw.keepLastBodySteps === 'number' && Number.isFinite(raw.keepLastBodySteps)) out.keepLastBodySteps = Math.max(0, Math.floor(raw.keepLastBodySteps))
  return Object.keys(out).length > 0 ? out : null
}

/** 构造探针 handler（从 clientModules 服务读图；可选 getConfig 下发配置真值）。
 * 独立导出便于单测。getConfig 取值为可选增强：异常只丢 config 不丢主响应。 */
export function createRosterHandler(
  getModules: () => { graph?: () => { entries?: Array<{ id?: unknown }> } },
  logger?: (error: unknown) => void,
  getConfig?: () => unknown,
) {
  return (req: any, res: any): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    try {
      const entries = getModules()?.graph?.()?.entries ?? []
      const ids: string[] = []
      for (const entry of entries) {
        if (typeof entry.id === 'string' && entry.id !== '') ids.push(entry.id)
      }
      let config: Record<string, unknown> | null = null
      if (getConfig !== undefined) {
        try {
          config = sanitizeConfig(getConfig())
        } catch (error) {
          logger?.(error)
          config = null
        }
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      // HEAD 请求 Node 会按 HTTP 语义自动抑制响应体（ServerResponse._hasBody）。
      res.end(JSON.stringify({
        sig: rosterSignatureOf(ids),
        own: ids.includes(OWN_CLIENT_ID),
        config,
      }))
    } catch (error) {
      logger?.(error)
      // 不向客户端回显内部错误细节（LAN 可达时避免泄露）。
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('internal error')
    }
  }
}

function installRosterRoute(ctx: any, getConfig: () => unknown): void {
  // 可选注入：不把 webServer 写进 inject 列表，部署里没有该服务时
  // 本插件其余功能（设置卡片）不受影响，只少一个探针。
  ctx.inject(['webServer'], (webCtx: any) => {
    const handler = createRosterHandler(
      () => webCtx.get('clientModules'),
      (error) => webCtx.logger?.warn?.(error),
      getConfig,
    )
    const dispose = webCtx.webServer.register({ kind: 'exact', path: ROSTER_ROUTE, handler })
    return () => {
      dispose()
    }
  })
}

/**
 * 跨版本安装 settings 命名空间。
 *
 * 三代契约，运行时按能力选择（不静态 import 任何可能被移除的具名导出）：
 * - 0.1.7+（SettingsForms）：命名空间与表单由 Loader 从插件导出的 Config
 *   schema 自动派生（SettingsForms.schema() 读 entry.fiber.runtime.Config，
 *   只有 volatile 字段进表单投影）；服务上既没有 installSection 也没有
 *   register。这里关掉自动生成页（本插件自带 plugins.item 配置卡片），并
 *   改为每请求从 describe() 读本命名空间真值。
 * - 0.1.2-alpha.3 ~ 0.1.6：settings.installSection(owner, ns, schema, entry, hooks)。
 * - 0.1.1-rc.x：settings.register(ns, schema, { base, validate }) + 手动接线，
 *   复刻旧版 installSettingsSection 的语义。
 */
/** 与旧版 dsh-settings 一致的卸载中判定（FiberState 常量镜像，运行时无 import）。 */
const FIBER_DISPOSED = 4
const FIBER_UNLOADING = 5
function isUnloading(context: any): boolean {
  const state = context?.fiber?.state
  return state === FIBER_UNLOADING || state === FIBER_DISPOSED
}

/**
 * 从 SettingsForms.describe() 读本命名空间的运行期真值。
 *
 * describe() 返回的 value 已按 volatile 表单投影，只含本插件的 5 个字段；
 * 找不到条目（未激活 / 被禁用）时返回 null，由调用方回退静态 config。
 * describe() 抛错只丢 config，不丢探针主响应。
 */
function readOwnSettings(settings: any, ns: string): Record<string, unknown> | null {
  try {
    const descriptors = settings.describe()
    if (!Array.isArray(descriptors)) return null
    for (const descriptor of descriptors) {
      if (descriptor === null || typeof descriptor !== 'object') continue
      if (descriptor.ns !== ns) continue
      const value = descriptor.value
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
    }
  } catch {
    /* 读取失败回退静态 config */
  }
  return null
}

function installSettingsSection(
  ctx: any,
  ns: string,
  schema: any,
  entry: AutoCollapseConfig,
  hooks: { setSource: (source: () => any) => void; onChange: () => void; validate?: (value: any) => void },
  /** 【2026-09-29】现读快照：describe 不可用/未激活时的兜底也必须是**最新值**，
   * 而不是注册期的静态 entry——否则 volatile 热更新期间会回退到旧值。 */
  liveEntry: () => AutoCollapseConfig = () => entry,
): void {
  ctx.inject(['settings'], (settingsCtx: any) => {
    const settings = settingsCtx.settings
    // 0.1.7+（SettingsForms）：以 installSection 缺席 + describe/configure 存在判别。
    if (
      typeof settings.installSection !== 'function'
      && typeof settings.describe === 'function'
      && typeof settings.configure === 'function'
    ) {
      settingsCtx.effect(() => {
        try {
          // auto:false —— 配置页由本插件自带的 plugins.item 卡片承载，
          // 不需要 Loader 再自动生成一个同字段的页面。
          return settings.configure({ auto: false }, ctx.fiber)
        } catch (error) {
          settingsCtx.logger?.warn?.(error)
          return () => {}
        }
      })
      hooks.setSource(() => readOwnSettings(settings, ns) ?? liveEntry())
      hooks.onChange()
      return
    }
    if (typeof settings.installSection === 'function') {
      // 0.1.2-alpha.3 ~ 0.1.6：installSection(owner, ns, schema, entry, hooks)
      settings.installSection(ctx, ns, schema, entry, hooks)
      return
    }
    // 旧 API 兜底：等价于 0.1.1-rc.x 的 installSettingsSection(ctx, ns, schema, entry, hooks)
    const scope = settings.register(ns, schema, {
      base: entry,
      ...(hooks.validate === undefined ? {} : { validate: hooks.validate }),
    })
    hooks.setSource(() => scope.get())
    settingsCtx.effect(() => () => {
      if (isUnloading(ctx)) return
      hooks.setSource(() => liveEntry())
      hooks.onChange()
    })
    hooks.onChange()
    scope.watch(() => {
      if (isUnloading(ctx)) return
      hooks.onChange()
    })
  })
}

/**
 * 自己实现 volatile 引用协议（**不依赖 schemastery / cosmokit 的版本能力**）。
 *
 * ## 为什么必须自己造 ref（真机根因，2026-09-29）
 * volatile 热更新的完整链路有三环，而**只有第三环在真机上断了**：
 * ```
 * ① 宿主 cordis-plugin-loader:380 判 volatileOnly
 *      = equalExceptVolatile(raw旧, raw新, fiber.runtime.Config)
 *      → 只认 schema 的 meta.volatile 标记（本插件已带，P1 已修）→ 成立
 * ② :382 `volatileOnly && this._commitVolatile()` → 走热更新，**不重挂插件**
 * ③ _commitVolatile():395 `volatileEntries(fiber.config)` 收集 ref →
 *      :413 updateVolatile(ref, source) → :420 emit('loader/volatile-update')
 * ```
 * **断点在③**：`fiber.config` 里各字段是否是 ref，取决于**插件自己被解析到的
 * schemastery** 在 validate 时有没有把 volatile 字段包成引用对象。真机实测：
 * ```
 * 宿主 dsh-settings 解析到 schemastery 3.18.4 → 有 volatile 语义 ✅
 * 本插件解析到 profile 的 schemastery 3.18.1 → 无 .volatile()、
 *   且【带 volatile 标记也不生成 ref】（实测 resolved 值就是普通字符串）❌
 * ```
 * → `volatileEntries()` 返回空 → `_commitVolatile()` 在 :396 `if (!refs.length) return true`
 * **静默空转**：既不更新值、也不发事件，同时 :382 的 `pending=[]` 让插件**不重挂**。
 * 结果：磁盘 raw 已更新，内存解析值永远停在旧值 —— 用户看到的就是
 * 「点保存没反应 / 保存不生效」（真机实测：输入框在保存后**回弹成旧值**）。
 *
 * ## 修法：用全局符号自己实现同一协议
 * cosmokit 的 volatile 协议是一个**全局注册符号**：
 * `Symbol.for('cosmokit.volatile.write')`（cosmokit/lib/index.js:83）。
 * 判定函数也只看符号在不在：`isVolatile(v) = typeof v==='object' && v && write in v`（:116-118）。
 * 因此插件**无需依赖插件侧的 cosmokit**（profile 的 1.8.2 连 createVolatile 都没有，
 * 实测其导出里完全没有这三个符号），只要自己造一个具备同样协议的对象，
 * 宿主 3.18.4 侧就会：
 *   - `isVolatile(ref)` → true（符号存在）
 *   - `updateVolatile(ref, source)` → 调用 `ref[write](source.get())` 原地写入（:149-151）
 *   - `describe()` 的 `plainConfig()` → `plainConfig(value.get())` 取到最新值
 * 于是 volatile 热更新真正生效：**保存后无需重启**，describe / roster / 卡片全部拿到新值。
 *
 * 契约要求（对照 cosmokit 实现，逐条满足）：
 * 1. `get()` 返回**冻结快照**（cosmokit 用 snapshot() 递归 Object.freeze，:84-96）；
 * 2. 必须是普通对象（`Object.getPrototypeOf === Object.prototype`）——
 *    `volatileEntries` 的 visit() 对非普通对象直接跳过（:133），类实例会被忽略；
 * 3. 对象本身 `Object.freeze`，使 ref 成为稳定引用（cosmokit :104 同样冻结）；
 * 4. 不暴露除 `get` 与 write 符号以外的可枚举字段（避免被当作普通配置下钻）。
 *
 * @param value - 初始值（经 schema 校验后的数据）。
 * @returns 具备 cosmokit volatile 协议的引用对象。
 */
function createVolatileRef<T>(value: T): { get(): T } {
  const write = Symbol.for('cosmokit.volatile.write')
  let current = freezeSnapshot(value)
  const ref: Record<symbol | string, unknown> = {
    get: () => current,
    [write]: (next: T) => { current = freezeSnapshot(next) },
  }
  return Object.freeze(ref) as unknown as { get(): T }
}

/** 递归冻结快照（对齐 cosmokit 的 snapshot：数组与普通对象逐层冻结）。 */
function freezeSnapshot<T>(value: T, ancestors: Set<unknown> = new Set()): T {
  if (value === null || typeof value !== 'object') return value
  const object = value as unknown as Record<string, unknown> | unknown[]
  if (ancestors.has(object)) return value
  ancestors.add(object)
  try {
    if (Array.isArray(object)) {
      for (const item of object) freezeSnapshot(item, ancestors)
    } else if (Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null) {
      for (const item of Object.values(object)) freezeSnapshot(item, ancestors)
    }
    return Object.freeze(value)
  } finally {
    ancestors.delete(object)
  }
}

/** 判断一个值是否已是 volatile 引用（协议判定，跨副本通用）。 */
function isVolatileRef(value: unknown): boolean {
  const write = Symbol.for('cosmokit.volatile.write')
  return typeof value === 'object' && value !== null && (write as unknown as string) in (value as object)
}

/**
 * 让宿主 `resolveConfig()` 的产物也带 volatile 引用——**这是热更新真正生效的最后一环**。
 *
 * ## 为什么只有这一环还不够（F1 审查发现的另一半）
 * loader 的 `_commitVolatile()`（cordis-plugin-loader:410-415）对每个 ref 执行：
 * ```
 * const source = path.reduce((v,k)=>Reflect.get(v,k), candidate)   // candidate = resolveConfig(新raw)
 * if (deepEqual(ref.get(), source.get(), true)) return []          // ← source.get()
 * updateVolatile(ref, source)                                       // ← source.get()
 * ```
 * `source` 来自 **`resolveConfig(fiber.runtime, raw)`**，而它调的是
 * `Config['~standard'].validate(raw)`（cordis:958-961）。若该 validate 在 3.18.1 上
 * 产出**普通值**，则 `source.get` 是 undefined → **TypeError，且 :410-415 不在 try 内**
 * → `_commitVolatile()` 抛出 → 整个 update 中断，比「静默吞掉」更糟。
 *
 * 因此必须让**两条解析路径**都产出 ref：
 *   - 初始加载：`fiber.config = resolveConfig(runtime, raw)`（cordis:1355/1438）
 *   - 保存时：  `candidate      = resolveConfig(runtime, raw新)`（loader:400）
 * 两者都经过 `Config['~standard'].validate`，所以在这里统一包上 ref 即可同时覆盖。
 *
 * ## 实现方式
 * 在 schema 实例上用 own property **遮蔽**原型上的 `~standard` getter
 * （schemastery 把 `~standard` 定义为 `Schema.prototype` 的 getter，实例属性优先）。
 * 包装后的 validate：先调原实现拿校验结果，再把 volatile 字段包成 `createVolatileRef`。
 * 这样：
 *   - 宿主 cosmokit（1.8.5）的 `isVolatile`（Symbol.for 全局符号）认得我们的 ref；
 *   - `updateVolatile(旧ref, 新ref)` 原地更新旧 ref → `describe()` 的 `plainConfig()`
 *     经 `ref.get()` 读到新值 → **保存即时生效，无需重启**；
 *   - 若宿主本身是有 volatile 语义的 schemastery（如 3.18.4），原实现已产出 ref，
 *     `attachVolatileRefs` 检测到后跳过 → 包装退化为透传，零影响。
 *
 * @param schema - 根 Config schema（z.object）。
 * @param fields - 需要包装成引用的字段名（本插件的 5 个 volatile 字段）。
 */
function withVolatileValidate(schema: object, fields: readonly string[]): void {
  const base = schema as unknown as {
    '~standard'?: { version: number; vendor: string; validate(value: unknown): { issues?: unknown; value?: unknown } }
  }
  const original = base['~standard']
  if (original === undefined || typeof original.validate !== 'function') return
  try {
    Object.defineProperty(schema, '~standard', {
      configurable: true,
      get() {
        return {
          version: original.version,
          vendor: original.vendor,
          validate(value: unknown) {
            const result = original.validate(value)
            if (result === undefined || result.issues !== undefined || result.value === undefined || typeof result.value !== 'object') return result
            return { ...result, value: attachVolatileRefs(result.value as Record<string, unknown>, fields) }
          },
        }
      },
    })
  } catch (error) {
    // schema 被冻结等极端情况：退回「无引用」模式，保存需重启才能生效（与修复前一致）。
    ;(schema as unknown as { [key: string]: unknown }).__dshcfVolatileWrapFailed = String(error)
  }
}

/** 把 volatile 字段包成引用（已是引用则跳过，幂等）。 */
function attachVolatileRefs(value: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out = { ...value }
  for (const field of fields) {
    const current = out[field]
    if (current !== undefined && current !== null && typeof current === 'object' && typeof (current as VolatileRef<unknown>).get === 'function') continue
    out[field] = createVolatileRef(current)
  }
  return out
}
export function apply(ctx: any, config: RawAutoCollapseConfig = {}): void {
  // ★ 【2026-09-29 关键修正】volatile 字段**不能只解引用一次**。
  //
  // 旧实现把每个字段 `deref()` 成**当时的值快照**存进 `cfg`，此后 apply 永不重跑
  // （volatile 热更新按设计不重挂插件）→ 内存里永远是旧值。真机实测症状：
  //   设置卡里改「摘要栏指标」→ 点保存 → 值确实落盘 cordis.patch.yml、
  //   UI 无失败提示，但**输入框回弹成旧值**、roster 探针也返回旧值；
  //   只有重启服务才生效。根因见 createVolatileRef 的注释（3.18.1 不生成 ref）。
  //
  // 现在改为：**保留引用、每次读取时现取**。`volatileRef` 只负责「确保是引用」，
  // 使宿主 `_commitVolatile()` 的 `updateVolatile(ref, …)` 能原地更新到我们的对象上；
  // `snapshot()` 每次调用都 `ref.get()`，因此拿到的一律是最新值。
  //
  // 兼容性：如果宿主是**有 volatile 语义的 schemastery**（如 3.18.4），入参字段
  // 本身就是 ref（`deref` 的原始场景），此时原样沿用该 ref，不重复包装；
  // 若是普通值（3.18.1 真机路径），则用 createVolatileRef 自造一个协议等价物。
  const volatileRef = <T,>(value: T | VolatileRef<T> | undefined): { get(): T | undefined } => {
    if (isVolatileRef(value)) return value as { get(): T | undefined }
    return createVolatileRef(value as T | undefined) as { get(): T | undefined }
  }
  const refs = {
    statusText: volatileRef<string>(config.statusText),
    summaryFields: volatileRef<string>(config.summaryFields),
    codeDescription: volatileRef<string>(config.codeDescription),
    keepLastRows: volatileRef<number>(config.keepLastRows),
    keepLastBodySteps: volatileRef<number>(config.keepLastBodySteps),
  }
  // ★★ 必须把 ref **写回 config 对象本身**（这是整个修复的关键一步）。
  //
  // cordis 的调用链是 `fiber.config = resolveConfig(runtime, raw)`（cordis:1355/1438），
  // 而插件被调用时拿到的是**同一个对象**：`runtime.callback(this.ctx, this.config)`
  // （cordis:1068/1071）。loader 的 `_commitVolatile()` 读的也正是 `fiber.config`
  // （cordis-plugin-loader:395 `volatileEntries(fiber.config)`）。
  //
  // 因此：只在 apply 内自建 ref 而不写回，`fiber.config` 里仍是 3.18.1 产出的**普通值**
  // → `volatileEntries()` 依旧返回空 → 热更新照样空转。**原地改造这个对象**，
  // 才能让 loader 收集到 ref 并调用 `updateVolatile(ref, …)` 把新值写进我们的引用。
  //
  // 注意：经过 withVolatileValidate 后，`config` 的字段在 resolveConfig 阶段就已
  // 是 ref，这里的写回是**幂等安全网**（same ref 赋回自身，no-op）；
  // 若宿主是 3.18.4（字段本就是 ref），`volatileRef` 会沿用原 ref，此处写回等价于 no-op。
  for (const key of Object.keys(refs) as Array<keyof typeof refs>) {
    ;(config as Record<string, unknown>)[key] = refs[key]
  }
  /** 每次都现读引用——这是热更新能生效的关键（旧实现只读一次快照）。 */
  const snapshot = (): Required<AutoCollapseConfig> => ({
    statusText: refs.statusText.get() ?? DEFAULT_STATUS_TEXT,
    summaryFields: refs.summaryFields.get() ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: refs.codeDescription.get() ?? DEFAULT_CODE_DESCRIPTION,
    keepLastRows: refs.keepLastRows.get() ?? DEFAULT_KEEP_LAST_ROWS,
    keepLastBodySteps: refs.keepLastBodySteps.get() ?? DEFAULT_KEEP_LAST_BODY_STEPS,
  })
  // settings 的 base 需要**普通值**（schema 校验与 sanitizeConfig 都不接受引用对象），
  // 因此这里按需现算一次普通快照——仅用于注册期，不进热更新路径。
  const cfg: AutoCollapseConfig = snapshot()
  let current = snapshot
  installSettingsSection(ctx, AUTO_COLLAPSE_SETTINGS_NAMESPACE, Config, {
    statusText: cfg.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: cfg.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: cfg.codeDescription ?? DEFAULT_CODE_DESCRIPTION,
    keepLastRows: cfg.keepLastRows ?? DEFAULT_KEEP_LAST_ROWS,
    keepLastBodySteps: cfg.keepLastBodySteps ?? DEFAULT_KEEP_LAST_BODY_STEPS,
  }, {
    setSource: (source: () => { statusText: string; summaryFields: string; codeDescription: string; keepLastRows: number; keepLastBodySteps: number }) => {
      current = source
    },
    onChange: () => {
      void current
    },
  },
  // 【2026-09-29】describe 不可用 / 命名空间未激活时的兜底：**现读引用**，
  // 不能用注册期的静态 cfg —— 那样在 volatile 热更新后会回退到旧值。
  snapshot)
  // R6：current 在 settings 服务就绪前返回 cordis 静态 config 兜底（默认值），
  // 就绪后被 setSource 换成 settings 的真值；roster handler 每请求实时调用，
  // 因此热更新（updateVolatile 原地写 ref）会被下一次请求自然读到。
  installRosterRoute(ctx, () => current())
}
