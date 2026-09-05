/**
 * dsh-auto-collapse — 默认值权威源（client 侧）。
 *
 * 历史说明（M7）：本文件曾有一套 ZH/EN 词典 + t()/formatTokens()/getLocale()
 * i18n 框架，但 src 内零调用（grep 确认）——摘要文案实际内联在 fold.ts 的
 * getLocale()/formatTokensShort() 双语实现里。已删除整套死代码，本文件只
 * 保留各默认值的唯一权威定义。
 *
 * host 侧（src/index.ts）因产物是单文件（build.mjs 对 host 用 bundle:false，
 * 部署的 lib/ 下只有 index.js）不能跨文件 import，内联了一份逐字镜像；两侧
 * 一致性依赖「默认值不得只改一边」的纪律与 README 符号级模块地图的标注。
 */
/** 摘要栏全部可用字段清单（「未配置时」的渲染兜底顺序也用它）。 */
export const SUMMARY_FIELDS = ['duration', 'toolCalls', 'modelCalls', 'inputTokens', 'contextDelta', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cacheHitRate', 'timeToFirstToken', 'tokensPerSecond'] as const

/** 摘要栏默认字段串（唯一权威默认；host/client 两侧共用口径）。 */
export const DEFAULT_SUMMARY_FIELDS_STRING = 'duration,modelCalls(次模型),toolCalls(次工具),inputTokens(输入),cacheReadTokens(命中),cacheHitRate(命中率),outputTokens(输出),contextDelta(上下文)'
/** 完成态二级折叠「最后一次 Code 工具 description」的显示模式（唯一权威默认）。 */
export const DEFAULT_CODE_DESCRIPTION = 'always'
/** 进行中回合最后保留不折叠的系统提示行数量（唯一权威默认）。 */
export const DEFAULT_KEEP_LAST_ROWS = 3
/** 每个轮次折叠时最后保留不折叠的正文文本条数（唯一权威默认；0=折叠
 * 除最后一个轮次外的所有正文，最后一个轮次始终至少保留 1 条）。 */
export const DEFAULT_KEEP_LAST_BODY_STEPS = 1
export const AUTO_COLLAPSE_NS = 'dsh-auto-collapse'
