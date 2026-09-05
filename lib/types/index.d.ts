/**
 * dsh-auto-collapse — host half 类型声明。
 *
 * 注册 `dsh-auto-collapse` settings 命名空间，供浏览器端插件配置卡片读写；
 * 浏览器端 bundle 通过 package.json 的 dsh.client 声明 + exports["./client"]
 * 被 dsh web 的 client-modules 服务发现并注入页面。
 */

/** Host 插件名。 */
export declare const name: 'dsh-auto-collapse'

/** Host 侧不注入额外服务。 */
export declare const inject: string[]

/** 插件配置。 */
export interface Config {
  /** 自定义状态提示词；留空恢复官方 "Deep diving..."。 */
  statusText?: string
  /** 摘要栏指标字段串（逗号分隔，支持 字段名(自定义名)）。 */
  summaryFields?: string
  /** 完成态二级折叠「最后一次 Code 工具 description」显示模式：always/hover/never。 */
  codeDescription?: string
  /** 进行中回合最后保留不折叠的系统提示行数量（默认 3，非负整数）。 */
  keepLastRows?: number
  /** 每个轮次折叠时最后保留不折叠的正文条数（默认 1，非负整数；
   * 0 = 除最后一个轮次外全部正文折叠，最后一个轮次始终至少保留 1 条）。 */
  keepLastBodySteps?: number
}

/** Host 插件体：注册设置命名空间。 */
export declare function apply(ctx: unknown, config?: Config): void

/** 探针路由路径（与 client 侧 src/roster-constants.ts 的 ROSTER_ROUTE 镜像一致）。 */
export declare const ROSTER_ROUTE: string

/** 与浏览器侧 rosterSignature 同算法的客户端插件 id 集合签名。 */
export declare function rosterSignatureOf(ids: readonly string[]): string

/** 构造 /dsh-auto-collapse/roster 探针 handler（供单测使用）。 */
export declare function createRosterHandler(
  getModules: () => { graph?: () => { entries?: Array<{ id?: unknown }> } },
  logger?: (error: unknown) => void,
): (req: { method?: string }, res: {
  writeHead(status: number, headers?: Record<string, string>): void
  end(payload?: string): void
}) => void
