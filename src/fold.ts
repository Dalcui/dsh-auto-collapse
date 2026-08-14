/**
 * FoldController —— dsh-codex-fold 的核心。
 *
 * 把会话流（[data-chat-flow]）里的“非正文 display”折叠成内联的一行，
 * 折叠行实时显示**当前正在进行的工作**（与 Codex 对齐）：
 *
 *   - 块里有运行中的工具调用 → 标题 = "Running" + 工具名（Bash/Read/
 *     Search…，读 data-tool），摘要 = 正在执行的命令/路径/查询（读工具
 *     卡片的 summary 行）；标题与摘要带 **Deep diving 流光动画**（官方
 *     "Deep diving..." 运行状态行的 shimmer 配方），leading 三点跳动。
 *   - 块里正在思考（think running）→ 标题 = "Thinking"，摘要 = 思考的
 *     最新一行（读 [data-follow-end]，官方 ReasoningRow 的实时摘要锚点）。
 *   - 全部完成 → 标题 = 工具名列表（Bash · Read · Search），摘要 = (N)，
 *     leading 回到静态色块；出错 → 红色，中断 → 琥珀。
 *
 * 另外把官方 ChatView 尾部的运行状态行文字 "Deep diving..." 替换为
 * "Deep sleeping..."（始终生效；流光特效在 CSS 上，替换文本节点不影响）。
 * React 重渲染会恢复原文，pass() 每轮自愈改回。
 *
 * 点击一行展开，再点收起；折叠态下若有行被选中（详情联动）自动展开。
 *
 * 折叠规则（沿用 dsh-web-archive 验证过的算法）：每个回合合成一块——
 * 某条消息的 Think 推理组与其后紧跟的工具组合并成一块（只有 think 或
 * 只有工具组时各自成块），在块宿主**原位**插入 chip；带正文文本的消息
 * 断开合并。结构保持 文本a - [折叠块] - 文本b - 文本c。
 *
 * 与 React 的关系：chip 插入 React 管理的 flow 子树内，但只做前置插入与
 * style.display 切换（React 的 vdom diff 不会感知也不会清除 CSSOM 上的
 * 手动样式）；MutationObserver 每轮把结构变化合并到一次
 * requestAnimationFrame 里重放（自愈：React 重渲染、切换会话、流式新
 * 卡片都会自动跟上）。
 *
 * 零核心改动：不修改任何 slot 注册，不依赖任何 client 服务。
 */

const STYLE_ID = 'dshcf-style'

/** 工具名（data-tool 属性）→ 展示名，与官方 tool-call-model 的标题对齐。 */
const TOOL_LABELS: Record<string, string> = {
  bash: 'Bash',
  pwsh: 'Pwsh',
  read: 'Read',
  web_fetch: 'Read',
  web_search: 'Search',
  grep: 'Search',
  glob: 'Search',
  write: 'Write',
  edit: 'Edit',
  run_code: 'Code',
  cordis_package_inspect: 'Inspect',
  cordis_runtime_inspect: 'Inspect',
  cordis_run: 'Run',
  cordis_stop: 'Stop',
  cordis_undefine: 'Remove',
}

const CHIP_CSS = `
.dshcf-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--dsw-text-1, #f2f2f2);
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.dshcf-chip:hover {
  background: transparent;
}

/* leading：一个点。运行中 = 跳动（Codex 风格的进行指示）；静止 = 静态圆点。 */
.dshcf-chip .dshcf-leading {
  flex: none;
  display: flex;
  align-items: center;
  width: 8px;
  height: 8px;
}
.dshcf-chip .dshcf-leading i {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-caption, rgba(127, 127, 127, 0.55));
}
.dshcf-chip.running .dshcf-leading i {
  animation: dshcf-bounce 1.2s ease-in-out infinite;
  background: var(--dsw-static-deepseek-500, #4d6bfe);
}
@keyframes dshcf-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
  30% { transform: translateY(-3px); opacity: 1; }
}

/* 出错红 / 中断琥珀（静止态）。 */
.dshcf-chip.error:not(.running) .dshcf-leading i {
  background: var(--dsw-alias-state-error-primary, #e5484d);
}
.dshcf-chip.stopped:not(.running) .dshcf-leading i {
  background: var(--dsw-alias-state-warning-primary, #f5a524);
}

.dshcf-chip .dshcf-chip-title {
  flex: none;
  font-weight: 600;
}
.dshcf-chip .dshcf-chip-sep {
  flex: none;
  width: 2px;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption, rgba(127, 127, 127, 0.5));
}
.dshcf-chip .dshcf-chip-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-text-1, #f2f2f2);
}

@media (prefers-reduced-motion: reduce) {
  .dshcf-chip.running .dshcf-leading i { animation: none; }
}
`

/** 一个“折叠块”：think 消息（+ 其后紧跟的工具组）合成的一块。 */
interface Block {
  /** chip 插入处：think 消息元素（无 think 时是工具组元素）。 */
  host: HTMLElement
  /** 需要折叠/展开的行（推理块行 + 顶层工具卡片行）。 */
  rows: HTMLElement[]
  /** 需要随块折叠/展开的容器（工具组元素，避免折叠后残留空白）。 */
  containers: HTMLElement[]
}

/** 一行的实时摘要信息。 */
interface RowInfo {
  kind: 'tool' | 'think'
  label: string
  summary: string
  state: string
}

export class FoldController {
  private observer: MutationObserver | null = null
  private raf = 0
  private disposed = false

  private flow: HTMLElement | null = null
  /** host 元素 → 它的 chip（每个簇一张）。 */
  private chips = new Map<HTMLElement, HTMLButtonElement>()
  /** host 元素 → 展开状态（按流容器元素隔离，切换会话不串状态）。 */
  private expandedByHost = new WeakMap<HTMLElement, boolean>()
  /** 最近一轮 pass 见过的全部行（stop 时统一还原）。 */
  private allRows: HTMLElement[] = []
  /** host → 该块需要随折叠的容器（工具组元素）。 */
  private blockContainers = new Map<HTMLElement, HTMLElement[]>()

  start(): void {
    if (this.disposed) return
    injectStyle()
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-selected', 'data-state'],
    })
    this.schedule()
  }
  stop(): void {
    this.disposed = true
    if (this.raf !== 0) cancelAnimationFrame(this.raf)
    this.observer?.disconnect()
    // 还原所有被折叠的行/容器并移除全部 chip。
    applyRows(this.allRows, [...this.blockContainers.values()].flat(), true)
    for (const chip of this.chips.values()) chip.remove()
    this.chips.clear()
    removeStyle()
  }

  private schedule(): void {
    if (this.disposed || this.raf !== 0) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.pass()
    })
  }

  /** 一轮重放：重算堆积 → 应用折叠/展开 → 摆放并更新 chip → 替换状态行。 */
  private pass(): void {
    if (this.disposed) return

    const flow = findFlow()
    this.flow = flow
    if (flow === null) {
      // 没有会话流：清理全部 chip。
      for (const chip of this.chips.values()) chip.remove()
      this.chips.clear()
      return
    }

    const blocks = findBlocks(flow)
    const hosts = new Set<HTMLElement>()

    for (const block of blocks) {
      const { host, rows, containers } = block
      hosts.add(host)

      const expanded = this.expandedByHost.get(host) ?? false
      // 折叠态下若有行被选中（详情联动），自动展开该块。
      if (!expanded && rows.some(row => row.hasAttribute('data-selected'))) {
        this.expandedByHost.set(host, true)
      }
      const isExpanded = this.expandedByHost.get(host) ?? false

      applyRows(rows, containers, isExpanded)
      const chip = this.ensureChip(host)
      updateChip(chip, rows, isExpanded)
    }

    // 移除宿主已不在流里的陈旧 chip（自愈：React 重渲染换掉了宿主元素）。
    for (const [host, chip] of [...this.chips]) {
      if (!hosts.has(host) || !host.isConnected) {
        chip.remove()
        this.chips.delete(host)
      }
    }

    this.allRows = blocks.flatMap(b => b.rows)

    // 官方运行状态行 "Deep diving..." → "Deep sleeping..."（始终生效）。
    replaceTurnStatus()
  }

  /** 创建（或复用）宿主内部的折叠卡片。 */
  private ensureChip(host: HTMLElement): HTMLButtonElement {
    const existing = this.chips.get(host)
    if (existing !== undefined && existing.isConnected && existing.parentElement === host) {
      return existing
    }
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'dshcf-chip'
    chip.setAttribute('aria-expanded', 'false')
    const leading = document.createElement('span')
    leading.className = 'dshcf-leading'
    leading.appendChild(document.createElement('i'))
    chip.appendChild(leading)
    chip.appendChild(createSpan('dshcf-chip-title'))
    chip.appendChild(createSpan('dshcf-chip-sep'))
    chip.appendChild(createSpan('dshcf-chip-summary'))
    chip.addEventListener('click', () => {
      const host = chip.parentElement
      if (host === null) return
      const next = !(this.expandedByHost.get(host) ?? false)
      this.expandedByHost.set(host, next)
      applyRows(rowsOf(host), this.blockContainers.get(host) ?? [], next)
      updateChip(chip, rowsOf(host), next)
    })
    // 插到消息/工具组最前（与折叠掉的卡片同一位置）。
    host.prepend(chip)
    this.chips.set(host, chip)
    return chip
  }
}

/** host 当前的折叠行（click 时从 DOM 现取，避免闭包陈旧）。 */
function rowsOf(host: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = []
  const think = thinkRowsIn(host)
  const calls = callRowsIn(host)
  // 排除 chip 自身层级下的行（chip 是前置插入，不在 call/think 选择器内）。
  rows.push(...think, ...calls)
  return rows
}

function createSpan(cls: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = cls
  return span
}

/** 找到当前可见的会话流容器。 */
function findFlow(): HTMLElement | null {
  const flows = document.querySelectorAll<HTMLElement>('[data-chat-flow]')
  for (const flow of flows) {
    if (flow.offsetParent !== null || flow.getBoundingClientRect().width > 0) return flow
  }
  return flows[0] ?? null
}

/**
 * 收集流容器里的“折叠块”。规则：
 * - 堆积 = 工具组（工具卡片行）或纯 think 消息（推理块行、无正文文本）；
 * - **连续堆积合并成一块**；
 * - **带正文文本的消息（即使含 think 行）会断开合并**：它的 think 行先并入
 *   前面的块（无块则自成一块），然后正文文本作为分界；
 * - 纯文本消息直接断开；装饰元素（StreamingTail/TurnStatus/hints）不断开。
 * 结果：文本A - [折叠块] - 文本B - [折叠块] - 文本C。
 */
function findBlocks(flow: HTMLElement): Block[] {
  const blocks: Block[] = []
  const children: HTMLElement[] = [...flow.children].filter((el): el is HTMLElement => el instanceof HTMLElement)
  let run: Block | null = null

  for (const el of children) {
    const thinkRows = thinkRowsIn(el)
    const callRows = callRowsIn(el)
    const isToolPile = callRows.length > 0
    // 只有“纯 think 候选”才需要正文检测：工具组与装饰元素不消耗 walker。
    const hasText = !isToolPile && thinkRows.length > 0 ? hasBodyText(el) : false

    if (isToolPile || (thinkRows.length > 0 && !hasText)) {
      // 堆积（工具组 / 纯 think 消息）→ 并入当前块。
      if (run === null) {
        run = { host: el, rows: [], containers: [] }
        blocks.push(run)
      }
      run.rows.push(...thinkRows, ...callRows)
      // 工具组随块折叠；若工具组就是块宿主（chip 插在它内部），不能隐藏它。
      if (isToolPile && el !== run.host) {
        run.containers.push(el)
      }
    } else if (el.hasAttribute('data-chat-anchor-key')) {
      // 正文消息：think 先并入前面的块（无块则自成一块），然后断开合并。
      if (thinkRows.length > 0) {
        if (run === null) {
          run = { host: el, rows: [], containers: [] }
          blocks.push(run)
        }
        run.rows.push(...thinkRows)
      }
      run = null
    }
    // 装饰元素（无 anchor 且无行）不打断合并。
  }
  return blocks
}

/** 消息是否含正文文本：正文由 MarkdownText 渲染，但 CSS Modules 构建产物
 * 的类名是短哈希（如 uqINua_body），无法用类名字面量识别。改为文本节点
 * walker：折叠行（think 推理块 / 工具卡片）与插件自己的 chip 之外的任何
 * 非空文本都算正文——正文渲染的段落（p/pre/li 等）必然携带这些文本。 */
function hasBodyText(el: HTMLElement): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null) !== null) {
    if (node.data.trim() === '') continue
    const parent = node.parentElement
    if (parent !== null && parent.closest('[data-variant="think"], [data-chat-call-id], .dshcf-chip') !== null) continue
    return true
  }
  return false
}

/** 元素内的推理块行：[data-variant="think"] 且无 data-tool。 */
function thinkRowsIn(el: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = []
  for (const row of el.querySelectorAll<HTMLElement>('[data-variant="think"]:not([data-tool])')) {
    if (row.closest('[data-chat-call-id]') !== null) continue
    if (row.closest('[data-subcalls]') !== null) continue
    rows.push(row)
  }
  return rows
}

/** 元素内的顶层工具卡片行（排除 run_code 子派发行与嵌套行）。 */
function callRowsIn(el: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = []
  for (const row of el.querySelectorAll<HTMLElement>('[data-chat-call-id]')) {
    if (row.closest('[data-subcalls]') !== null) continue
    if (row.closest('[data-chat-call-id]') !== row) continue
    rows.push(row)
  }
  return rows
}

/** 折叠/展开：只切换 CSSOM display，React 不会覆盖。 */
function applyRows(rows: readonly HTMLElement[], containers: readonly HTMLElement[], expanded: boolean): void {
  for (const row of rows) {
    row.style.display = expanded ? '' : 'none'
  }
  for (const container of containers) {
    container.style.display = expanded ? '' : 'none'
  }
}

/** 一行 → 实时摘要信息（工具名/思考摘要/状态）。 */
function deriveRowInfo(row: HTMLElement): RowInfo {
  const state = row.getAttribute('data-state') ?? 'ok'
  const isThink = row.matches('[data-variant="think"]') && !row.hasAttribute('data-tool')
  if (isThink) {
    return { kind: 'think', label: 'Think', summary: thinkSummary(row), state }
  }
  const tool = row.getAttribute('data-tool') ?? ''
  const label = TOOL_LABELS[tool] ?? tool
  return { kind: 'tool', label: label !== '' ? label : 'Tool', summary: toolSummary(row), state }
}

/** Think 行摘要：优先官方 ReasoningRow 的实时摘要锚点 [data-follow-end]
 * （running 时是最新一行，完成后是第一行）。 */
function thinkSummary(row: HTMLElement): string {
  const follow = row.querySelector<HTMLElement>('[data-follow-end]')
  if (follow !== null) {
    const text = (follow.textContent ?? '').trim()
    if (text !== '') return text
  }
  return summaryFallback(row)
}

/** 工具行摘要：DisclosureRow 的结构里，summary 是 [data-disclosure-row]
 * 的最后一个直接子元素（leading → title → sep → summary），折叠态下展开
 * body 不在 DOM（{open && children}），keepContentWhenOpen 也保证该行在
 * 展开态时仍是 summary 收尾；因此直接取最后一个直接子元素的文本。 */
function toolSummary(row: HTMLElement): string {
  const drow = row.querySelector<HTMLElement>('[data-disclosure-row]')
  if (drow !== null && drow.lastElementChild !== null) {
    const text = (drow.lastElementChild.textContent ?? '').trim()
    if (text !== '') return text
  }
  return summaryFallback(row)
}

/** 兜底：文本 walker 取最长非空文本（跳过已展开的 body 子树，避免拿到
 * 输出内容；状态词/装饰都短于真正摘要，最长策略天然免疫）。 */
function summaryFallback(row: HTMLElement): string {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let best = ''
  let node: Text | null
  while ((node = walker.nextNode() as Text | null) !== null) {
    if (node.parentElement?.closest('[data-open="true"]') !== null) continue
    const text = node.data.trim()
    if (text === '') continue
    if (text.length > best.length) best = text
  }
  return best
}

interface BlockInfo {
  /** 第一个运行中的工具行（按 DOM 顺序）。 */
  runningTool: RowInfo | null
  /** 第一个运行中的思考行。 */
  runningThink: RowInfo | null
  /** 全部工具展示名（去重、保序）。 */
  tools: string[]
  count: number
  hasError: boolean
  hasStopped: boolean
}

function deriveBlockInfo(rows: readonly HTMLElement[]): BlockInfo {
  const infos = rows.map(deriveRowInfo)
  const runningTool = infos.find(i => i.kind === 'tool' && i.state === 'running') ?? null
  const runningThink = infos.find(i => i.kind === 'think' && i.state === 'running') ?? null
  const tools = [...new Set(infos.filter(i => i.kind === 'tool').map(i => i.label))]
  return {
    runningTool,
    runningThink,
    tools,
    count: rows.length,
    hasError: infos.some(i => i.state === 'error'),
    hasStopped: infos.some(i => i.state === 'stopped'),
  }
}

/** 刷新 chip 内容：实时反映当前正在进行的工作。 */
function updateChip(chip: HTMLButtonElement, rows: readonly HTMLElement[], expanded: boolean): void {
  const info = deriveBlockInfo(rows)
  const title = chip.querySelector<HTMLElement>('.dshcf-chip-title')
  const summary = chip.querySelector<HTMLElement>('.dshcf-chip-summary')
  if (title === null || summary === null) return

  const running = info.runningTool ?? info.runningThink
  let titleText: string
  let summaryText: string

  if (info.runningTool !== null) {
    // 正在调用工具：显示 "Running" + 工具名，摘要 = 正在执行的命令/参数。
    titleText = `Running ${info.runningTool.label}`
    summaryText = info.runningTool.summary
  } else if (info.runningThink !== null) {
    // 正在思考：显示思考的最新一行。
    titleText = 'Thinking'
    summaryText = info.runningThink.summary
  } else if (info.tools.length > 0) {
    // 全部完成：工具名列表 + 计数。
    titleText = info.tools.join(' · ')
    summaryText = `(${info.count})`
  } else {
    titleText = 'Think'
    summaryText = `(${info.count})`
  }

  if (expanded) summaryText = summaryText === '' ? '收起' : `${summaryText} · 收起`

  title.textContent = titleText
  summary.textContent = summaryText
  chip.setAttribute('aria-expanded', String(expanded))
  chip.title = expanded ? '收起这些卡片' : '展开这些卡片'
  chip.classList.toggle('running', running !== null)
  chip.classList.toggle('error', !running && info.hasError)
  chip.classList.toggle('stopped', !running && info.hasStopped && !info.hasError)
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CHIP_CSS
  document.head.appendChild(style)
}

/** 官方 ChatView 尾部的运行状态行：`<div role="status">Deep diving...`。
 * 把其中的文本节点 "Deep diving..." 替换为 "Deep sleeping..."，流光
 * 特效在 CSS 上（dsh-turn-status-shimmer），不受影响。React 重渲染会
 * 恢复原文，pass() 每轮自愈。 */
function replaceTurnStatus(): void {
  for (const status of document.querySelectorAll<HTMLElement>('[role="status"]')) {
    for (const node of status.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.data.includes('Deep diving')) {
        node.data = node.data.replace('Deep diving', 'Deep sleeping')
      }
    }
  }
}

function removeStyle(): void {
  document.getElementById(STYLE_ID)?.remove()
}
