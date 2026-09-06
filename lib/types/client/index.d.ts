/**
 * dsh-auto-collapse — browser half 类型声明。
 *
 * 折叠会话里的工具卡片与 Think 推理块；把官方 "Deep diving..." 运行状态行
 * 替换为可配置的状态提示词（默认 "Deep sleeping..."，为空时不替换）。
 * 同时注册 DSH 设置 → 插件 → 插件配置的“状态提示词”卡片。
 */

/** 客户端根上下文的最小结构化类型（与 src/client.ts 的 FoldClientCtx 一致：
 * cordis 标准 effect + 可选的 slots / settingsScope 服务；两者缺一不影响核心折叠）。 */
export interface FoldClientCtx {
  effect(fn: () => unknown, label?: string): unknown
  slots?: {
    inject(key: string, callback: () => unknown): () => void
    register(options: { name: string; key: string; inject: () => unknown }, renderer: (props: { scope: unknown }) => unknown): unknown
  }
  settingsScope?: { bind(spec: { namespace: string }): unknown }
}

export declare const name: string
export declare const inject: string[]
export declare function apply(ctx: FoldClientCtx): void

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
