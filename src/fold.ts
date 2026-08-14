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
  font: 400 13px/22px system-ui, -apple-system, "Segoe UI", sans-serif;
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.dshcf-chip:hover {
  background: transparent;
}

/* leading：终端小方块图标（素材 Codex 对齐：方框 + >_ 提示符）。运行中跳动。 */
.dshcf-chip .dshcf-leading {
  flex: none;
  display: flex;
  align-items: center;
  width: 14px;
  height: 12px;
}
.dshcf-chip .dshcf-leading svg {
  display: block;
  width: 12px;
  height: 10px;
  color: var(--dsw-alias-label-caption, rgba(127, 127, 127, 0.6));
}
.dshcf-chip.running .dshcf-leading svg {
  animation: dshcf-bounce 1.2s ease-in-out infinite;
  color: var(--dsw-static-deepseek-500, #4d6bfe);
}
@keyframes dshcf-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
  30% { transform: translateY(-3px); opacity: 1; }
}

/* 出错红 / 中断琥珀（静止态）。 */
.dshcf-chip.error:not(.running) .dshcf-leading svg {
  color: var(--dsw-alias-state-error-primary, #e5484d);
}
.dshcf-chip.stopped:not(.running) .dshcf-leading svg {
  color: var(--dsw-alias-state-warning-primary, #f5a524);
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
/* 摘要不撑满（flex 0 1），让 chevron 紧跟在文本右方而非行尾。 */
.dshcf-chip .dshcf-chip-summary {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 折叠行文字：次级灰（素材 Codex 对齐：暗灰一档），区别于正文纯白。 */
.dshcf-chip .dshcf-chip-title {
  color: rgba(255, 255, 255, 0.62);
}
.dshcf-chip .dshcf-chip-summary {
  color: rgba(255, 255, 255, 0.55);
}
/* 工具行摘要（命令/路径）等宽字体 + 代码衬底（素材 Codex 同款）。 */
.dshcf-chip[data-kind="tool"] .dshcf-chip-summary {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
  font-size: 12px;
  line-height: 20px;
  background: rgba(127, 127, 127, 0.14);
  border-radius: 4px;
  padding: 0 6px;
}
.dshcf-chip[data-kind="tool"] .dshcf-chip-summary:empty {
  background: none;
  padding: 0;
}

/* "已处理"行：最终输出出现后工作过程整体隐藏，只留这一行 + 时长。 */
.dshcf-processed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border: none;
  background: none;
  font: 400 12px/20px system-ui, -apple-system, "Segoe UI", sans-serif;
  /* 素材 Codex 对齐：暗灰 #858585 一档的次要层级。 */
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
}
.dshcf-processed:hover {
  color: var(--dsw-text-1, #f2f2f2);
  background: var(--dsw-alias-bg-3, rgba(127, 127, 127, 0.13));
}
.dshcf-processed:focus-visible {
  outline: 2px solid var(--dsw-alias-state-focus-ring, rgba(77, 107, 254, 0.8));
  outline-offset: 2px;
}
.dshcf-processed .dshcf-processed-check {
  /* 素材 Codex 对齐：勾与文字同为暗灰，不引入彩色。 */
  color: currentColor;
}
/* "已处理"行右侧小箭头（常驻，素材 Codex 同款：紧贴文本、可点击展开/收起）。 */
.dshcf-processed .dshcf-processed-chevron {
  flex: none;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  opacity: 0.55;
  transition: transform 0.25s ease, opacity 0.1s ease;
}
.dshcf-processed:hover .dshcf-processed-chevron {
  opacity: 0.9;
}
.dshcf-processed[aria-expanded="true"] .dshcf-processed-chevron {
  transform: rotate(45deg);
}

/* chevron：默认隐藏，hover/focus 浮现，展开时旋转 90°（Codex 同款）。 */
.dshcf-chip .dshcf-chevron {
  flex: none;
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  opacity: 0.5; /* 常驻可见（素材 Codex 同款），hover 加深 */
  transition: opacity 0.1s ease, transform 0.25s ease;
}
.dshcf-chip:hover .dshcf-chevron,
.dshcf-chip:focus-visible .dshcf-chevron,
.dshcf-chip[aria-expanded="true"] .dshcf-chevron {
  opacity: 0.9;
}
.dshcf-chip[aria-expanded="true"] .dshcf-chevron {
  transform: rotate(45deg);
}
.dshcf-chip:focus-visible {
  outline: 2px solid var(--dsw-alias-state-focus-ring, rgba(77, 107, 254, 0.8));
  outline-offset: 2px;
  border-radius: 4px;
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

/** "已处理"行控制的工作过程信息。 */
interface ProcessedEntry {
  /** 被收起的块宿主集合（think 消息 / 工具卡消息）。 */
  hosts: Set<HTMLElement>
  /** 回合内中间正文消息（assistant-step + 正文，非最终输出）——整条折叠。 */
  middleSteps: Set<HTMLElement>
  /** 回合耗时（ms），无数据时不显示。 */
  duration?: number
  /** 行挂载的正文节点（最终输出消息，自愈重建时找插入位置）。 */
  bodyNode: HTMLElement
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
  private timer = 0
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
  /** 行 → 进入 running 的时间戳（完成态时长用）。 */
  private rowStarts = new WeakMap<HTMLElement, number>()
  /** host → 该块全部完成后的固定耗时（ms），新一轮运行会重置。 */
  private blockElapsed = new Map<HTMLElement, number>()
  /** 已见过的正文消息元素：新正文（模型最终输出）出现时收起工作过程。 */
  private seenBodyNodes = new WeakSet<HTMLElement>()
  /** 已整体隐藏的块宿主（工作过程收进 "已处理" 行）。 */
  private hiddenHosts = new WeakSet<HTMLElement>()
  /** 已被某个 "已处理" 行认领的块宿主（每块只收一次，展开/收起不影响）。 */
  private claimedHosts = new WeakSet<HTMLElement>()
  /** 中间正文消息（assistant-step，非最终输出）→ 属于哪个 entry（整条折叠用）。
   * 强引用 Map：WeakMap 的键可能在 pass 间被 GC，导致折叠状态丢失。 */
  private middleByHost = new Map<HTMLElement, ProcessedEntry>()
  /** "已处理"行 → 它控制的块宿主、时长与挂载点（自愈重建用）。 */
  private processedRows = new Map<HTMLElement, ProcessedEntry>()
  /** 本轮最早开始运行的时间戳（"已处理"时长用）。 */
  private turnStartMs: number | null = null

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
    if (this.timer !== 0) clearTimeout(this.timer)
    this.observer?.disconnect()
    // 还原所有被折叠/隐藏的行、容器与宿主，移除全部 chip 和 "已处理" 行。
    applyRows(this.allRows, [...this.blockContainers.values()].flat(), true)
    for (const host of this.middleByHost.keys()) host.style.display = ''
    this.middleByHost.clear()
    for (const [host, chip] of this.chips) {
      host.style.display = ''
      chip.remove()
    }
    this.chips.clear()
    for (const row of this.processedRows.keys()) row.remove()
    this.processedRows.clear()
    this.blockElapsed.clear()
    removeStyle()
  }

  private schedule(): void {
    if (this.disposed || this.raf !== 0) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.pass()
    })
    // 后台 tab 的 rAF 会被浏览器挂起（冻结后 this.raf 永非 0，后续
    // schedule 全部被吞，插件假死）：setTimeout 兜底，保证 pass 一定执行。
    if (this.timer !== 0) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = 0
      if (this.raf !== 0) {
        this.raf = 0
        this.pass()
      }
    }, 60)
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

    // 新 anchor 出现 → 对回合边界（turn-tail / 新 user 消息）逐个尝试收尾。
    // 一次性 seen 全部新 anchor（防幽灵触发：历史会话一次性渲染大量消息时，
    // 若每帧只消耗第一个，点击展开会在下一帧被残余 anchor 重新收起并插
    // 重复行）。回合边界 = 回合尾时间戳（turn-tail）或下一回合用户消息
    // （user，兜底）；assistant-step（含过程正文）不是回合边界，不会提前
    // 收起进行中的块。
    for (const anchor of takeNewAnchors(flow, this.seenBodyNodes)) {
      if (isTurnEnd(anchor)) this.processTurn(blocks, anchor)
    }
    // 自愈：被 React 重渲染清掉的 "已处理" 行重新挂载并重绑点击，
    // 保证工作过程永远可以再次展开。
    this.healProcessedRows(flow)

    for (const block of blocks) {
      const { host, rows, containers } = block
      hosts.add(host)

      if (this.hiddenHosts.has(host)) {
        // 中间正文消息（assistant-step，非最终输出）：整条折叠（素材 Codex
        // 对齐：收起态只留最终输出，过程正文一并隐藏）。
        if (this.middleByHost.has(host)) {
          host.style.display = 'none'
        } else {
          applyRows(rows, containers, false)
          const chip = this.chips.get(host)
          if (chip !== undefined) chip.style.display = 'none'
          // 正文消息节点永不可隐藏（含旧版本误隐藏的自愈复位）——最终输出
          // 消息的 think 行并入块，宿主是正文本身，绝不能藏。
          if (host.hasAttribute('data-chat-anchor-key')) {
            host.style.display = ''
          } else {
            host.style.display = 'none'
          }
        }
        continue
      }
      host.style.display = ''

      const expanded = this.expandedByHost.get(host) ?? false
      // 折叠态下若有行被选中（详情联动），自动展开该块。
      if (!expanded && rows.some(row => row.hasAttribute('data-selected'))) {
        this.expandedByHost.set(host, true)
      }
      const isExpanded = this.expandedByHost.get(host) ?? false

      applyRows(rows, containers, isExpanded)
      const chip = this.ensureChip(host)
      chip.style.display = ''
      updateChip(chip, rows, isExpanded, this.trackElapsed(host, rows))
    }

    // 移除宿主已不在流里的陈旧 chip（自愈：React 重渲染换掉了宿主元素）。
    for (const [host, chip] of [...this.chips]) {
      if (!hosts.has(host) || !host.isConnected) {
        chip.remove()
        this.chips.delete(host)
      }
    }

    // 中间正文消息（不在 blocks 里的纯正文 assistant-step）：整条折叠/展开。
    // 遍历 processedRows（Set 强引用），不依赖 WeakMap 键的 GC 行为。
    for (const [, entry] of this.processedRows) {
      for (const host of entry.middleSteps) {
        if (!host.isConnected) continue
        if (this.hiddenHosts.has(host)) {
          if (host.style.display !== 'none') host.style.display = 'none'
        } else if (host.style.display === 'none') {
          host.style.display = ''
        }
      }
    }

    this.allRows = blocks.flatMap(b => b.rows)

    // 官方运行状态行 "Deep diving..." → "Deep sleeping..."（始终生效）。
    replaceTurnStatus()
  }

  /**
   * 回合收尾：回合边界（turn-tail / user）出现时，把边界之前、未被任何
   * "已处理" 行认领、且全部完成的块收进一个 "已处理" 行。
   *
   * - 最终输出消息（回合内最后一个 assistant-step + 正文）：只折叠它的
   *   think 行，正文保留可见；
   * - 中间正文消息（非最终 assistant-step）与上下文注入（kind=context）：
   *   整条折叠（过程正文隐藏，素材 Codex 对齐：收起态只留最终输出）；
   * - think 消息 / 工具卡：行折叠（现有逻辑）。
   *
   * 行插在回合第一个工作内容之前（用户消息之后、工作流程最上方），
   * 展开态与 Codex 素材一致：摘要行置顶，下方是完整工作流程。
   *
   * claimedHosts 保证每块只认领一次：用户展开/收起只动 hiddenHosts，已认领
   * 的块不会因后续新消息出现而被重复收起、也不会生成重复行。
   * 时长 = 本轮最早运行开始 → 本次收尾（历史回合从 turn-tail 解析）。
   */
  private processTurn(blocks: Block[], boundary: HTMLElement): void {
    const scope = blocks.filter(
      b =>
        !this.claimedHosts.has(b.host) &&
        isAtOrBefore(b.host, boundary) &&
        b.rows.every(r => rowState(r) !== 'running'),
    )
    if (scope.length === 0) return

    // 回合内工作消息：assistant-step（有正文）与 context 注入。注意：纯正文
    // assistant-step（无 think 行）与 context 注入不在 blocks 里，需独立收集。
    const steps: HTMLElement[] = []
    const contexts: HTMLElement[] = []
    let firstWork: HTMLElement | null = null
    const flow = boundary.parentElement
    if (flow !== null) {
      const kidsArr = Array.from(flow.children)
      const bIdx = kidsArr.indexOf(boundary)
      // 行插入点：boundary 前最后一个 user/steering 之后、回合第一个工作消息前。
      // 无 user（回合 1 场景）时取 flow 第一个 anchor 消息。
      let turnStart = -1
      for (let i = bIdx - 1; i >= 0; i--) {
        const kind = kidsArr[i].getAttribute('data-chat-flow-kind')
        if (kind === 'user' || kind === 'steering') {
          turnStart = i
          break
        }
      }
      for (let i = turnStart + 1; i < bIdx; i++) {
        const el = kidsArr[i]
        if (el.hasAttribute('data-chat-anchor-key') && !el.classList.contains('dshcf-processed')) {
          firstWork = el
          break
        }
      }
      for (const el of flow.children) {
        if (!(el instanceof HTMLElement)) continue
        if (el === boundary) break
        const kind = el.getAttribute('data-chat-flow-kind')
        if (kind === 'assistant-step' && hasBodyText(el)) steps.push(el)
        else if (kind === 'context') contexts.push(el)
      }
    }
    const finalStep = steps.length > 0 ? steps[steps.length - 1] : null
    const middleSteps = new Set(
      [...steps.slice(0, -1), ...contexts].filter(h => !this.claimedHosts.has(h)),
    )

    const duration = this.turnStartMs !== null
      ? Date.now() - this.turnStartMs
      : parseTurnDuration(boundary)
    this.turnStartMs = null

    // 最终输出也标记 claimed：纯正文最终输出（无 think 行）不在 blocks 里，
    // 若不认领会被后续回合的收尾当成"中间消息"整条隐藏。
    if (finalStep !== null) this.claimedHosts.add(finalStep)

    const hosts = new Set(scope.map(b => b.host))
    for (const host of hosts) {
      this.claimedHosts.add(host)
      this.hiddenHosts.add(host)
    }
    for (const h of middleSteps) {
      this.claimedHosts.add(h)
      this.hiddenHosts.add(h)
    }

    // 行插入点：回合第一个工作内容前（无内容时最终输出前，再无则边界前）。
    const anchor = firstWork ?? finalStep ?? boundary
    const entry: ProcessedEntry = { hosts, middleSteps, duration, bodyNode: anchor }
    for (const h of middleSteps) this.middleByHost.set(h, entry)
    anchor.before(this.createProcessedRow(entry))
  }

  /** 创建 "已处理" 行并绑定展开/收起。 */
  private createProcessedRow(entry: ProcessedEntry): HTMLButtonElement {
    const row = createProcessedRowElement(entry.duration)
    row.addEventListener('click', () => {
      const all = [...entry.hosts, ...entry.middleSteps]
      const anyVisible = all.some(h => h.isConnected && !this.hiddenHosts.has(h))
      if (anyVisible) {
        for (const h of all) this.hiddenHosts.add(h)
        row.setAttribute('aria-expanded', 'false')
        row.title = '展开工作过程'
      } else {
        for (const h of all) {
          this.hiddenHosts.delete(h)
          // 展开 = 直接显示工作明细（素材 Codex 一致），而非只恢复 chip 折叠态。
          this.expandedByHost.set(h, true)
        }
        row.setAttribute('aria-expanded', 'true')
        row.title = '收起工作过程'
      }
      this.schedule()
    })
    this.processedRows.set(row, entry)
    return row
  }

  /** 自愈：重建被 React 清掉的 "已处理" 行（原挂载点失效时按块位置找
   * 后面的正文节点，再不行挂到流末尾），并剔除已断开的块宿主。 */
  private healProcessedRows(flow: HTMLElement): void {
    for (const [row, entry] of [...this.processedRows]) {
      if (row.isConnected) continue
      this.processedRows.delete(row)
      for (const h of [...entry.hosts]) {
        if (!h.isConnected) entry.hosts.delete(h)
      }
      for (const h of [...entry.middleSteps]) {
        if (!h.isConnected) entry.middleSteps.delete(h)
        else this.middleByHost.set(h, entry)
      }if (entry.hosts.size === 0) continue

      let target: HTMLElement | null = entry.bodyNode.isConnected
        ? entry.bodyNode
        : findBodyAfter(flow, entry.hosts)
      if (target === null) target = flow
      const rebuilt = this.createProcessedRow(entry)
      if (target === flow) target.prepend(rebuilt)
      else target.before(rebuilt)
    }
  }

  /**
   * 块级耗时追踪（Codex 完成态 "Worked for {duration}" 的对齐）：
   * - 行首次进入 running 时记录开始时间；
   * - 块内存在 running 行 → 视为新一轮运行，清除旧的固定时长；
   * - 块全部完成后固定耗时 = 当前时间 − 最早开始时间（只算 running 过的行；
   *   此后不再更新，除非块重新运行）。
   */
  private trackElapsed(host: HTMLElement, rows: readonly HTMLElement[]): number | undefined {
    const now = Date.now()
    let anyRunning = false
    for (const row of rows) {
      if (rowState(row) === 'running') {
        anyRunning = true
        if (!this.rowStarts.has(row)) this.rowStarts.set(row, now)
        // 回合级计时起点：本轮最早开始运行的行。
        if (this.turnStartMs === null) this.turnStartMs = now
      }
    }
    if (anyRunning) {
      this.blockElapsed.delete(host)
      return undefined
    }
    const starts = rows
      .map(row => this.rowStarts.get(row))
      .filter((v): v is number => v !== undefined)
    if (starts.length === 0 || this.blockElapsed.has(host)) {
      return this.blockElapsed.get(host)
    }
    const elapsed = now - Math.min(...starts)
    this.blockElapsed.set(host, elapsed)
    return elapsed
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
    leading.appendChild(createTerminalIcon())
    chip.appendChild(leading)
    chip.appendChild(createSpan('dshcf-chip-title'))
    chip.appendChild(createSpan('dshcf-chip-sep'))
    chip.appendChild(createSpan('dshcf-chip-summary'))
    chip.appendChild(createSpan('dshcf-chevron'))
    chip.addEventListener('click', () => {
      const host = chip.parentElement
      if (host === null) return
      const next = !(this.expandedByHost.get(host) ?? false)
      this.expandedByHost.set(host, next)
      const rows = rowsOf(host)
      applyRows(rows, this.blockContainers.get(host) ?? [], next)
      updateChip(chip, rows, next, this.blockElapsed.get(host))
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

/** 终端小方块图标（素材 Codex 对齐：方框 + >_ 提示符）。 */
function createTerminalIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 12 10')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '10')
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', '0.5')
  rect.setAttribute('y', '0.5')
  rect.setAttribute('width', '11')
  rect.setAttribute('height', '9')
  rect.setAttribute('rx', '1.5')
  rect.setAttribute('fill', 'none')
  rect.setAttribute('stroke', 'currentColor')
  const prompt = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  prompt.setAttribute('x', '2')
  prompt.setAttribute('y', '7.5')
  prompt.setAttribute('font-size', '7')
  prompt.setAttribute('fill', 'currentColor')
  prompt.textContent = '>_'
  svg.append(rect, prompt)
  return svg
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

/** 一行 → 实时摘要信息（工具名/思考摘要/状态）。工具行的 data-tool 与
 * data-state 在内层 [data-tool] root 上（外层 callRow 只有 class /
 * data-chat-anchor-key / data-chat-call-id），需向下查一层。 */
function deriveRowInfo(row: HTMLElement): RowInfo {
  const isThink = row.matches('[data-variant="think"]') && !row.hasAttribute('data-tool')
  if (isThink) {
    return { kind: 'think', label: 'Think', summary: thinkSummary(row), state: row.getAttribute('data-state') ?? 'ok' }
  }
  const root = row.querySelector<HTMLElement>('[data-tool]') ?? row
  const tool = root.getAttribute('data-tool') ?? ''
  const state = root.getAttribute('data-state') ?? 'ok'
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
function updateChip(
  chip: HTMLButtonElement,
  rows: readonly HTMLElement[],
  expanded: boolean,
  elapsedMs?: number,
): void {
  const info = deriveBlockInfo(rows)
  const title = chip.querySelector<HTMLElement>('.dshcf-chip-title')
  const summary = chip.querySelector<HTMLElement>('.dshcf-chip-summary')
  const sep = chip.querySelector<HTMLElement>('.dshcf-chip-sep')
  if (title === null || summary === null) return

  const running = info.runningTool ?? info.runningThink
  let titleText: string
  let summaryText: string

  if (info.runningTool !== null) {
    // 正在调用工具（素材 Codex 对齐）："正在运行" + 命令/参数。
    titleText = '正在运行'
    summaryText = info.runningTool.summary
  } else if (info.runningThink !== null) {
    // 正在思考：显示思考的最新一行。
    titleText = '正在思考'
    summaryText = info.runningThink.summary
  } else if (info.tools.length > 0) {
    // 全部完成（素材 Codex 对齐）："运行了命令"，信息在展开态明细里。
    titleText = '运行了命令'
    summaryText = ''
  } else {
    // 纯 think 块完成：与 "正在思考" 配对。
    titleText = '已思考'
    summaryText = ''
  }

  if (expanded) summaryText = summaryText === '' ? '收起' : `${summaryText} · 收起`

  if (sep !== null) sep.style.display = summaryText === '' ? 'none' : ''

  title.textContent = titleText
  summary.textContent = summaryText
  chip.setAttribute('aria-expanded', String(expanded))
  chip.dataset.kind = running !== null ? running.kind : info.tools.length > 0 ? 'tool' : 'think'
  chip.title = expanded ? '收起这些卡片' : '展开这些卡片'
  chip.classList.toggle('running', running !== null)
  chip.classList.toggle('error', !running && info.hasError)
  chip.classList.toggle('stopped', !running && info.hasStopped && !info.hasError)
}

/** 收集流里所有未 seen 的 anchor 消息元素并全部标记 seen，返回新出现的
 * 列表。正文消息 = 顶层带 data-chat-anchor-key 的元素。一次性 seen 全部
 * 防止"幽灵 anchor"：若每帧只消耗第一个，历史会话/重渲染留下的大量未
 * seen anchor 会在用户展开折叠块后被逐帧触发 processTurn，导致块被重新
 * 收起并插入重复的 "已处理" 行。 */
function takeNewAnchors(flow: HTMLElement, seen: WeakSet<HTMLElement>): HTMLElement[] {
  const fresh: HTMLElement[] = []
  for (const el of flow.children) {
    if (!(el instanceof HTMLElement)) continue
    if (!el.hasAttribute('data-chat-anchor-key')) continue
    if (seen.has(el)) continue
    seen.add(el)
    fresh.push(el)
  }
  return fresh
}

/** 回合边界标记：回合尾时间戳（turn-tail）、下一回合用户消息（user）或
 * 运行中指导消息（steering）。assistant-step（含过程正文）不是回合边界——
 * 过程正文属于回合中间内容，不能提前收起进行中的块。 */
function isTurnEnd(anchor: HTMLElement): boolean {
  const kind = anchor.getAttribute('data-chat-flow-kind')
  return kind === 'turn-tail' || kind === 'user' || kind === 'steering'
}

/** 回合内最后一个有正文的 assistant-step 消息 = 最终输出（正文保留，
 * 行插它前面）。boundary 之前的 assistant-step 且 hasBodyText，取 DOM
 * 顺序最后一个；无则返回 null。 */

/** 从回合尾时间戳消息解析官方耗时（"用时 33秒" / "用时 2分05秒"），
 * 历史会话加载时 turnStartMs 无数据，用它补上 "已处理 {时长}"。 */
function parseTurnDuration(boundary: HTMLElement): number | undefined {
  const text = boundary.textContent ?? ''
  const m = text.match(/用时\s*(\d+)分(\d+)秒|用时\s*(\d+)秒/)
  if (m === null) return undefined
  if (m[1] !== undefined && m[2] !== undefined) return Number(m[1]) * 60000 + Number(m[2]) * 1000
  if (m[3] !== undefined) return Number(m[3]) * 1000
  if (m[1] !== undefined) return Number(m[1]) * 1000
  return undefined
}

/** host 是否在 bodyNode 之前（或就是它）。二者都是 flow 顶层子元素。 */
function isAtOrBefore(host: HTMLElement, bodyNode: HTMLElement): boolean {
  const flow = bodyNode.parentElement
  if (flow === null) return host === bodyNode
  for (const el of flow.children) {
    if (el === host) return true
    if (el === bodyNode) return false
  }
  return host === bodyNode
}

/** 行的运行状态：工具行的 data-state 在内层 [data-tool] root 上（外层
 * callRow 只有 class/anchor/call-id），think 行在自身。 */
function rowState(row: HTMLElement): string {
  if (row.matches('[data-variant="think"]') && !row.hasAttribute('data-tool')) {
    return row.getAttribute('data-state') ?? 'ok'
  }
  const root = row.querySelector<HTMLElement>('[data-tool]') ?? row
  return root.getAttribute('data-state') ?? 'ok'
}

/** 创建 "已处理 {时长}" 行元素（右侧小箭头，点击行为由控制器绑定）。 */
function createProcessedRowElement(duration?: number): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'dshcf-processed'
  btn.setAttribute('aria-expanded', 'false')
  const check = document.createElement('span')
  check.className = 'dshcf-processed-check'
  check.textContent = '✓'
  const text = document.createElement('span')
  text.textContent = duration !== undefined ? `已处理 ${formatDuration(duration)}` : '已处理'
  const chevron = document.createElement('span')
  chevron.className = 'dshcf-processed-chevron'
  btn.append(check, text, chevron)
  btn.title = '展开工作过程'
  return btn
}

/** 找流容器里位于给定块宿主之后（按 DOM 顺序）的第一个正文消息节点。 */
function findBodyAfter(flow: HTMLElement, hosts: ReadonlySet<HTMLElement>): HTMLElement | null {
  let afterAll = false
  for (const el of flow.children) {
    if (!(el instanceof HTMLElement)) continue
    if (hosts.has(el)) {
      afterAll = true
      continue
    }
    if (afterAll && el.hasAttribute('data-chat-anchor-key')) return el
  }
  return null
}

/** 毫秒 → 中文紧凑时长（素材 Codex 对齐：14秒 / 2分05秒）。 */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}分${String(r).padStart(2, '0')}秒`
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
