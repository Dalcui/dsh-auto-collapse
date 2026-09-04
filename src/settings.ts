/**
 * dsh-auto-collapse — 插件配置卡片。
 */
import { AUTO_COLLAPSE_NS, DEFAULT_SUMMARY_FIELDS_STRING, DEFAULT_CODE_DESCRIPTION, DEFAULT_KEEP_LAST_ROWS } from './locales.ts'

export { AUTO_COLLAPSE_NS, DEFAULT_SUMMARY_FIELDS_STRING, DEFAULT_CODE_DESCRIPTION, DEFAULT_KEEP_LAST_ROWS }
export const DEFAULT_STATUS_TEXT = 'Deep sleeping...'

declare const require: (id: string) => any

export interface SettingsScopeLike {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value?: Record<string, unknown>
    base?: Record<string, unknown>
    user?: Record<string, unknown>
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

export interface SlotsLike {
  inject(key: string, callback: () => unknown): () => void
  register(
    options: { name: string; key: string; inject: () => unknown },
    renderer: (props: { scope: SettingsScopeLike }) => unknown,
  ): unknown
}

export function statusTextProvider(scope: SettingsScopeLike | undefined): () => string | undefined {
  return () => {
    if (scope === undefined) return DEFAULT_STATUS_TEXT
    const snapshot = scope.getSnapshot()
    const value = snapshot.value as { statusText?: string } | undefined
    return value?.statusText ?? DEFAULT_STATUS_TEXT
  }
}

export function summaryFieldsProvider(scope: SettingsScopeLike | undefined): () => string {
  return () => {
    if (scope === undefined) return DEFAULT_SUMMARY_FIELDS_STRING
    const snapshot = scope.getSnapshot()
    const value = snapshot.value as { summaryFields?: string } | undefined
    return value?.summaryFields ?? DEFAULT_SUMMARY_FIELDS_STRING
  }
}

export function codeDescriptionProvider(scope: SettingsScopeLike | undefined): () => string {
  return () => {
    if (scope === undefined) return DEFAULT_CODE_DESCRIPTION
    const snapshot = scope.getSnapshot()
    const value = snapshot.value as { codeDescription?: string } | undefined
    return value?.codeDescription ?? DEFAULT_CODE_DESCRIPTION
  }
}

export function keepLastRowsProvider(scope: SettingsScopeLike | undefined): () => number {
  return () => {
    if (scope === undefined) return DEFAULT_KEEP_LAST_ROWS
    const snapshot = scope.getSnapshot()
    const value = snapshot.value as { keepLastRows?: number } | undefined
    const raw = value?.keepLastRows
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : DEFAULT_KEEP_LAST_ROWS
    return n
  }
}

const CARD_CSS = `
.dshcf-settings-card {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  border-radius: 12px;
  list-style: none;
  transition: border-color .16s, background .16s;
}
.dshcf-settings-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.dshcf-settings-cardOpen {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
.dshcf-settings-header {
  appearance: none;
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: 0 0;
  border: 0;
  border-radius: 12px;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  display: flex;
}
.dshcf-settings-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dshcf-settings-headText { flex-direction: column; flex: 1; gap: 4px; min-width: 0; display: flex; }
.dshcf-settings-name { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; }
.dshcf-settings-description { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.5; }
.dshcf-settings-chevron { color: var(--dsw-alias-label-tertiary); flex: none; transition: transform .16s; }
.dshcf-settings-chevronOpen { transform: rotate(180deg); }
.dshcf-settings-pending {
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  border-radius: 999px;
  flex: none;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
}
.dshcf-settings-body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 16px; padding-bottom: 8px; }
.dshcf-settings-readOnly { color: var(--dsw-alias-label-tertiary); margin: 12px 0 0; font-size: 12px; line-height: 1.5; }
.dshcf-settings-field { flex-direction: column; gap: 6px; padding: 12px 0; display: flex; }
.dshcf-settings-fieldHead { align-items: center; gap: 8px; display: flex; }
.dshcf-settings-fieldLabel { min-width: 0; color: var(--dsw-alias-label-primary); flex: 1; font-size: 13px; font-weight: 500; line-height: 1.5; }
.dshcf-settings-badges { align-items: center; gap: 8px; display: inline-flex; }
.dshcf-settings-badge {
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
}
.dshcf-settings-reset { font: inherit; color: var(--dsw-alias-label-secondary); cursor: pointer; background: 0 0; border: none; padding: 0; font-size: 12px; line-height: 1.5; }
.dshcf-settings-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.dshcf-settings-reset:disabled { cursor: default; }
.dshcf-settings-input {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  height: 34px;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 0 12px;
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
  width: 100%;
}
.dshcf-settings-input:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
.dshcf-settings-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.dshcf-settings-hint { color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 1.5; }
.dshcf-settings-footer { border-top: 1px solid var(--dsw-alias-border-l2); justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 0 4px; display: flex; }
.dshcf-settings-failed { min-width: 0; color: var(--dsw-alias-label-error); flex: 1; margin: 0; font-size: 12px; line-height: 1.5; }
.dshcf-settings-discard,
.dshcf-settings-save { appearance: none; font: inherit; cursor: pointer; border: 1px solid #0000; border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5; }
.dshcf-settings-discard { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: 0 0; }
.dshcf-settings-discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
.dshcf-settings-save { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.dshcf-settings-discard:disabled,
.dshcf-settings-save:disabled { opacity: .4; cursor: default; }
.dshcf-settings-discard:focus-visible,
.dshcf-settings-save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`

const STYLE_ID = 'dshcf-settings-style'

function injectCardStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CARD_CSS
  document.head.appendChild(style)
}

function ChevronIcon(open: boolean): any {
  const React = require('react')
  const className = open ? 'dshcf-settings-chevron dshcf-settings-chevronOpen' : 'dshcf-settings-chevron'
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true, className },
    React.createElement('path', {
      d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
      fill: 'currentColor',
    }),
  )
}

function StatusTextCard(props: { scope: SettingsScopeLike }): any {
  const React = require('react')
  const scope = props.scope
  const [open, setOpen] = React.useState(false)
  const [snapshot, setSnapshot] = React.useState(scope.getSnapshot())
  const [statusPending, setStatusPending] = React.useState(null as { text: string; reset: boolean } | null)
  const [fieldsPending, setFieldsPending] = React.useState(null as { text: string; reset: boolean } | null)
  const [codePending, setCodePending] = React.useState(null as { value: string; reset: boolean } | null)
  const [rowsPending, setRowsPending] = React.useState(null as { value: string; reset: boolean } | null)
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope])

  if (snapshot.status !== 'ready') return null

  const value = snapshot.value as { statusText?: string; summaryFields?: string; codeDescription?: string; keepLastRows?: number } | undefined
  const base = snapshot.base as { statusText?: string; summaryFields?: string; codeDescription?: string; keepLastRows?: number } | undefined
  const user = snapshot.user as Record<string, unknown> | undefined
  
  // Status text state
  const currentText = value?.statusText ?? ''
  const defaultText = base?.statusText ?? DEFAULT_STATUS_TEXT
  const statusText = statusPending ? statusPending.text : currentText
  const userHasStatus = user !== undefined && Object.prototype.hasOwnProperty.call(user, 'statusText')
  const statusOverridden = statusPending ? !statusPending.reset : userHasStatus
  const statusDirty = statusPending !== null && (statusPending.reset ? userHasStatus : statusPending.text.trim() !== currentText)

  // Summary fields state
  const currentFields = value?.summaryFields ?? DEFAULT_SUMMARY_FIELDS_STRING
  const defaultFields = base?.summaryFields ?? DEFAULT_SUMMARY_FIELDS_STRING
  const fieldsText = fieldsPending ? fieldsPending.text : currentFields
  const userHasFields = user !== undefined && Object.prototype.hasOwnProperty.call(user, 'summaryFields')
  const fieldsOverridden = fieldsPending ? !fieldsPending.reset : userHasFields
  const fieldsDirty = fieldsPending !== null && (fieldsPending.reset ? userHasFields : fieldsPending.text.trim() !== currentFields)

  // Code description state
  const currentCode = value?.codeDescription ?? DEFAULT_CODE_DESCRIPTION
  const defaultCode = base?.codeDescription ?? DEFAULT_CODE_DESCRIPTION
  const codeValue = codePending ? codePending.value : currentCode
  const userHasCode = user !== undefined && Object.prototype.hasOwnProperty.call(user, 'codeDescription')
  const codeOverridden = codePending ? !codePending.reset : userHasCode
  const codeDirty = codePending !== null && (codePending.reset ? userHasCode : codePending.value !== currentCode)

  // Keep last rows state
  const currentRows = value?.keepLastRows ?? DEFAULT_KEEP_LAST_ROWS
  const defaultRows = base?.keepLastRows ?? DEFAULT_KEEP_LAST_ROWS
  const rowsText = rowsPending ? rowsPending.value : String(currentRows)
  const userHasRows = user !== undefined && Object.prototype.hasOwnProperty.call(user, 'keepLastRows')
  const rowsOverridden = rowsPending ? !rowsPending.reset : userHasRows
  const rowsDirty = rowsPending !== null && (rowsPending.reset ? userHasRows : rowsPending.value.trim() !== String(currentRows))

  const writable = snapshot.writable
  const dirty = statusDirty || fieldsDirty || codeDirty || rowsDirty
  const blocked = !dirty || saving

  const discard = () => {
    setStatusPending(null)
    setFieldsPending(null)
    setCodePending(null)
    setRowsPending(null)
    setFailed(false)
  }
  const resetStatus = () => {
    setStatusPending({ text: defaultText, reset: true })
    setFailed(false)
  }
  const editStatus = (next: string) => {
    setStatusPending({ text: next, reset: false })
    setFailed(false)
  }
  const resetFields = () => {
    setFieldsPending({ text: defaultFields, reset: true })
    setFailed(false)
  }
  const editFields = (next: string) => {
    setFieldsPending({ text: next, reset: false })
    setFailed(false)
  }
  const resetCode = () => {
    setCodePending({ value: defaultCode, reset: true })
    setFailed(false)
  }
  const editCode = (next: string) => {
    setCodePending({ value: next, reset: false })
    setFailed(false)
  }
  const resetRows = () => {
    setRowsPending({ value: String(defaultRows), reset: true })
    setFailed(false)
  }
  const editRows = (next: string) => {
    setRowsPending({ value: next, reset: false })
    setFailed(false)
  }
  const save = async () => {
    if (!dirty) return
    setSaving(true)
    setFailed(false)
    try {
      // Save status text
      if (statusPending !== null) {
        if (statusPending.reset) await scope.unset('statusText')
        else await scope.set('statusText', statusPending.text.trim())
        setStatusPending(null)
      }
      // Save summary fields
      if (fieldsPending !== null) {
        if (fieldsPending.reset) await scope.unset('summaryFields')
        else await scope.set('summaryFields', fieldsPending.text.trim())
        setFieldsPending(null)
      }
      // Save code description mode
      if (codePending !== null) {
        if (codePending.reset) await scope.unset('codeDescription')
        else await scope.set('codeDescription', codePending.value)
        setCodePending(null)
      }
      // Save keep-last-rows count
      if (rowsPending !== null) {
        if (rowsPending.reset) await scope.unset('keepLastRows')
        else {
          const n = Number(rowsPending.value.trim())
          await scope.set('keepLastRows', Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_KEEP_LAST_ROWS)
        }
        setRowsPending(null)
      }
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const cardClass = 'dshcf-settings-card' + (open ? ' dshcf-settings-cardOpen' : '')

  return React.createElement('li', { className: cardClass }, [
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dshcf-settings-header',
        'aria-expanded': open,
        'aria-label': (open ? '收起设置' : '展开设置') + ': dsh-auto-collapse',
        onClick: () => setOpen(!open),
      },
      [
        React.createElement('span', { className: 'dshcf-settings-headText' }, [
          React.createElement('span', { className: 'dshcf-settings-name' }, 'dsh-auto-collapse'),
          React.createElement('span', { className: 'dshcf-settings-description' }, '配置折叠行为和摘要栏显示指标'),
        ]),
        dirty ? React.createElement('span', { className: 'dshcf-settings-pending' }, '未保存') : null,
        ChevronIcon(open),
      ],
    ),
    open
      ? React.createElement('div', { className: 'dshcf-settings-body' }, [
          !writable
            ? React.createElement('p', { className: 'dshcf-settings-readOnly', role: 'status' }, '本部署的设置为只读。')
            : null,
          // Status text field
          React.createElement('div', { className: 'dshcf-settings-field' }, [
            React.createElement('div', { className: 'dshcf-settings-fieldHead' }, [
              React.createElement('label', { className: 'dshcf-settings-fieldLabel', htmlFor: 'dshcf-status-text' }, '状态提示词'),
              statusOverridden
                ? React.createElement('span', { className: 'dshcf-settings-badges' }, [
                    React.createElement('span', { className: 'dshcf-settings-badge' }, '已覆盖'),
                    React.createElement('button', { type: 'button', className: 'dshcf-settings-reset', disabled: !writable || saving, onClick: resetStatus }, '恢复默认'),
                  ])
                : null,
            ]),
            React.createElement('input', {
              id: 'dshcf-status-text',
              className: 'dshcf-settings-input',
              type: 'text',
              value: statusText,
              placeholder: 'Deep diving...',
              disabled: !writable || saving,
              onChange: (event: { target: { value: string } }) => editStatus(event.target.value),
            }),
            React.createElement('p', { className: 'dshcf-settings-hint' }, '为空时恢复默认Deep diving...提示词状态'),
          ]),
          // Summary fields field
          React.createElement('div', { className: 'dshcf-settings-field' }, [
            React.createElement('div', { className: 'dshcf-settings-fieldHead' }, [
              React.createElement('label', { className: 'dshcf-settings-fieldLabel', htmlFor: 'dshcf-summary-fields' }, '摘要栏指标'),
              fieldsOverridden
                ? React.createElement('span', { className: 'dshcf-settings-badges' }, [
                    React.createElement('span', { className: 'dshcf-settings-badge' }, '已覆盖'),
                    React.createElement('button', { type: 'button', className: 'dshcf-settings-reset', disabled: !writable || saving, onClick: resetFields }, '恢复默认'),
                  ])
                : null,
            ]),
            React.createElement('input', {
              id: 'dshcf-summary-fields',
              className: 'dshcf-settings-input',
              type: 'text',
              value: fieldsText,
              placeholder: DEFAULT_SUMMARY_FIELDS_STRING,
              disabled: !writable || saving,
              onChange: (event: { target: { value: string } }) => editFields(event.target.value),
            }),
            React.createElement('p', { className: 'dshcf-settings-hint' }, '逗号分隔字段名；字段名后可用 (自定义名) 覆盖显示名，如 inputTokens(输入上下文)；写空括号 () 表示只显示值、不显示任何文字，如 contextDelta()。可用字段：duration、toolCalls、modelCalls、inputTokens、contextDelta、outputTokens、reasoningTokens、cacheReadTokens、cacheWriteTokens、cacheHitRate、timeToFirstToken、tokensPerSecond'),
          ]),
          // Code description field
          React.createElement('div', { className: 'dshcf-settings-field' }, [
            React.createElement('div', { className: 'dshcf-settings-fieldHead' }, [
              React.createElement('label', { className: 'dshcf-settings-fieldLabel', htmlFor: 'dshcf-code-description' }, '工具调用说明'),
              codeOverridden
                ? React.createElement('span', { className: 'dshcf-settings-badges' }, [
                    React.createElement('span', { className: 'dshcf-settings-badge' }, '已覆盖'),
                    React.createElement('button', { type: 'button', className: 'dshcf-settings-reset', disabled: !writable || saving, onClick: resetCode }, '恢复默认'),
                  ])
                : null,
            ]),
            React.createElement('select', {
              id: 'dshcf-code-description',
              className: 'dshcf-settings-input',
              value: codeValue,
              disabled: !writable || saving,
              onChange: (event: { target: { value: string } }) => editCode(event.target.value),
            }, [
              React.createElement('option', { value: 'always' }, '始终显示'),
              React.createElement('option', { value: 'hover' }, '悬停时显示'),
              React.createElement('option', { value: 'never' }, '不显示'),
            ]),
            React.createElement('p', { className: 'dshcf-settings-hint' }, '完成态二级折叠行末尾「最后一次工具调用说明」（Code 的 description、Bash 的命令、Read/Grep 的路径等）的显示方式：始终显示 / 鼠标悬停时显示 / 不显示。'),
          ]),
          // Keep last rows field
          React.createElement('div', { className: 'dshcf-settings-field' }, [
            React.createElement('div', { className: 'dshcf-settings-fieldHead' }, [
              React.createElement('label', { className: 'dshcf-settings-fieldLabel', htmlFor: 'dshcf-keep-last-rows' }, '进行中保留行数'),
              rowsOverridden
                ? React.createElement('span', { className: 'dshcf-settings-badges' }, [
                    React.createElement('span', { className: 'dshcf-settings-badge' }, '已覆盖'),
                    React.createElement('button', { type: 'button', className: 'dshcf-settings-reset', disabled: !writable || saving, onClick: resetRows }, '恢复默认'),
                  ])
                : null,
            ]),
            React.createElement('input', {
              id: 'dshcf-keep-last-rows',
              className: 'dshcf-settings-input',
              type: 'number',
              min: 0,
              step: 1,
              value: rowsText,
              disabled: !writable || saving,
              onChange: (event: { target: { value: string } }) => editRows(event.target.value),
            }),
            React.createElement('p', { className: 'dshcf-settings-hint' }, '进行中的轮次中，最后 N 个系统提示行（思考 / 工具 / 上下文等非模型输出内容）不收入折叠，保留原生显示；默认 3，填 0 表示不保留任何系统行（含正在运行的行，全部折叠）。'),
          ]),
          React.createElement('div', { className: 'dshcf-settings-footer' }, [
            failed
              ? React.createElement('p', { className: 'dshcf-settings-failed', role: 'status' }, '本部署没有接受这些值，已保留供你修改。')
              : null,
            React.createElement('button', { type: 'button', className: 'dshcf-settings-discard', disabled: !dirty || saving, onClick: discard }, '放弃修改'),
            React.createElement('button', { type: 'button', className: 'dshcf-settings-save', disabled: blocked, onClick: save }, saving ? '保存中…' : '保存'),
          ]),
        ])
      : null,
  ])
}

export function setupSettingsCard(ctx: { slots: SlotsLike }, scope: SettingsScopeLike): () => void {
  injectCardStyle()
  return ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
    {
      name: 'settings.plugin.item',
      key: AUTO_COLLAPSE_NS,
      inject: () => ({ scope }),
    },
    StatusTextCard,
  ))
}
