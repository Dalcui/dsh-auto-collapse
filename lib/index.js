/**
 * dsh-auto-collapse — node half（构建产物，与 src/index.ts 对应）。
 */
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'dsh-auto-collapse'
export const inject = []

const DEFAULT_STATUS_TEXT = 'Deep sleeping...'
const DEFAULT_SUMMARY_FIELDS = 'duration,modelCalls(次模型),toolCalls(次工具),inputTokens(输入),cacheReadTokens(命中),cacheHitRate(命中率),outputTokens(输出),contextDelta(上下文)'
const DEFAULT_CODE_DESCRIPTION = 'always'
const AUTO_COLLAPSE_SETTINGS_NAMESPACE = settingsNamespace('dsh-auto-collapse')
const AUTO_COLLAPSE_SETTINGS_SCHEMA = z.object({
  statusText: z.string().default(DEFAULT_STATUS_TEXT),
  summaryFields: z.string().default(DEFAULT_SUMMARY_FIELDS),
  codeDescription: z.string().default(DEFAULT_CODE_DESCRIPTION),
})

export function apply(ctx, config = {}) {
  let current = () => ({
    statusText: config.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: config.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: config.codeDescription ?? DEFAULT_CODE_DESCRIPTION,
  })
  installSettingsSection(ctx, AUTO_COLLAPSE_SETTINGS_NAMESPACE, AUTO_COLLAPSE_SETTINGS_SCHEMA, {
    statusText: config.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: config.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: config.codeDescription ?? DEFAULT_CODE_DESCRIPTION,
  }, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      void current
    },
  })
}
