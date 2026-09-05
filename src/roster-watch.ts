/**
 * roster-watch.ts —— 插件启停热生效的浏览器侧看门狗。
 *
 * 背景（根因）：DSH 官方对插件启停的“热应用”链路在服务端是完备的——
 * profile 的 cordis.patch.yml（`- id: X` + `disabled: true/false`）由
 * watchUserPatches → cordis-plugin-hmr 监视，文件一变就重组合并事务化
 * update 进 Loader 树；dsh-client-modules 监听 internal/plugin，把禁用
 * 掉的插件从 `__DSH_BOOT__` 客户端模块图里摘除/恢复。也就是说**服务端
 * 无需重启**，~1s 内生效。
 *
 * 缺口在浏览器：已打开的页面不会因为模块图（roster）变化而自动刷新。
 * 官方 dsh-client-hmr 只热替换 `rebuilt` 帧（bundle 内容变化），`graph`
 * 帧被忽略；市场插件也只能弹“刷新页面”提示。于是用户看到的现象是
 * “开关插件不生效、只能重启服务”（重启后页面重连/重载才拿到新图）。
 *
 * 本模块补上这个闭环：node 侧暴露 /dsh-auto-collapse/roster 探针路由
 * （见 src/index.ts），浏览器侧每 1.5s 轮询一次，一旦 roster 的 id 集合
 * 签名变化（任意客户端插件被启/停）或本插件自己的路由消失（自身被禁用），
 * 立即带缓存穿透参数重载页面。
 *
 * 覆盖边界（如实说明）：
 * - 禁用任意客户端插件 → 热生效：持有本 bundle 的页面约 1.5–3s 内自动
 *   刷新并应用新状态，无需重启服务、无需手动刷新。
 * - 重新启用本插件 → 仍持有旧 bundle 的页面本就未卸载（禁用后尚未到
 *   下一次轮询），恢复后无需刷新即可继续工作；已按禁用刷新的页面不再
 *   装载本 bundle，没有代码在轮询，需要手动刷新一次。
 * - 3s 防风暴窗口内连续切换多个插件，只有首次变更触发自动刷新。
 *
 * 纯逻辑部分（rosterSignature / shouldReloadRoster）与副作用部分
 * （installRosterWatchdog）分离，副作用全部可注入，便于单测。
 */

// M8：roster 常量与签名算法收敛到共享模块（host 侧镜像见 src/index.ts，
// 一致性由两侧单测相同样例锁定）。re-export 保持 client.ts 的导出链不变。
import { ROSTER_ROUTE, OWN_CLIENT_ID, rosterSignature } from './roster-constants.ts'
export { rosterSignature }

/**
 * 判断是否应重载页面。
 * 仅当两侧签名都有值且不同（roster 成员增删）时返回 true；
 * 任一缺失（尚无基线/探测失败）都不触发，避免启动期误刷。
 */
export function shouldReloadRoster(prevSignature: string | null, nextSignature: string | null): boolean {
  if (prevSignature === null || nextSignature === null) return false
  return prevSignature !== nextSignature
}

export interface RosterWatchdogOptions {
  /** 本插件在客户端模块图中的 id（bundle 注册名）。 */
  ownId?: string
  /** node 侧探针路由，同源相对路径。 */
  endpoint?: string
  /** 轮询间隔（毫秒）。 */
  pollMs?: number
  /** 两次自动重载之间的最小间隔（毫秒），防重载风暴。 */
  minReloadIntervalMs?: number
  /** fetch 实现（可注入假实现用于测试）。 */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>
  /** 定时器实现（可注入）。返回句柄交给 clearTimer。 */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** 页面重载实现（默认带缓存穿透参数 replace）。 */
  reload?: () => void
  /** 会话级存储，记录最近一次自动重载时间，防循环。 */
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): void }
  /** 启动时页面的模块图（window.__DSH_BOOT__），用于基线。 */
  bootGraph?: { entries?: Array<{ id?: unknown }> } | null
}

const DEFAULT_OWN_ID = OWN_CLIENT_ID
const DEFAULT_ENDPOINT = ROSTER_ROUTE
const DEFAULT_POLL_MS = 1500
const DEFAULT_MIN_RELOAD_INTERVAL_MS = 3000
const RELOAD_STAMP_KEY = 'dshcf-roster-reload-stamp'

function defaultStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  const memory = new Map<string, string>()
  let session: Storage | undefined
  try {
    if (typeof sessionStorage !== 'undefined') session = sessionStorage
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用，退化为内存。 */
  }
  return {
    getItem(key) {
      try {
        const value = session?.getItem(key) ?? memory.get(key) ?? null
        return value
      } catch {
        return memory.get(key) ?? null
      }
    },
    setItem(key, value) {
      memory.set(key, value)
      try {
        session?.setItem(key, value)
      } catch {
        /* 存储不可用就只留内存。 */
      }
    },
  }
}

function defaultReload(): void {
  try {
    const url = new URL(window.location.href)
    // 缓存穿透：换一个新 URL 强制重新拉取 index.html（index 无 cache 头，
    // 浏览器可能启发式缓存，换 URL 最稳）。
    url.searchParams.set('__dshcfreload', String(Date.now()))
    window.location.replace(url.href)
  } catch {
    window.location.reload()
  }
}

/**
 * 安装 roster 看门狗。
 * @returns 停止轮询的清理函数（插件卸载/HMR 时由 ctx.effect 调用）。
 */
export function installRosterWatchdog(options: RosterWatchdogOptions = {}): () => void {
  const ownId = options.ownId ?? DEFAULT_OWN_ID
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const minReloadIntervalMs = options.minReloadIntervalMs ?? DEFAULT_MIN_RELOAD_INTERVAL_MS
  const fetchFn = options.fetchFn ?? ((url: string, init?: RequestInit) => fetch(url, init))
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const reload = options.reload ?? defaultReload
  const storage = options.storage ?? defaultStorage()

  // 基线来自页面当前加载的模块图：bundle 能在页面里运行，说明基线含自身。
  const bootEntries = options.bootGraph === undefined || options.bootGraph === null
    ? (typeof window !== 'undefined' && Array.isArray((window as any).__DSH_BOOT__?.entries)
      ? (window as any).__DSH_BOOT__.entries
      : [])
    : (options.bootGraph.entries ?? [])
  const baselineIds: string[] = []
  for (const entry of bootEntries) {
    const id = (entry as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') baselineIds.push(id)
  }
  if (baselineIds.length === 0) return () => {}
  let prevSignature: string | null = rosterSignature(baselineIds)
  let prevOwn: boolean = baselineIds.includes(ownId)
  let stopped = false
  let timerHandle: unknown

  const tryReload = (): boolean => {
    const now = Date.now()
    let stamp: number | null = null
    try {
      const raw = storage.getItem(RELOAD_STAMP_KEY)
      if (raw !== null) stamp = Number(raw)
    } catch {
      /* 读不到就当没有。 */
    }
    if (stamp !== null && Number.isFinite(stamp) && now - stamp < minReloadIntervalMs) return false
    try {
      storage.setItem(RELOAD_STAMP_KEY, String(now))
    } catch {
      /* 写失败不阻塞重载。 */
    }
    try {
      reload()
    } catch (error) {
      // 🟢 安全审查项：reload 默认实现安全，但注入实现抛错会变成
      // unhandledrejection 打断轮询链；吞掉并让下一轮轮询继续接管。
      console.error('[dsh-auto-collapse] roster reload failed', error)
    }
    return true
  }

  const schedule = (): void => {
    if (stopped) return
    timerHandle = setTimer(tick, pollMs)
  }

  const tick = (): void => {
    if (stopped) return
    Promise.resolve().then(async () => {
      if (stopped) return
      let status = 0
      let nextSignature: string | null = null
      let nextOwn: boolean | null = null
      try {
        // M9：轮询 fetch 无超时 → TCP 挂起时 await 永不 resolve，tick 不
        // catch 也不 schedule，轮询链断裂（探针恰是服务异常时的最后防线）。
        // AbortSignal.timeout 超时抛 AbortError，与网络异常同走静默忽略路径。
        // 旧浏览器可能没有 AbortSignal.timeout：直接求值会抛 TypeError 被
        // catch 吞掉、fetchFn 根本没被调用 → 探针静默永不轮询，先
        // feature-detect，不支持时退化为无超时。响应体读取（res.json()）
        // 不在超时窗口内——探针响应仅几十字节，风险可忽略。
        const init: RequestInit = { cache: 'no-store' }
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
          init.signal = AbortSignal.timeout(pollMs)
        }
        const res = await fetchFn(endpoint, init)
        status = res.status
        if (res.status === 200) {
          const body = (await res.json()) as { sig?: unknown; own?: unknown }
          if (typeof body.sig === 'string') nextSignature = body.sig
          if (typeof body.own === 'boolean') nextOwn = body.own
        }
      } catch {
        // 网络瞬时失败（含服务重启窗口）静默忽略，下一轮再探。
        schedule()
        return
      }
      if (stopped) return
      if (status === 404) {
        // 探针路由消失 = 本插件的 node half 被卸载（自身被禁用）。
        // 只有此前自身在线时才需要重载拿新状态。
        if (prevOwn && tryReload()) return // 页面正在重载，停止后续轮询。
        schedule()
        return
      }
      if (status !== 200 || nextSignature === null) {
        schedule()
        return
      }
      if (shouldReloadRoster(prevSignature, nextSignature)) {
        if (tryReload()) return // 页面正在重载，停止后续轮询。
        // 重载被间隔保护压住：不吸收新基线，保持旧基线不变；窗口过后
        // 下一轮轮询会再次检测到同一差异并触发重载，最终收敛到最新状态。
        // 3s 时间戳已保证重载频率上限，不会形成风暴。
        prevOwn = nextOwn ?? prevOwn
      } else {
        prevOwn = nextOwn ?? prevOwn
      }
      schedule()
    })
  }

  schedule()
  return () => {
    stopped = true
    clearTimer(timerHandle)
  }
}
