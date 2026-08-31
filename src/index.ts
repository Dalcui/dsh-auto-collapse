/**
 * dsh-auto-collapse — node half.
 */
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'dsh-auto-collapse'
export const inject: string[] = []

const DEFAULT_STATUS_TEXT = 'Deep sleeping...'
const DEFAULT_SUMMARY_FIELDS = 'duration,modelCalls(次模型),toolCalls(次工具),inputTokens(输入),cacheReadTokens(命中),cacheHitRate(命中率),outputTokens(输出),contextDelta(上下文)'
const DEFAULT_CODE_DESCRIPTION = 'always'
const DEFAULT_KEEP_LAST_ROWS = 3
const AUTO_COLLAPSE_SETTINGS_NAMESPACE = settingsNamespace('dsh-auto-collapse')

const AUTO_COLLAPSE_SETTINGS_SCHEMA = z.object({
  statusText: z.string().default(DEFAULT_STATUS_TEXT),
  summaryFields: z.string().default(DEFAULT_SUMMARY_FIELDS),
  codeDescription: z.string().default(DEFAULT_CODE_DESCRIPTION),
  keepLastRows: z.natural().default(DEFAULT_KEEP_LAST_ROWS),
})

export interface Config {
  statusText?: string
  summaryFields?: string
  codeDescription?: string
  keepLastRows?: number
}

/**
 * 探针路由：返回当前客户端模块图（roster）的“是否变化”签名。
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
 */
const ROSTER_ROUTE = '/dsh-auto-collapse/roster'
const OWN_CLIENT_ID = 'dsh-auto-collapse'

/** 与浏览器侧 rosterSignature 同算法的 id 集合签名。 */
export function rosterSignatureOf(ids: readonly string[]): string {
  return [...new Set(ids.map(String))].sort().join('\u0000')
}

/** 构造探针 handler（从 clientModules 服务读图）。独立导出便于单测。 */
export function createRosterHandler(getModules: () => { graph?: () => { entries?: Array<{ id?: unknown }> } }, logger?: (error: unknown) => void) {
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
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      // HEAD 请求 Node 会按 HTTP 语义自动抑制响应体（ServerResponse._hasBody）。
      res.end(JSON.stringify({
        sig: rosterSignatureOf(ids),
        own: ids.includes(OWN_CLIENT_ID),
      }))
    } catch (error) {
      logger?.(error)
      // 不向客户端回显内部错误细节（LAN 可达时避免泄露）。
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('internal error')
    }
  }
}

function installRosterRoute(ctx: any): void {
  // 可选注入：不把 webServer 写进 inject 列表，部署里没有该服务时
  // 本插件其余功能（设置卡片）不受影响，只少一个探针。
  ctx.inject(['webServer'], (webCtx: any) => {
    const handler = createRosterHandler(
      () => webCtx.get('clientModules'),
      (error) => webCtx.logger?.warn?.(error),
    )
    const dispose = webCtx.webServer.register({ kind: 'exact', path: ROSTER_ROUTE, handler })
    return () => {
      dispose()
    }
  })
}

export function apply(ctx: any, config: Config = {}): void {
  let current = () => ({
    statusText: config.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: config.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: config.codeDescription ?? DEFAULT_CODE_DESCRIPTION,
    keepLastRows: config.keepLastRows ?? DEFAULT_KEEP_LAST_ROWS,
  })
  installSettingsSection(ctx, AUTO_COLLAPSE_SETTINGS_NAMESPACE, AUTO_COLLAPSE_SETTINGS_SCHEMA, {
    statusText: config.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: config.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: config.codeDescription ?? DEFAULT_CODE_DESCRIPTION,
    keepLastRows: config.keepLastRows ?? DEFAULT_KEEP_LAST_ROWS,
  }, {
    setSource: (source: () => { statusText: string; summaryFields: string; codeDescription: string; keepLastRows: number }) => {
      current = source
    },
    onChange: () => {
      void current
    },
  })
  installRosterRoute(ctx)
}
