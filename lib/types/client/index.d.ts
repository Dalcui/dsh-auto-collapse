/**
 * dsh-auto-collapse — browser half 类型声明。
 *
 * 折叠会话里的工具卡片与 Think 推理块；把官方 "Deep diving..." 运行状态行
 * 替换为可配置的状态提示词（默认 "Deep sleeping..."，为空时不替换）。
 * 同时注册 DSH 设置 → 插件 → 插件配置的“状态提示词”卡片。
 */

/** 客户端根上下文的最小结构化类型（与 src/client.ts 的 FoldClientCtx 一致：
 * cordis 标准 effect/inject + 可选的 slots / 设置服务；缺一不影响核心折叠）。 */
export interface FoldClientCtx {
  effect(fn: () => unknown, label?: string): unknown
  inject?(deps: string[], callback: (child: any) => unknown): unknown
  slots?: {
    inject(key: string, callback: () => unknown): () => void
    register(options: { name: string; key?: string; id?: string; order?: number; label?: string | (() => string); inject: () => unknown }, renderer: (props: any) => unknown): unknown
  }
  /** 0.1.7+：设置域服务，get(entryId) 返回与旧 settingsScope 结构同形的 ConfigForm。 */
  configForms?: { get(entryId: string): unknown }
  /** 0.1.7 之前：按命名空间绑定的设置 scope。 */
  settingsScope?: { bind(spec: { namespace: string }): unknown }
}

/** 与 src/settings.ts 的 SettingsScopeLike 一致的设置 scope 面。 */
export interface SettingsScopeLike {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value?: Record<string, unknown>
    base?: Record<string, unknown>
    user?: Record<string, unknown>
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** 迟绑定的设置 scope 容器（见 src/client.ts createLateScope）。 */
export interface LateScope {
  /** 交给 consumer 的稳定 scope 引用（身份不随内层解析而变）。 */
  scope: SettingsScopeLike
  /** 装配内层真值；priority 高者优先，低优先级不覆盖高优先级。 */
  resolve(inner: SettingsScopeLike | undefined, priority?: number): void
  /** 释放内层订阅并清空监听器（插件卸载 / HMR）。 */
  dispose(): void
}

/** 两代设置服务的能力优先级：0.1.7+ 的 configForms 高于 0.1.7 之前的 settingsScope。 */
export declare const SCOPE_PRIORITY: { readonly configForms: 2; readonly settingsScope: 1 }

/** 校验候选对象是否具备 scope 形状（getSnapshot/subscribe/set/unset 都是函数）。 */
export declare function isScopeLike(candidate: unknown): candidate is SettingsScopeLike

/** 创建迟绑定 scope 容器：静态 inject 不再包含设置服务时的占位实现。 */
export declare function createLateScope(): LateScope

/** 按能力解析设置 scope（0.1.7+ configForms / 0.1.7 之前 settingsScope）并装配进容器。 */
export declare function resolveSettingsScope(ctx: FoldClientCtx, late: LateScope): void

export declare const name: string
/** 静态注入的宿主服务（只有 slots；设置服务改运行时解析，见 resolveSettingsScope）。 */
export declare const inject: string[]
export declare function apply(ctx: FoldClientCtx): void

/** 注册选项：兼容 keyed slot（0.1.7 之前）与 list slot（0.1.7+ plugins.item）。 */
export interface SlotRegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: string | (() => string)
  inject: () => unknown
}

/** 槽位服务面（inject / register）。 */
export interface SlotsLike {
  inject(key: string, callback: () => unknown): () => void
  register(options: SlotRegisterOptions, renderer: (props: any) => unknown): unknown
}

/** configForms 服务的最小结构化类型（0.1.7+ 的 whileServed 门禁）。 */
export interface ConfigFormsLike {
  get(entryId: string): unknown
  whileServed?(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
}

/** 设置快照（含可选 revision 栅栏）。 */
export type SettingsSnapshotLike = ReturnType<SettingsScopeLike['getSnapshot']> & { revision?: number }

/** 设置卡片的字段操作：与 0.1.7+ SettingsPathOpView 同形（path 固定单字段）。 */
export type FieldOp =
  | { op: 'set'; field: string; value: unknown }
  | { op: 'unset'; field: string }

/** 卡片数据源：归一化两代设置契约。 */
export interface CardSource {
  getSnapshot(): SettingsSnapshotLike
  commit(ops: readonly FieldOp[]): Promise<boolean>
}

/** 0.1.7+ ConfigPageForm 的最小结构化类型。 */
export interface ConfigPageFormLike {
  state: SettingsSnapshotLike
  mutate(ops: readonly unknown[], expectedRevision?: number): Promise<boolean>
}

/** 0.1.7+ plugins.item 的 owner props 数据源（form.mutate 原子提交）。 */
export declare function cardSourceFromForm(form: ConfigPageFormLike): CardSource
/** 0.1.7 之前 settings.plugin.item 的 scope 数据源（逐字段 set/unset）。 */
export declare function cardSourceFromScope(scope: SettingsScopeLike): CardSource

/** 注册插件配置卡片：同时挂 plugins.item（0.1.7+）与 settings.plugin.item（0.1.7 之前）；
 * 返回逐项防御的 disposer（任一清理抛错不中断其余）。 */
export declare function setupSettingsCard(ctx: { slots: SlotsLike; configForms?: ConfigFormsLike }, scope: SettingsScopeLike): () => void

/** roster 看门狗相关导出（与 src/roster-watch.ts 对应）。 */
export interface RosterWatchdogOptions {
  ownId?: string
  endpoint?: string
  pollMs?: number
  minReloadIntervalMs?: number
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  reload?: () => void
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): void }
  bootGraph?: { entries?: Array<{ id?: unknown }> } | null
  /** 每次成功解析 200 响应后的回调（含 R6 远程配置载荷）。 */
  onBody?: (body: { sig: string | null; own: boolean | null; config: unknown }) => void
}
export declare function rosterSignature(ids: readonly string[]): string
export declare function shouldReloadRoster(prevSignature: string | null, nextSignature: string | null): boolean
export declare function installRosterWatchdog(options?: RosterWatchdogOptions): () => void

/** 远程下发的插件配置真值（R6）：全部字段可选，缺失由 consumer 回退默认值。 */
export interface RemoteConfig {
  statusText?: string
  summaryFields?: string
  codeDescription?: string
  /**
   * ⚠️ 【已移除 · DSH 0.1.7】设置卡片的「进行中保留行数」UI 入口已删除、
   * 运行时**不再生效**（`keepRow` 恒 false）。该字段**保留**仅为：
   * ① 不破坏既有测试的 scopeMock 与远程配置契约；② 旧版本 DSH 下仍可解析。
   * 参见 ADAPTATION_PLAN_0.1.7.md §5.8 的降级声明。
   */
  keepLastRows?: number
  keepLastBodySteps?: number
}
/** 校验并归一化 roster 响应里的 config 载荷；不可用返回 null。 */
export declare function sanitizeRemoteConfig(value: unknown): RemoteConfig | null

/** 远程配置内存 store（R6）。 */
export interface RemoteConfigStore {
  get(): RemoteConfig | null
  set(config: RemoteConfig | null): boolean
  subscribe(listener: () => void): () => void
}
export declare function createRemoteConfigStore(): RemoteConfigStore

/** 设置 scope 的最小结构（与 src/settings.ts 的 SettingsScopeLike 一致）。 */
export interface SettingsScopeLike {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value?: Record<string, unknown>
    base?: Record<string, unknown>
    user?: Record<string, unknown>
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}
/** scope 优先、远程真值兜底的合成 scope（R6）。 */
export declare function wrapScopeWithRemote(scope: SettingsScopeLike | undefined, remote: RemoteConfigStore): SettingsScopeLike
