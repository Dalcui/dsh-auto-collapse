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
  const candidate = schema as unknown as { volatile?: () => T }
  return typeof candidate.volatile === 'function' ? candidate.volatile() : schema
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
      hooks.setSource(() => readOwnSettings(settings, ns) ?? entry)
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
      hooks.setSource(() => entry)
      hooks.onChange()
    })
    hooks.onChange()
    scope.watch(() => {
      if (isUnloading(ctx)) return
      hooks.onChange()
    })
  })
}

export function apply(ctx: any, config: RawAutoCollapseConfig = {}): void {
  // volatile 字段先解引用一次（见 deref 注释）：后续 current() 与 settings 的
  // base 都必须拿普通值，否则 schema 校验与 sanitizeConfig 都会失效。
  const cfg: AutoCollapseConfig = {
    statusText: deref(config.statusText),
    summaryFields: deref(config.summaryFields),
    codeDescription: deref(config.codeDescription),
    keepLastRows: deref(config.keepLastRows),
    keepLastBodySteps: deref(config.keepLastBodySteps),
  }
  let current = () => ({
    statusText: cfg.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: cfg.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: cfg.codeDescription ?? DEFAULT_CODE_DESCRIPTION,
    keepLastRows: cfg.keepLastRows ?? DEFAULT_KEEP_LAST_ROWS,
    keepLastBodySteps: cfg.keepLastBodySteps ?? DEFAULT_KEEP_LAST_BODY_STEPS,
  })
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
  })
  // R6：current 在 settings 服务就绪前返回 cordis 静态 config 兜底（与
  // 客户端现状相同的默认值），就绪后被 setSource 换成 settings.yaml 真值；
  // roster handler 每请求实时调用，无需任何缓存失效逻辑。
  installRosterRoute(ctx, () => current())
}
