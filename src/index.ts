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
const AUTO_COLLAPSE_SETTINGS_NAMESPACE = settingsNamespace('dsh-auto-collapse')

const AUTO_COLLAPSE_SETTINGS_SCHEMA = z.object({
  statusText: z.string().default(DEFAULT_STATUS_TEXT),
  summaryFields: z.string().default(DEFAULT_SUMMARY_FIELDS),
  codeDescription: z.string().default(DEFAULT_CODE_DESCRIPTION),
})

export interface Config {
  statusText?: string
  summaryFields?: string
  codeDescription?: string
}

export function apply(ctx: any, config: Config = {}): void {
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
    setSource: (source: () => { statusText: string; summaryFields: string; codeDescription: string }) => {
      current = source
    },
    onChange: () => {
      void current
    },
  })
}
