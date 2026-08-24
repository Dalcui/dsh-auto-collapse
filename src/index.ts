/**
 * dsh-auto-collapse — node half.
 */
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'dsh-auto-collapse'
export const inject: string[] = []

const DEFAULT_STATUS_TEXT = 'Deep sleeping...'
const DEFAULT_SUMMARY_FIELDS = 'duration,toolCalls,inputTokens,outputTokens,cacheReadTokens,cacheHitRate'
const AUTO_COLLAPSE_SETTINGS_NAMESPACE = settingsNamespace('dsh-auto-collapse')

const AUTO_COLLAPSE_SETTINGS_SCHEMA = z.object({
  statusText: z.string().default(DEFAULT_STATUS_TEXT),
  summaryFields: z.string().default(DEFAULT_SUMMARY_FIELDS),
})

export interface Config {
  statusText?: string
  summaryFields?: string
}

export function apply(ctx: any, config: Config = {}): void {
  let current = () => ({
    statusText: config.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: config.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
  })
  installSettingsSection(ctx, AUTO_COLLAPSE_SETTINGS_NAMESPACE, AUTO_COLLAPSE_SETTINGS_SCHEMA, {
    statusText: config.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: config.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
  }, {
    setSource: (source: () => { statusText: string; summaryFields: string }) => {
      current = source
    },
    onChange: () => {
      void current
    },
  })
}
