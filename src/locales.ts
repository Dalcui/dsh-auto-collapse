/**
 * dsh-auto-collapse — 国际化支持。
 */
export type Locale = 'zh' | 'en'
export function getLocale(): Locale {
  if (typeof document === 'undefined') return 'zh'
  const lang = document.documentElement.lang || 'zh-CN'
  if (lang.startsWith('en')) return 'en'
  return 'zh'
}
export const SUMMARY_FIELDS = ['duration','toolCalls','modelCalls','inputTokens','contextDelta','outputTokens','reasoningTokens','cacheReadTokens','cacheWriteTokens','cacheHitRate','timeToFirstToken','tokensPerSecond'] as const
export type SummaryField = typeof SUMMARY_FIELDS[number]
export const DEFAULT_SUMMARY_FIELDS: SummaryField[] = ['duration','modelCalls','toolCalls','inputTokens','cacheReadTokens','cacheHitRate','outputTokens','contextDelta']
/** 摘要栏默认字段串（唯一权威默认；host/client 两侧共用）。 */
export const DEFAULT_SUMMARY_FIELDS_STRING = 'duration,modelCalls(次模型),toolCalls(次工具),inputTokens(输入),cacheReadTokens(命中),cacheHitRate(命中率),outputTokens(输出),contextDelta(上下文)'
/** 完成态二级折叠「最后一次 Code 工具 description」的显示模式（唯一权威默认）。 */
export const DEFAULT_CODE_DESCRIPTION = 'always'
export const AUTO_COLLAPSE_NS = 'dsh-auto-collapse'
const ZH: Record<string, string> = {
  'summary.activity': '执行过程',
  'summary.duration': '已工作 {duration}',
  'summary.elapsed': '耗时 {duration}',
  'summary.toolCalls.one': '{count} 次工具调用',
  'summary.toolCalls.many': '{count} 次工具调用',
  'summary.modelCalls.one': '{count} 次模型调用',
  'summary.modelCalls.many': '{count} 次模型调用',
  'summary.inputTokens': '{count} 输入 tokens',
  'summary.outputTokens': '{count} 输出 tokens',
  'summary.cacheReadTokens': '{count} 缓存读取 tokens',
  'summary.cacheWriteTokens': '{count} 缓存写入 tokens',
  'summary.cacheHitRate': '缓存命中率 {percent}',
  'summary.reasoningTokens': '{count} 推理 tokens',
  'summary.timeToFirstToken': '首 token 用时 {seconds} 秒',
  'summary.tokensPerSecond': '{count} tokens/秒',
  'summary.stoppedSuffix': ' - 已停止',
  'summary.interruptedSuffix': ' - 已中断',
  'settings.title': '折叠指标',
  'settings.description': '选择回合摘要栏中显示的指标。',
  'settings.duration': '工作耗时',
  'settings.toolCalls': '工具调用次数',
  'settings.modelCalls': '模型调用次数',
  'settings.inputTokens': '输入 tokens',
  'settings.outputTokens': '输出 tokens',
  'settings.cacheReadTokens': '缓存读取 tokens',
  'settings.cacheWriteTokens': '缓存写入 tokens',
  'settings.cacheHitRate': '缓存命中率',
  'settings.reasoningTokens': '推理 tokens',
  'settings.timeToFirstToken': '首 token 用时',
  'settings.tokensPerSecond': '输出速度',
}
const EN: Record<string, string> = {
  'summary.activity': 'Agent activity',
  'summary.duration': 'Worked for {duration}',
  'summary.elapsed': 'Took {duration}',
  'summary.toolCalls.one': '{count} tool call',
  'summary.toolCalls.many': '{count} tool calls',
  'summary.modelCalls.one': '{count} model call',
  'summary.modelCalls.many': '{count} model calls',
  'summary.inputTokens': '{count} input tokens',
  'summary.outputTokens': '{count} output tokens',
  'summary.cacheReadTokens': '{count} cache-read tokens',
  'summary.cacheWriteTokens': '{count} cache-write tokens',
  'summary.cacheHitRate': '{percent} cache hit rate',
  'summary.reasoningTokens': '{count} reasoning tokens',
  'summary.timeToFirstToken': 'First token in {seconds}s',
  'summary.tokensPerSecond': '{count} tokens/s',
  'summary.stoppedSuffix': ' - Stopped',
  'summary.interruptedSuffix': ' - Interrupted',
  'settings.title': 'Fold Metrics',
  'settings.description': 'Choose the metrics shown in the turn summary bar.',
  'settings.duration': 'Elapsed time',
  'settings.toolCalls': 'Tool calls',
  'settings.modelCalls': 'Model calls',
  'settings.inputTokens': 'Input tokens',
  'settings.outputTokens': 'Output tokens',
  'settings.cacheReadTokens': 'Cache-read tokens',
  'settings.cacheWriteTokens': 'Cache-write tokens',
  'settings.cacheHitRate': 'Cache hit rate',
  'settings.reasoningTokens': 'Reasoning tokens',
  'settings.timeToFirstToken': 'Time to first token',
  'settings.tokensPerSecond': 'Output speed',
}
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = getLocale() === 'en' ? EN : ZH
  let text = dict[key]
  if (text === undefined) text = ZH[key] ?? key
  if (params !== undefined) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}
export function formatTokens(count: number): string {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M'
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K'
  return String(count)
}
