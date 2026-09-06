/**
 * roster 探针的共享常量与签名算法（client 侧）。
 *
 * host half（src/index.ts）的构建产物是单文件（build.mjs 对 host 用
 * bundle:false，部署的 lib/ 下只有 index.js），不能跨文件 import——
 * index.ts 内联了一份逐字镜像（M8：一侧漂移会导致看门狗误判反复重载）。
 * 两侧一致性由 host-roster / roster-watch 两组单测用相同样例锁定。
 */
export const ROSTER_ROUTE = '/dsh-auto-collapse/roster'
export const OWN_CLIENT_ID = 'dsh-auto-collapse'

/** roster 中 id 集合的稳定签名：去重、排序、以不可见字符连接。
 * 与 src/index.ts 的 rosterSignatureOf 严格同算法。 */
export function rosterSignature(ids: readonly string[]): string {
  return [...new Set(ids.map(String))].sort().join('\u0000')
}

/**
 * 远程下发的插件配置真值（R6）。
 *
 * 全部字段可选：缺失字段由各 consumer 回退各自的 DEFAULT_*，与
 * settingsScope 快照语义一致。数值字段归一为非负整数。
 */
export interface RemoteConfig {
  statusText?: string
  summaryFields?: string
  codeDescription?: string
  keepLastRows?: number
  keepLastBodySteps?: number
}

/**
 * 校验并归一化 roster 响应里的 config 载荷（与 host 侧 src/index.ts 的
 * sanitizeConfig 同口径）：只透传 5 个已知字段的合法值，其余一律丢弃。
 * 返回 null 表示载荷不可用（非对象 / 无合法字段）。
 * 注意：payload 来自同源 HTTP 响应（LAN 可达），类型校验是防线，
 * 不信任其“对象形状”；字符串字段透传后由 consumer 按文本处理。
 */
export function sanitizeRemoteConfig(value: unknown): RemoteConfig | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const out: RemoteConfig = {}
  if (typeof raw.statusText === 'string') out.statusText = raw.statusText
  if (typeof raw.summaryFields === 'string') out.summaryFields = raw.summaryFields
  if (typeof raw.codeDescription === 'string') out.codeDescription = raw.codeDescription
  if (typeof raw.keepLastRows === 'number' && Number.isFinite(raw.keepLastRows)) out.keepLastRows = Math.max(0, Math.floor(raw.keepLastRows))
  if (typeof raw.keepLastBodySteps === 'number' && Number.isFinite(raw.keepLastBodySteps)) out.keepLastBodySteps = Math.max(0, Math.floor(raw.keepLastBodySteps))
  return Object.keys(out).length > 0 ? out : null
}
