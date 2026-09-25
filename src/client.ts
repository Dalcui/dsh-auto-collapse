/**
 * dsh-auto-collapse — browser half（客户端插件入口）。
 *
 * 职责：
 * 1. 把会话正文之外的工具 display（read / bash / web_search / think 推理
 *    块等非正文卡片）折叠成内联的一行，折叠行实时显示当前正在进行的工作
 *    （工具名 + 正在执行的命令/参数，或思考的最新一行）；运行中标题与摘
 *    要带平滑呼吸动画（Pulse）。点击展开/收起。
 * 2. 把官方 ChatView 尾部运行状态行 "Deep diving..." 替换为可配置的
 *    "Deep sleeping..."（流光特效不变，始终生效）。
 * 3. 通过 DSH 设置 → 插件 → 插件配置 的“状态提示词”卡片编辑替换文案。
 *
 * 实现方式：纯 DOM 层（MutationObserver + rAF 合并），零核心改动、零运行时
 * 依赖。识别依据是 ChatView 渲染时写死的稳定 data 属性
 * （data-chat-flow / data-chat-call-id / data-tool / data-state /
 * data-variant / data-chat-anchor-key / data-subcalls / data-follow-end /
 * data-disclosure-row），与官方 Web 客户端的 DOM 契约对齐。
 */
import { FoldController } from './fold.ts'
import { installTurnMetricsInjector } from './turn-metrics.ts'
import { installRosterWatchdog, sanitizeRemoteConfig } from './roster-watch.ts'
import { AUTO_COLLAPSE_NS, setupSettingsCard, statusTextProvider, summaryFieldsProvider, codeDescriptionProvider, keepLastRowsProvider, keepLastBodyStepsProvider, createRemoteConfigStore, wrapScopeWithRemote, type SettingsScopeLike, type SlotsLike } from './settings.ts'

export { installRosterWatchdog, rosterSignature, shouldReloadRoster, sanitizeRemoteConfig } from './roster-watch.ts'
// 设置卡片与两代设置数据源适配器一并导出：宿主契约（plugins.item / settings.plugin.item）
// 与 ConfigForm 字段操作是本插件最容易随 DSH 升级漂移的接缝，需可被单测直接驱动。
export { createRemoteConfigStore, wrapScopeWithRemote, setupSettingsCard, cardSourceFromForm, cardSourceFromScope } from './settings.ts'
export type { RosterWatchdogOptions, RemoteConfig } from './roster-watch.ts'

export const name = 'dsh-auto-collapse'

/**
 * 需要的宿主服务：只静态注入 slots（插件配置卡片 + 指标 shadow 注册）。
 *
 * 设置服务**不能**静态注入：0.1.7 起 settingsScope 被删除（职责迁到
 * configForms），而静态 inject 一个当前版本不存在的服务会让 fiber 永久停在
 * PENDING，进而被 assertEntriesActivated 判为失败、让整个 dsh web 启动退出
 * ——这正是本插件在 0.1.7-rc.2 上被禁用的原因。设置 scope 改为运行时按能力
 * 解析（见 resolveSettingsScope）；服务始终缺席只丢设置读写，不拖垮折叠。
 */
export const inject: string[] = ['slots']

/** 客户端根上下文的最小结构化类型（仅用 cordis 标准 effect/inject，无运行时依赖）。 */
export interface FoldClientCtx {
  effect(fn: () => unknown, label?: string): unknown
  inject?(deps: string[], callback: (child: any) => unknown): unknown
  /**
   * 读可选服务（cordis 标准入口）。
   *
   * **必须走 get 而不能写 `ctx.<service>`**：DSH 客户端的 ctx 是带守卫的 Proxy，
   * 未在静态 inject 里声明过的服务名直接属性访问会抛
   * `cannot get property "X" without inject` —— 在 apply 期抛错会让客户端 entry
   * 变 FAILED、整页停在 "Failed to load plugins"（host 侧同理 exit(1)）。
   * 这两个设置服务名不可能同时存在于任一版本，因此只能用 get 做能力探测，
   * 晚到则交给 ctx.inject 回调（回调里的子 ctx 已声明该 inject，可安全属性访问）。
   */
  get?(name: string): unknown
  slots?: SlotsLike
  /** 0.1.7+：设置域服务，get(entryId) 返回与旧 settingsScope 结构同形的 ConfigForm；
   * whileServed 用于「只在宿主服务了本命名空间时才挂设置卡片」。 */
  configForms?: {
    get(entryId: string): unknown
    whileServed?(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
  }
  /** 0.1.7 之前：按命名空间绑定的设置 scope。 */
  settingsScope?: { bind(spec: { namespace: string }): SettingsScopeLike }
}

/**
 * 迟绑定的设置 scope：`apply` 期拿不到真 scope 时先给一个恒定 unavailable 的
 * 占位实现，待 configForms / settingsScope 就绪后再把内层换成真值。
 *
 * 订阅由本容器自己持有并转发给内层——这样「服务晚到」不会丢掉已经订阅的
 * consumer（FoldController.refresh / 设置卡片），也不必让 consumer 感知时序。
 */
export interface LateScope {
  /** 交给 consumer 的稳定 scope 引用（身份不随内层解析而变）。 */
  scope: SettingsScopeLike
  /**
   * 装配内层真值。priority 高者优先：低优先级服务不得覆盖已绑定的高优先级
   * 真值（同页并存两代设置客户端插件时，避免旧 scope 覆盖新 scope）。
   * undefined = 清除（仅同优先级或更高者可以清）；重复装配同一内层为 no-op。
   */
  resolve(inner: SettingsScopeLike | undefined, priority?: number): void
  /** 释放内层订阅并清空监听器（插件卸载 / HMR，防止监听器随重载线性增长）。 */
  dispose(): void
}

/** 两代设置服务的能力优先级：0.1.7+ 的 configForms 高于 0.1.7 之前的 settingsScope。 */
export const SCOPE_PRIORITY = { configForms: 2, settingsScope: 1 } as const

/**
 * 校验候选对象是否具备 scope 形状。
 *
 * 形状不符时**不能**直接 resolve：LateScope.resolve 会调用 inner.subscribe，
 * 缺方法会抛 TypeError 并一路穿透 apply 的 ctx.effect 回调 —— 那会让客户端
 * entry 激活失败，触发与本次修复的 bug 完全相同的
 * `web boot: ... did not activate`。
 */
export function isScopeLike(candidate: unknown): candidate is SettingsScopeLike {
  if (candidate === null || typeof candidate !== 'object') return false
  const c = candidate as Record<string, unknown>
  return typeof c.getSnapshot === 'function'
    && typeof c.subscribe === 'function'
    && typeof c.set === 'function'
    && typeof c.unset === 'function'
}

/** 未就绪时的占位快照（status=unavailable → consumer 回退各自默认值）。 */
function unavailableSnapshot(): ReturnType<SettingsScopeLike['getSnapshot']> {
  return { status: 'unavailable', value: undefined, base: undefined, user: undefined, writable: false }
}

/**
 * 安全地读一个可选服务（见 FoldClientCtx.get 的说明）。
 *
 * - 有 `ctx.get` 时优先用它：DSH 0.1.7 的 ctx 是带守卫的 Proxy，未在静态
 *   inject 里声明的服务名直接属性访问会抛 "cannot get property X without inject"。
 * - 没有 `ctx.get` 时回退直接属性访问：旧版 DSH 与单测 stub 就是这种形状
 *   （它们的 ctx 没有守卫，属性读取是安全的）。
 *
 * 两条路径都兜错——绝不向外抛，否则会把本插件打成 FAILED。
 */
function optionalService(ctx: FoldClientCtx, name: string): any {
  if (typeof ctx.get === 'function') {
    try {
      return ctx.get(name)
    } catch (error) {
      console.error(`[dsh-auto-collapse] ctx.get("${name}") failed (fold continues)`, error)
      return undefined
    }
  }
  try {
    return (ctx as unknown as Record<string, unknown>)[name]
  } catch {
    // 被 inject 守卫拒绝时视为服务缺席。
    return undefined
  }
}

export function createLateScope(): LateScope {
  let inner: SettingsScopeLike | undefined
  let offInner: (() => void) | undefined
  let boundPriority = -1
  let disposed = false
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-auto-collapse] settings listener failed (continuing)', error)
      }
    }
  }
  const clearInner = (): void => {
    offInner?.()
    offInner = undefined
    inner = undefined
  }
  return {
    scope: {
      getSnapshot: () => inner?.getSnapshot() ?? unavailableSnapshot(),
      subscribe(listener) {
        // dispose 后不再接受订阅（否则监听器会挂在已卸载的插件上）。
        if (disposed) return () => {}
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      // 内层未就绪时静默 no-op（与 wrapScopeWithRemote 的只读语义一致）。
      set: (field, value) => (disposed || inner === undefined ? Promise.resolve() : inner.set(field, value)),
      unset: (field) => (disposed || inner === undefined ? Promise.resolve() : inner.unset(field)),
    },
    resolve(next, priority = 0) {
      if (disposed) return
      if (next === undefined) {
        // 清除：低优先级调用者不得清掉高优先级已绑定的真值。
        if (priority < boundPriority) return
        boundPriority = -1
        clearInner()
        notify()
        return
      }
      // 低优先级不得覆盖高优先级；同优先级内允许换绑（如 settingsScope.bind
      // 每次返回新的 controller）。
      if (priority < boundPriority) return
      if (next === inner) return
      clearInner()
      inner = next
      boundPriority = priority
      offInner = inner.subscribe(notify)
      notify()
    },
    dispose() {
      disposed = true
      boundPriority = -1
      clearInner()
      listeners.clear()
    },
  }
}

/**
 * 按能力解析设置 scope 并装配进 late 容器。
 *
 * - 0.1.7+：`configForms.get(ns)` 返回的 ConfigForm 与旧 settingsScope 结构同形
 *   （getSnapshot / subscribe / set / unset），可直接当 scope 用；
 * - 0.1.7 之前：`settingsScope.bind({ namespace })`。
 *
 * 两者都用 ctx.inject 兜「服务晚到」——它对不存在的服务只是不触发回调，不会
 * 阻塞本插件 fiber。服务已就绪时先走直接读取的快路径，避免多余的 fiber。
 */
/**
 * 装配候选 scope（带形状校验与异常隔离）。
 *
 * 形状不符或取值抛错都只记日志并返回 false —— 绝不能向外抛：本函数跑在
 * apply 的 ctx.effect 回调里，抛错会让客户端 entry 激活失败，触发与本次
 * 修复的 bug 完全相同的 `web boot: ... did not activate`。
 */
function acceptScope(late: LateScope, produce: () => unknown, priority: number, label: string): boolean {
  let candidate: unknown
  try {
    candidate = produce()
  } catch (error) {
    console.error(`[dsh-auto-collapse] settings scope lookup failed (${label}; fold continues)`, error)
    return false
  }
  if (!isScopeLike(candidate)) {
    console.error(`[dsh-auto-collapse] settings scope shape unexpected (${label}; fold continues)`)
    return false
  }
  late.resolve(candidate, priority)
  return true
}

/**
 * 按能力解析设置 scope 并装配进 late 容器。
 *
 * - 0.1.7+：`configForms.get(ns)` 返回的 ConfigForm 与旧 settingsScope 结构同形
 *   （getSnapshot / subscribe / set / unset），可直接当 scope 用；
 * - 0.1.7 之前：`settingsScope.bind({ namespace })`。
 *
 * 两者都用 ctx.inject 兜「服务晚到」——它对不存在的服务只是不触发回调（子
 * fiber 挂 PENDING 不会触发 boot 断言），不阻塞本插件 fiber。服务已就绪时先走
 * 直读快路径，避免多余的 fiber。
 */
export function resolveSettingsScope(ctx: FoldClientCtx, late: LateScope): void {
  // 服务一律经 ctx.get 探测（直接写 ctx.<service> 会被 inject 守卫抛错，见 FoldClientCtx.get）。
  const configForms = optionalService(ctx, 'configForms')
  if (configForms !== undefined && configForms !== null && typeof configForms.get === 'function') {
    if (acceptScope(late, () => configForms.get(AUTO_COLLAPSE_NS), SCOPE_PRIORITY.configForms, 'configForms')) return
  }
  const settingsScope = optionalService(ctx, 'settingsScope')
  if (settingsScope !== undefined && settingsScope !== null && typeof settingsScope.bind === 'function') {
    if (acceptScope(late, () => settingsScope.bind({ namespace: AUTO_COLLAPSE_NS }), SCOPE_PRIORITY.settingsScope, 'settingsScope')) return
  }
  if (typeof ctx.inject !== 'function') return
  // 服务晚到：两个服务名各注册一次；当前版本只会派发其中一个，另一个回调永不
  // 触发。极端情况下并存时由 SCOPE_PRIORITY 决定谁生效（configForms 优先），
  // 低优先级的晚到者不会覆盖已绑定的高优先级真值。
  const waits: ReadonlyArray<{ service: 'configForms' | 'settingsScope'; priority: number }> = [
    { service: 'configForms', priority: SCOPE_PRIORITY.configForms },
    { service: 'settingsScope', priority: SCOPE_PRIORITY.settingsScope },
  ]
  for (const { service, priority } of waits) {
    try {
      ctx.inject([service], (child: any) => {
        const source = child?.[service]
        if (source === undefined || source === null) return () => {}
        acceptScope(
          late,
          service === 'configForms'
            ? () => (source as { get(id: string): unknown }).get(AUTO_COLLAPSE_NS)
            : () => (source as { bind(spec: { namespace: string }): unknown }).bind({ namespace: AUTO_COLLAPSE_NS }),
          priority,
          service,
        )
        return () => {}
      })
    } catch (error) {
      console.error(`[dsh-auto-collapse] settings scope inject failed (${service}; fold continues)`, error)
    }
  }
}

export function apply(ctx: FoldClientCtx): void {
  // 注意:cordis 的 ctx.effect(fn) 会【立即执行】fn,并把 fn 的返回值当作
  // 插件卸载时的清理函数(与 ui-slash 等官方插件同款写法)。
  //
  // 激活期异常必须自己兜住：DSH 对加载失败的客户端 entry **没有降级**——任一
  // entry 非 active 就让整页停在 "Failed to load plugins"（host 侧同理 exit(1)）。
  // 这里把装配体整体包住，异常降级为「本插件不生效 + 一条错误日志」，不再连累
  // 整个 Web 界面（与文件内 G2/U1 的故障隔离原则一致）。
  ctx.effect(() => {
    try {
      return activate(ctx)
    } catch (error) {
      console.error('[dsh-auto-collapse] activation failed (isolated; DSH boot continues)', error)
      return () => {}
    }
  }, 'dsh-auto-collapse: fold observer + settings card')
}

/** 装配体：折叠控制器 + 指标注入器 + 设置卡 + 看门狗；返回卸载清理函数。 */
function activate(ctx: FoldClientCtx): () => void {
    // 回合指标注入器：shadow 渲染器从 React 会话快照读取 token/耗时指标并写入 DOM。
    // 注入失败只丢指标功能，不连累核心折叠主链路（G2）。
    // R1：安装返回卸载函数，HMR stop 时必须 dispose shadow 注册，否则每次
    // HMR 在宿主 slots 残留一个 assistant-step shadow entry 且渲染开销线性叠加。
    let offMetrics: () => void = () => {}
    if (ctx.slots !== undefined) {
      try {
        offMetrics = installTurnMetricsInjector(ctx)
      } catch (error) {
        console.error('[dsh-auto-collapse] metrics injector install failed (fold continues)', error)
      }
    }
    // R6：远程配置兜底。DSH 官方对非回环页面强制 settings 走内存模式，
    // settingsScope 恒 unavailable；看门狗每轮轮询把宿主 settings.yaml 真值
    // 写入 remoteStore，wrap 后 scope 在远程页面回退真值（只读）、桌面页面
    // 保持原 scope（可写、实时）。
    const remoteStore = createRemoteConfigStore()
    // 设置 scope 迟绑定：静态 inject 已不再包含设置服务（见文件头 inject 注释），
    // 先给占位 scope，服务就绪后由 resolveSettingsScope 换成真值并通知订阅者。
    const late = createLateScope()
    resolveSettingsScope(ctx, late)
    const scope = wrapScopeWithRemote(late.scope, remoteStore)
    // U1：核心折叠链路（构造 + 启动）失败只丢折叠功能，不拖垮插件其余部分
    // （设置卡片 / 看门狗 / 指标注入器），与文件内「故障隔离 G2」原则一致。
    // FoldController.start() 内部 catch 后会 re-throw——这里兜住并尝试清理
    // 半初始化状态。
    let controller: FoldController | undefined
    let offFold: () => void = () => {}
    try {
      controller = new FoldController(statusTextProvider(scope), summaryFieldsProvider(scope), codeDescriptionProvider(scope), keepLastRowsProvider(scope), keepLastBodyStepsProvider(scope))
      controller.start()
      offFold = () => controller?.stop()
    } catch (error) {
      console.error('[dsh-auto-collapse] fold controller start failed (settings/watchdog continue)', error)
      try { controller?.stop() } catch { /* 半初始化清理失败可忽略 */ }
    }
    const offScope = scope.subscribe(() => controller?.refresh())
    const offSettings = ctx.slots === undefined
      ? undefined
      : setupSettingsCard({ slots: ctx.slots, configForms: optionalService(ctx, 'configForms') }, scope)
    // 插件启停热生效看门狗：轮询 node 侧 roster 探针，roster 签名变化
    // （任意客户端插件被启/停）或自身路由 404 时自动带缓存穿透参数重载
    // 页面。禁用热生效；重新启用时只有仍持有旧 bundle 的页面会自动恢复，
    // 其余页面手动刷新一次即可。与指标注入器同级的容错：失败只丢此功能。
    let offWatchdog: () => void = () => {}
    try {
      offWatchdog = installRosterWatchdog({
        bootGraph: typeof window !== 'undefined' ? (window as any).__DSH_BOOT__ : undefined,
        // R6：每轮轮询成功都携带最新 config 真值；校验失败（null）时清空
        // 远程兜底，让 scope 回到内层快照（桌面页面 scope ready 时不受影响）。
        onBody: (body) => {
          remoteStore.set(sanitizeRemoteConfig(body.config))
        },
      })
    } catch (error) {
      console.error('[dsh-auto-collapse] roster watchdog install failed (fold continues)', error)
    }
    // U12：unhandledrejection 兜底监听——异步链（宿主注入实现等）的未捕获拒绝
    // 只记录不吞错，与 fold 的 reportError 模式一致；卸载时移除。
    let offUnhandled: () => void = () => {}
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const onUnhandledRejection = (event: { reason?: unknown }): void => {
        console.warn('[dsh-auto-collapse] unhandledrejection (recorded only)', event?.reason)
      }
      window.addEventListener('unhandledrejection', onUnhandledRejection)
      offUnhandled = () => window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
    // 卸载清理链：逐项防御，任一清理抛错不中断后续清理（HMR 可逆还原）。
    const cleanupSteps: Array<{ name: string; run: () => void }> = [
      { name: 'roster watchdog', run: offWatchdog },
      // M2：先释放迟绑定 scope 的内层订阅，否则 HMR 每次重载都会在宿主
      // ConfigForm（ConfigForms 按命名空间缓存、页面生命周期内长存）上多留
      // 一个监听器，开销随重载线性增长。
      { name: 'late settings scope', run: () => late.dispose() },
      { name: 'settings scope', run: () => offScope?.() },
      { name: 'settings card', run: () => offSettings?.() },
      { name: 'metrics injector', run: offMetrics },
      { name: 'fold controller', run: offFold },
      { name: 'unhandledrejection guard', run: offUnhandled },
    ]
    return () => {
      for (const step of cleanupSteps) {
        try {
          step.run()
        } catch (error) {
          console.error(`[dsh-auto-collapse] cleanup "${step.name}" failed (continuing)`, error)
        }
      }
    }
}
