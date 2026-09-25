/**
 * dsh-auto-collapse — 插件配置卡片。
 */
import { AUTO_COLLAPSE_NS, DEFAULT_SUMMARY_FIELDS_STRING, DEFAULT_CODE_DESCRIPTION, DEFAULT_KEEP_LAST_ROWS, DEFAULT_KEEP_LAST_BODY_STEPS } from './locales.ts'
import type { RemoteConfig } from './roster-constants.ts'

export { AUTO_COLLAPSE_NS, DEFAULT_SUMMARY_FIELDS_STRING, DEFAULT_CODE_DESCRIPTION, DEFAULT_KEEP_LAST_ROWS, DEFAULT_KEEP_LAST_BODY_STEPS }
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

/** 注册选项：兼容 keyed slot（0.1.7 之前）与 list slot（0.1.7+ plugins.item）。 */
export interface SlotRegisterOptions {
  name: string
  /** keyed slot 的单元格键（0.1.7 之前的 settings.plugin.item）。 */
  key?: string
  /** list slot 的条目 id（0.1.7+ 的 plugins.item）。 */
  id?: string
  /** list slot 的排序位。 */
  order?: number
  /** list slot 的卡片标题；字符串或惰性求值函数（SlotLabel）。 */
  label?: string | (() => string)
  inject: () => unknown
}

export interface SlotsLike {
  inject(key: string, callback: () => unknown): () => void
  register(options: SlotRegisterOptions, renderer: (props: any) => unknown): unknown
}

/** configForms 服务的最小结构化类型（0.1.7+ 的 whileServed 门禁）。 */
export interface ConfigFormsLike {
  get(entryId: string): unknown
  /** 仅在宿主服务了给定命名空间之一时执行注册；返回结束监听的 disposer。 */
  whileServed?(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
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

export function keepLastBodyStepsProvider(scope: SettingsScopeLike | undefined): () => number {
  return () => {
    if (scope === undefined) return DEFAULT_KEEP_LAST_BODY_STEPS
    const snapshot = scope.getSnapshot()
    const value = snapshot.value as { keepLastBodySteps?: number } | undefined
    const raw = value?.keepLastBodySteps
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : DEFAULT_KEEP_LAST_BODY_STEPS
    return n
  }
}

/**
 * 远程配置内存 store（R6）：看门狗每轮轮询写入 roster 响应里的 config
 * 真值，consumers（providers / 设置卡）经 wrapScopeWithRemote 读取。
 */
export interface RemoteConfigStore {
  get(): RemoteConfig | null
  set(config: RemoteConfig | null): boolean
  subscribe(listener: () => void): () => void
}

/** RemoteConfig 的 5 字段浅比较（sanitize 产物无 undefined 字段值，
 * === 即可区分缺失与显式值）。看门狗每轮 poll 都新造对象，按内容去重
 * 才能避免每 1.5s 一次无意义通知（桌面页会因此每轮全量 fold pass）。 */
function sameRemoteConfig(a: RemoteConfig | null, b: RemoteConfig | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return (
    a.statusText === b.statusText &&
    a.summaryFields === b.summaryFields &&
    a.codeDescription === b.codeDescription &&
    a.keepLastRows === b.keepLastRows &&
    a.keepLastBodySteps === b.keepLastBodySteps
  )
}

export function createRemoteConfigStore(): RemoteConfigStore {
  let current: RemoteConfig | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(config) {
      if (sameRemoteConfig(current, config)) return false
      current = config
      for (const listener of [...listeners]) listener()
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * 把 settingsScope 包装成「scope 优先、远程真值兜底」的合成 scope（R6）：
 * - 内层 scope 快照 ready（桌面回环页面的 host 持久化）→ 原样透传，保持
 *   可写、实时；
 * - 内层 scope 不可用/加载中（远程非回环页面被 DSH 强制 memory）且远程
 *   配置已到达 → 返回 ready 快照：value=远程真值、writable=false（只读，
 *   set/unset 静默 no-op，不开放远程写通道）；
 * - 两者都无 → 保持原快照（unavailable），consumer 回退默认值。
 *
 * subscribe 合并双源：任一变化都会通知（远程配置到达时 FoldController /
 * 设置卡自动 refresh，无需整页重载）。
 */
export function wrapScopeWithRemote(scope: SettingsScopeLike | undefined, remote: RemoteConfigStore): SettingsScopeLike {
  const derive = () => {
    const inner = scope?.getSnapshot()
    if (inner !== undefined && inner.status === 'ready') return inner
    const remoteValue = remote.get()
    if (remoteValue !== null) {
      return {
        status: 'ready' as const,
        value: remoteValue as unknown as Record<string, unknown>,
        base: inner?.base,
        user: undefined,
        writable: false,
      }
    }
    return inner ?? {
      status: 'unavailable' as const,
      value: undefined,
      base: undefined,
      user: undefined,
      writable: false,
    }
  }
  const writableInner = () => scope !== undefined && scope.getSnapshot().status === 'ready'
  return {
    getSnapshot: derive,
    subscribe(listener) {
      const offRemote = remote.subscribe(listener)
      const offScope = scope?.subscribe(listener)
      return () => {
        offRemote()
        offScope?.()
      }
    },
    set(field, value) {
      if (writableInner()) return scope!.set(field, value)
      return Promise.resolve()
    },
    unset(field) {
      if (writableInner()) return scope!.unset(field)
      return Promise.resolve()
    },
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
/* 0.1.7+ plugins.item 的 summary 视图：插件页卡片里的一行说明。 */
.dshcf-settings-summary { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }
/* 宿主未服务本命名空间时的 page 视图文案（避免点开即空白）。 */
.dshcf-settings-unavailable { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; }
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

/** 设置卡片的字段操作：与 0.1.7+ SettingsPathOpView 同形（path 固定单字段）。 */
export type FieldOp =
  | { op: 'set'; field: string; value: unknown }
  | { op: 'unset'; field: string }

/**
 * 卡片数据源：归一化两代设置契约。
 * - 0.1.7+（plugins.item）：值经 owner props 的 form.state 传入、由插件页持有
 *   刷新，写入走 form.mutate(ops, revision) 一次性原子提交；
 * - 0.1.7 之前（settings.plugin.item）：scope 经 inject 面传入、组件自订阅，
 *   写入逐字段 set/unset（旧服务没有批量接口）。
 */
/** 设置快照（SettingsScopeLike.getSnapshot 的返回形状，可选带 revision 栅栏）。 */
export type SettingsSnapshotLike = ReturnType<SettingsScopeLike['getSnapshot']> & { revision?: number }

export interface CardSource {
  getSnapshot(): SettingsSnapshotLike
  commit(ops: readonly FieldOp[]): Promise<boolean>
}

/** 0.1.7+ ConfigPageForm 的最小结构化类型（不静态 import 宿主类型）。 */
export interface ConfigPageFormLike {
  state: SettingsSnapshotLike
  mutate(ops: readonly unknown[], expectedRevision?: number): Promise<boolean>
}

function toPathOp(op: FieldOp): { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] } {
  return op.op === 'set' ? { op: 'set', path: [op.field], value: op.value } : { op: 'unset', path: [op.field] }
}

export function cardSourceFromForm(form: ConfigPageFormLike): CardSource {
  return {
    getSnapshot: () => form.state,
    commit: (ops) => form.mutate(ops.map(toPathOp), form.state?.revision),
  }
}

export function cardSourceFromScope(scope: SettingsScopeLike): CardSource {
  return {
    getSnapshot: () => scope.getSnapshot(),
    commit: async (ops) => {
      // 旧服务没有批量接口、也没有「宿主是否接受」的返回值。这里按可写性判定：
      // 只读 / 未就绪时旧 set/unset 是静默 no-op，若仍返回 true，卡片会清空
      // pending 并让用户以为保存成功——返回 false 走失败文案更诚实。
      if (!scope.getSnapshot().writable) return false
      for (const op of ops) {
        if (op.op === 'set') await scope.set(op.field, op.value)
        else await scope.unset(op.field)
      }
      return true
    },
  }
}

/** 0.1.7+ plugins.item 的 owner props。 */
interface PluginItemProps {
  /** summary 渲染卡片一行说明；page 渲染配置表单。 */
  view?: 'summary' | 'page'
  /** Host 持有的配置值与写入动作（仅 page 视图提供）。 */
  form?: ConfigPageFormLike
}

/** 0.1.7 之前 settings.plugin.item 经 inject 面传入的 scope。 */
interface LegacyCardProps {
  scope?: SettingsScopeLike
}

function AutoCollapseCard(props: PluginItemProps & LegacyCardProps): any {
  const React = require('react')
  const legacyScope = props.scope
  const form = props.form
  const [, forceRender] = React.useState(0)
  const [open, setOpen] = React.useState(false)
  const [statusPending, setStatusPending] = React.useState(null as { text: string; reset: boolean } | null)
  const [fieldsPending, setFieldsPending] = React.useState(null as { text: string; reset: boolean } | null)
  const [codePending, setCodePending] = React.useState(null as { value: string; reset: boolean } | null)
  const [rowsPending, setRowsPending] = React.useState(null as { value: string; reset: boolean } | null)
  const [bodyStepsPending, setBodyStepsPending] = React.useState(null as { value: string; reset: boolean } | null)
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  // 旧契约自订阅；新契约由插件页刷新 form.state（props 变化）触发重渲染。
  React.useEffect(() => {
    if (legacyScope === undefined) return undefined
    return legacyScope.subscribe(() => forceRender((n: number) => n + 1))
  }, [legacyScope])

  // summary 视图只渲染卡片的一行说明，不依赖设置值是否就绪。
  if (props.view === 'summary') {
    return React.createElement('span', { className: 'dshcf-settings-summary' }, '配置折叠行为与摘要栏显示指标')
  }

  const source = form !== undefined ? cardSourceFromForm(form) : legacyScope !== undefined ? cardSourceFromScope(legacyScope) : undefined
  const snapshot = source?.getSnapshot()
  if (source === undefined || snapshot === undefined || snapshot.status !== 'ready') {
    // page 视图下拿不到 form（宿主没服务该命名空间：entry id 不符、schema 无
    // volatile 字段等）时给一行文案，避免插件页出现「点开即空白」的卡片。
    // 旧契约保持 null —— 外层本来就由父级决定是否渲染。
    if (props.view === 'page' && form === undefined) {
      return React.createElement('p', { className: 'dshcf-settings-unavailable', role: 'status' }, '当前部署未提供该插件的可写配置。')
    }
    return null
  }

  const value = snapshot.value as { statusText?: string; summaryFields?: string; codeDescription?: string; keepLastRows?: number; keepLastBodySteps?: number } | undefined
  const base = snapshot.base as { statusText?: string; summaryFields?: string; codeDescription?: string; keepLastRows?: number; keepLastBodySteps?: number } | undefined
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

  // Keep last body steps state
  const currentBodySteps = value?.keepLastBodySteps ?? DEFAULT_KEEP_LAST_BODY_STEPS
  const defaultBodySteps = base?.keepLastBodySteps ?? DEFAULT_KEEP_LAST_BODY_STEPS
  const bodyStepsText = bodyStepsPending ? bodyStepsPending.value : String(currentBodySteps)
  const userHasBodySteps = user !== undefined && Object.prototype.hasOwnProperty.call(user, 'keepLastBodySteps')
  const bodyStepsOverridden = bodyStepsPending ? !bodyStepsPending.reset : userHasBodySteps
  const bodyStepsDirty = bodyStepsPending !== null && (bodyStepsPending.reset ? userHasBodySteps : bodyStepsPending.value.trim() !== String(currentBodySteps))

  const writable = snapshot.writable
  const dirty = statusDirty || fieldsDirty || codeDirty || rowsDirty || bodyStepsDirty
  const blocked = !dirty || saving

  const discard = () => {
    setStatusPending(null)
    setFieldsPending(null)
    setCodePending(null)
    setRowsPending(null)
    setBodyStepsPending(null)
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
  const resetBodySteps = () => {
    setBodyStepsPending({ value: String(defaultBodySteps), reset: true })
    setFailed(false)
  }
  const editBodySteps = (next: string) => {
    setBodyStepsPending({ value: next, reset: false })
    setFailed(false)
  }
  /** 收集本次待提交的字段操作（只含用户真正改动的字段）。 */
  const collectOps = (): FieldOp[] => {
    const ops: FieldOp[] = []
    if (statusPending !== null) {
      ops.push(statusPending.reset
        ? { op: 'unset', field: 'statusText' }
        : { op: 'set', field: 'statusText', value: statusPending.text.trim() })
    }
    if (fieldsPending !== null) {
      ops.push(fieldsPending.reset
        ? { op: 'unset', field: 'summaryFields' }
        : { op: 'set', field: 'summaryFields', value: fieldsPending.text.trim() })
    }
    if (codePending !== null) {
      ops.push(codePending.reset
        ? { op: 'unset', field: 'codeDescription' }
        : { op: 'set', field: 'codeDescription', value: codePending.value })
    }
    if (rowsPending !== null) {
      const n = Number(rowsPending.value.trim())
      ops.push(rowsPending.reset
        ? { op: 'unset', field: 'keepLastRows' }
        : { op: 'set', field: 'keepLastRows', value: Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_KEEP_LAST_ROWS })
    }
    if (bodyStepsPending !== null) {
      const n = Number(bodyStepsPending.value.trim())
      ops.push(bodyStepsPending.reset
        ? { op: 'unset', field: 'keepLastBodySteps' }
        : { op: 'set', field: 'keepLastBodySteps', value: Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_KEEP_LAST_BODY_STEPS })
    }
    return ops
  }
  const clearPending = (): void => {
    setStatusPending(null)
    setFieldsPending(null)
    setCodePending(null)
    setRowsPending(null)
    setBodyStepsPending(null)
  }
  const save = async () => {
    if (!dirty) return
    setSaving(true)
    setFailed(false)
    // 0.1.7+ 走一次原子 mutate（全部字段共用同一 revision 栅栏）；旧契约由
    // cardSourceFromScope 逐字段转发。只有被接受时才清空待提交状态，被拒绝
    // 或抛错时保留用户输入供重试。
    const ops = collectOps()
    if (ops.length === 0) {
      setSaving(false)
      return
    }
    try {
      const accepted = await source.commit(ops)
      if (accepted === false) {
        setFailed(true)
        return
      }
      clearPending()
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  // 表单主体：0.1.7+ 的 page 视图直接渲染它（外层卡片与标题由插件页提供）；
  // 旧契约把它放进自带的 disclosure 卡片里。
  const body = React.createElement('div', { className: 'dshcf-settings-body' }, [
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
            React.createElement('p', { className: 'dshcf-settings-hint' }, '逗号分隔字段名；字段名后可用 (自定义名) 覆盖显示名，如 inputTokens(输入上下文)；写空括号 () 表示只显示值、不显示任何文字，如 contextDelta()。可用字段：duration、toolCalls、modelCalls、retryCalls、inputTokens、contextDelta、outputTokens、reasoningTokens、cacheReadTokens、cacheWriteTokens、cacheHitRate、timeToFirstToken、tokensPerSecond'),
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
            React.createElement('p', { className: 'dshcf-settings-hint' }, '进行中的轮次中，最后 N 个系统提示行（思考 / 工具 / 上下文 / 重试·失败·输出上限等状态提示行）不收入折叠，保留原生显示；默认 3，填 0 表示不保留任何系统行（含正在运行的行，全部折叠）。'),
          ]),
          // Keep last body steps field
          React.createElement('div', { className: 'dshcf-settings-field' }, [
            React.createElement('div', { className: 'dshcf-settings-fieldHead' }, [
              React.createElement('label', { className: 'dshcf-settings-fieldLabel', htmlFor: 'dshcf-keep-last-body-steps' }, '轮次折叠保留正文条数'),
              bodyStepsOverridden
                ? React.createElement('span', { className: 'dshcf-settings-badges' }, [
                    React.createElement('span', { className: 'dshcf-settings-badge' }, '已覆盖'),
                    React.createElement('button', { type: 'button', className: 'dshcf-settings-reset', disabled: !writable || saving, onClick: resetBodySteps }, '恢复默认'),
                  ])
                : null,
            ]),
            React.createElement('input', {
              id: 'dshcf-keep-last-body-steps',
              className: 'dshcf-settings-input',
              type: 'number',
              min: 0,
              step: 1,
              value: bodyStepsText,
              disabled: !writable || saving,
              onChange: (event: { target: { value: string } }) => editBodySteps(event.target.value),
            }),
            React.createElement('p', { className: 'dshcf-settings-hint' }, '每个轮次折叠时，最后 N 条正文文本不收入轮次折叠、保留显示（默认 1，即只保留最终正文）；填 0 时除最后一个轮次外，其余轮次的全部正文（含最终正文）都折叠进轮次行。最后一个轮次始终至少保留 1 条正文。'),
          ]),
          React.createElement('div', { className: 'dshcf-settings-footer' }, [
            failed
              ? React.createElement('p', { className: 'dshcf-settings-failed', role: 'status' }, '本部署没有接受这些值，已保留供你修改。')
              : null,
            React.createElement('button', { type: 'button', className: 'dshcf-settings-discard', disabled: !dirty || saving, onClick: discard }, '放弃修改'),
            React.createElement('button', { type: 'button', className: 'dshcf-settings-save', disabled: blocked, onClick: save }, saving ? '保存中…' : '保存'),
          ]),
        ])

  // 0.1.7+ page 视图：插件页已提供卡片与标题，这里只交出表单本体。
  if (props.view === 'page') return body

  // 0.1.7 之前的 keyed 契约：自带 disclosure 卡片（标题行 + 展开态）。
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
    open ? body : null,
  ])
}

/**
 * 注册插件配置卡片。
 *
 * 两代 slot 各注册一次；当前版本不存在的那个只是回调永不触发，不报错
 * （slots.inject 对未声明的 slot 不派发）：
 * - 0.1.7+：`plugins.item`（插件页「官方」分组的卡片；点开走 view=page）。
 *   owner props 直接携带 { view, form }，无需 inject 面。
 * - 0.1.7 之前：`settings.plugin.item`（设置 → 插件 → 插件配置），scope 经
 *   inject 面传入。
 *
 * 返回的 disposer 逐项防御，任一清理抛错不中断其余（HMR 可逆还原）。
 */
export function setupSettingsCard(
  ctx: { slots: SlotsLike; configForms?: ConfigFormsLike },
  scope: SettingsScopeLike,
): () => void {
  injectCardStyle()
  const disposers: Array<() => void> = []
  const push = (dispose: unknown): void => {
    if (typeof dispose === 'function') disposers.push(dispose as () => void)
  }
  const register = (key: string, options: SlotRegisterOptions): void => {
    try {
      push(ctx.slots.inject(key, () => ctx.slots.register(options, AutoCollapseCard) as unknown as () => void))
    } catch (error) {
      console.error(`[dsh-auto-collapse] settings card register failed (${key}; fold continues)`, error)
    }
  }
  // 0.1.7+：list slot，id/order/label 由注册方提供，值经 owner props 的 form 传入。
  const registerItem = (): void => register('plugins.item', {
    name: 'plugins.item',
    id: AUTO_COLLAPSE_NS,
    order: 90,
    label: 'dsh-auto-collapse',
    inject: () => ({}),
  })
  // 官方做法：只在宿主真的服务了本命名空间时才把卡片挂进插件页。命名空间改名、
  // schema 无可写字段等情况下干脆不出现，而不是出现一张点开才说没配置的卡片。
  const configForms = ctx.configForms
  if (configForms !== undefined && typeof configForms.whileServed === 'function') {
    try {
      push(configForms.whileServed([AUTO_COLLAPSE_NS], () => {
        registerItem()
        // whileServed 的 register 需返回「本次注册」的 disposer；registerItem
        // 已把 disposer 推进 disposers，这里返回空清理避免重复释放。
        return () => {}
      }))
    } catch (error) {
      console.error('[dsh-auto-collapse] settings card gate failed (falling back to unconditional)', error)
      registerItem()
    }
  } else {
    registerItem()
  }
  // 0.1.7 之前：keyed slot，key 为设置命名空间，scope 经 inject 面传入。
  register('settings.plugin.item', {
    name: 'settings.plugin.item',
    key: AUTO_COLLAPSE_NS,
    inject: () => ({ scope }),
  })
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (error) {
        console.error('[dsh-auto-collapse] settings card cleanup failed (continuing)', error)
      }
    }
  }
}
