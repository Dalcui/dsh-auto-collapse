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

/**
 * 运行期配置 schema（schemastery 对象 schema）。
 *
 * 0.1.7+ 的 SettingsForms 从本导出派生设置表单（SettingsForms.schema() 读
 * entry.fiber.runtime.Config），且只有带 volatile 标记的字段进入浏览器可写的
 * 表单投影——因此这里必须导出真实 schema 而非纯类型声明。更早的 DSH 走
 * installSection 显式注册命名空间，不读本导出。
 */
export declare const Config: { toJSON(): unknown }

/** schemastery volatile 字段在运行期的引用形态（createVolatile 产物）。 */
export interface VolatileRef<T> {
  get(): T
}

/**
 * apply 实际收到的 config 形态：导出运行期 schema 后，volatile 字段被 cordis
 * 包成 { get() } 引用对象（默认值也一样），apply 内部会统一解引用。
 */
export interface RawAutoCollapseConfig {
  statusText?: string | VolatileRef<string>
  summaryFields?: string | VolatileRef<string>
  codeDescription?: string | VolatileRef<string>
  keepLastRows?: number | VolatileRef<number>
  keepLastBodySteps?: number | VolatileRef<number>
}

/** 解引用后的普通配置值（等价于 Config 的推导结果）。 */
export interface AutoCollapseConfig {
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

/** Host 插件体：注册设置命名空间（config 内的 volatile 引用会被解引用）。 */
export declare function apply(ctx: unknown, config?: RawAutoCollapseConfig): void

/** 探针路由路径（与 client 侧 src/roster-constants.ts 的 ROSTER_ROUTE 镜像一致）。 */
export declare const ROSTER_ROUTE: string

/** 与浏览器侧 rosterSignature 同算法的客户端插件 id 集合签名。 */
export declare function rosterSignatureOf(ids: readonly string[]): string

/** 构造 /dsh-auto-collapse/roster 探针 handler（供单测使用）；
 * 可选 getConfig 把 settings.yaml 真值只读下发（R6）。 */
export declare function createRosterHandler(
  getModules: () => { graph?: () => { entries?: Array<{ id?: unknown }> } },
  logger?: (error: unknown) => void,
  getConfig?: () => unknown,
): (req: { method?: string }, res: {
  writeHead(status: number, headers?: Record<string, string>): void
  end(payload?: string): void
}) => void
