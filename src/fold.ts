/**
 * FoldController —— dsh-auto-collapse 的核心。
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
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 24px;
  /* chip 插在块宿主（flowItem）内，享受不到行的 row-gap 16px；
     展开态补 margin-bottom 对齐行间节奏；收起态行已隐藏，若仍补
     margin 会与块间 gap 叠加成 32px，所以收起态为 0。 */
  margin-bottom: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.dshcf-chip[aria-expanded="true"],
.dshcf-chip.dshcf-has-body {
  margin-bottom: 16px;
}
.dshcf-chip:hover {
  background: transparent;
}

/* leading：固定 14x14（思考块 = 原生 think 图标；工具块 = 原生 command
   图标 IconApiOutline14，克隆自真实 GenericCommandCard leading，找不到时
   退回终端小方块），行高 24px 与原生行对齐；运行中跳动。svg 尺寸由各自
   width/height 属性决定（command 14x14、think 14x14、终端 12x10 兜底），
   不在此处强制。 */
.dshcf-chip .dshcf-leading {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
.dshcf-chip .dshcf-leading svg {
  display: block;
  color: var(--dsw-alias-label-tertiary);
}
.dshcf-chip.running .dshcf-leading svg {
  animation: dshcf-bounce 1.2s ease-in-out infinite;
  color: var(--dsw-static-deepseek-500, #4d6bfe);
}
@keyframes dshcf-bounce {
  0%, 100% { transform: scale(1); opacity: 0.45; }
  50% { transform: scale(1.2); opacity: 1; }
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
  font-weight: 400;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
/* running 摘要：跟随滚动显示最新内容（text-overflow: clip，原生同款）。 */
.dshcf-chip.running .dshcf-chip-summary {
  text-overflow: clip;
}
/* 折叠行文字：复用 DSH 原生 label token（工具行同源），区别于正文纯白。 */
.dshcf-chip .dshcf-chip-title {
  color: var(--dsw-alias-label-primary);
}
.dshcf-chip .dshcf-chip-summary {
  color: var(--dsw-alias-label-tertiary);
}
/* 工具行摘要（命令/路径）等宽字体 + 代码衬底（素材 Codex 同款）。
   行高与 chip 一致（24px），流式更新时摘要单行 ellipsis 不换行不撑高。 */
.dshcf-chip[data-kind="tool"] .dshcf-chip-summary {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
  font-size: 12px;
  line-height: 24px;
  background: rgba(127, 127, 127, 0.14);
  border-radius: 4px;
  padding: 0 6px;
}
.dshcf-chip[data-kind="tool"] .dshcf-chip-summary:empty {
  background: none;
  padding: 0;
}

/* "已处理"行：最终输出出现后工作过程整体隐藏，只留这一行 + 时长。
   字体与二级 chip 对齐（14px/24px），左右无内边距（与正文左缘对齐）。 */
.dshcf-processed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border: none;
  background: none;
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  /* 对齐 DSH 原生工具行摘要的次级层级（label-tertiary）。 */
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
}
.dshcf-processed:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-3, rgba(127, 127, 127, 0.13));
  /* hover 背景从正文左缘开始：负 margin 向左扩 4px，padding 右推 4px
     把文本顶回原位（宽度不变，无布局位移）。 */
  margin: 0 -4px;
  padding: 2px 4px;
}
.dshcf-processed:focus-visible {
  outline: 2px solid var(--dsw-alias-state-focus-ring, rgba(77, 107, 254, 0.8));
  outline-offset: 2px;
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

/* 三级合并思考行：展开二级后连续思考合并为一行（标题 = 第一行思考内容）。
   样式与 chip 同族（16px 图标盒、14px/24px、原生 label token 色）。 */
.dshcf-merged-think {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.dshcf-merged-think .dshcf-leading {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
.dshcf-merged-think .dshcf-leading svg {
  display: block;
  color: var(--dsw-alias-label-tertiary);
}
.dshcf-merged-think .dshcf-merged-title {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 85%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-weight: 400;
}
.dshcf-merged-think .dshcf-chevron {
  flex: none;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  opacity: 0.55;
  color: var(--dsw-alias-label-secondary);
  transition: transform 0.2s ease;
}
.dshcf-merged-think[aria-expanded="true"] .dshcf-chevron {
  transform: rotate(45deg);
}
/* 合并思考内容块：四个思考合并为一个整体（对齐图标右侧缩进）。 */
.dshcf-merged-body {
  margin: 0 0 16px;
  padding-left: 22px;
  color: var(--dsw-alias-label-secondary);
  font: 400 13px/22px system-ui, -apple-system, "Segoe UI", sans-serif;
  white-space: pre-wrap;
  word-break: break-word;
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
  .dshcf-chip.running .dshcf-leading svg { animation: none; }
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
  /** chip → 它管理的行/容器（click 时从块绑定取，避免多 chip 同 host 时
   * rowsOf(host) 把正文后的行也卷进来）。 */
  private chipBlocks = new WeakMap<HTMLButtonElement, { rows: HTMLElement[]; containers: HTMLElement[] }>()
  /** chip → 状态 key（anchor ?? host），展开状态/容器/耗时按块独立。 */
  private chipKeys = new WeakMap<HTMLButtonElement, HTMLElement>()
  /** host → 三级合并思考行（展开二级后连续思考合并显示为一个三级行）。 */
  private mergedThinks = new Map<HTMLElement, HTMLButtonElement>()
  /** 合并思考行的展开状态（true = 显示合并内容块）。 */
  private mergedExpanded = new WeakSet<HTMLElement>()
  /** 合并内容缓存（首次从原生行读取后保存，pass 重建内容块时不再重新展开原生行）。 */
  private mergedBodyTexts = new WeakMap<HTMLElement, string>()
  /** 合并行标题缓存（原生行展开态提取不到摘要时保持首次标题，不丢成“思考”）。 */
  private mergedTitles = new WeakMap<HTMLElement, string>()
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
  /** 已出现但尚有 running 行的回合边界；状态变更后继续尝试收尾。 */
  private pendingBoundaries = new Set<HTMLElement>()
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
  /** 被改写为 Deep sleeping 的原生状态文本，卸载时按节点恢复。 */
  private turnStatusTexts = new Map<Text, string>()

  start(): void {
    if (this.disposed) return
    injectStyle()
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-selected', 'data-state'],
      // 流式文本更新（React 改 text node 的 data）属于 characterData
      // mutation：不观察则二级摘要/滚动跟随只能靠偶发结构变化驱动，
      // 变成“隔几秒跳一次”。所有文本写入都有守卫（值不变不写），
      // 不会自激。
      characterData: true,
    })
    this.schedule()
  }
  stop(): void {
    this.disposed = true
    if (this.raf !== 0) cancelAnimationFrame(this.raf)
    if (this.timer !== 0) clearTimeout(this.timer)
    this.observer?.disconnect()
    for (const row of this.mergedThinks.values()) row.remove()
    this.mergedThinks.clear()
    // 还原所有被折叠/隐藏的行、容器与宿主，移除全部 chip 和 "已处理" 行。
    applyRows(this.allRows, [...this.blockContainers.values()].flat(), true)
    for (const host of this.middleByHost.keys()) host.style.display = ''
    // 一级折叠时整块隐藏的块宿主（可能从未可见、没有 chip）一并还原。
    for (const [, entry] of this.processedRows) {
      for (const h of entry.hosts) h.style.display = ''
    }
    this.middleByHost.clear()
    for (const [host, chip] of this.chips) {
      host.style.display = ''
      chip.remove()
    }
    this.chips.clear()
    for (const row of this.processedRows.keys()) row.remove()
    this.processedRows.clear()
    this.pendingBoundaries.clear()
    this.blockElapsed.clear()
    restoreTurnStatus(this.turnStatusTexts)
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
      if (isTurnEnd(anchor)) this.pendingBoundaries.add(anchor)
    }
    for (const boundary of [...this.pendingBoundaries]) {
      if (!boundary.isConnected || this.processTurn(blocks, boundary)) {
        this.pendingBoundaries.delete(boundary)
      }
    }
    // 自愈：被 React 重渲染清掉的 "已处理" 行重新挂载并重绑点击，
    // 保证工作过程永远可以再次展开。
    this.healProcessedRows(flow)

    for (const block of blocks) {
      const { host, rows, containers } = block
      hosts.add(host)
      // chip 的二级展开需要同时切换后续相邻工具组；三级
      // 单条命令 disclosure 的 open 状态由宿主原生 UI 继续管理。
      this.blockContainers.set(host, containers)

      if (this.hiddenHosts.has(host)) {
        // 中间正文消息（assistant-step，非最终输出）：整条折叠（素材 Codex
        // 对齐：收起态只留最终输出，过程正文一并隐藏）。
        this.removeMergedThink(host)
        if (this.middleByHost.has(host)) {
          if (host.style.display !== 'none') host.style.display = 'none'
        } else {
          applyRows(rows, containers, false)
          const chip = this.chips.get(host)
          if (chip !== undefined && chip.style.display !== 'none') chip.style.display = 'none'
          // 只保留真正有正文的宿主（最终输出消息）可见；非正文工具/think
          // 宿主整块隐藏。旧实现对所有 data-chat-anchor-key 宿主保持
          // display:''，空工具/think 宿主在 flex column gap 下各占一条
          // 空白，造成完成态 "已处理" 行与最终正文之间的巨大空隙。
          const hostDisplay = hasBodyText(host) ? '' : 'none'
          if (host.style.display !== hostDisplay) host.style.display = hostDisplay
        }
        continue
      }
      if (host.style.display !== '') host.style.display = ''

      const expanded = this.expandedByHost.get(host) ?? false
      // 折叠态下若有行被选中（详情联动），自动展开该块。
      if (!expanded && rows.some(row => row.hasAttribute('data-selected'))) {
        this.expandedByHost.set(host, true)
      }
      const isExpanded = this.expandedByHost.get(host) ?? false

      applyRows(rows, containers, isExpanded)
      // 连续思考块（≥2 行纯 think）：二级展开后合并显示为一个三级思考行
      // （标题 = 第一行思考内容），点击合并行再展开全部原始行。
      if (isExpanded && rows.length > 1 && rows.every(r => isThinkRow(r))) {
        this.syncMergedThink(host, rows)
      } else {
        this.removeMergedThink(host)
      }
      const chip = this.ensureChip(host)
      this.chipBlocks.set(chip, { rows, containers })
      this.chipKeys.set(chip, host)
      // 正文消息（think 折叠后正文仍在宿主内）：chip 收起态也要 16px
      // 下间距，避免与正文紧贴；纯堆积块收起态 0（避免与块间 gap 叠加）。
      chip.classList.toggle('dshcf-has-body', hasBodyText(host))
      if (chip.style.display !== '') chip.style.display = ''
      updateChip(chip, rows, isExpanded, this.trackElapsed(host, rows))
    }

    // 移除宿主已不在流里的陈旧 chip（自愈：React 重渲染换掉了宿主元素）。
    for (const [host, chip] of [...this.chips]) {
      if (!hosts.has(host) || !host.isConnected) {
        chip.remove()
        this.chips.delete(host)
        this.blockContainers.delete(host)
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
    replaceTurnStatus(this.turnStatusTexts)
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
  private processTurn(blocks: Block[], boundary: HTMLElement): boolean {
    const scope = blocks.filter(
      b => !this.claimedHosts.has(b.host) && isAtOrBefore(b.host, boundary),
    )
    // turn-tail / 新 user 消息可能先于最后一个工具的 done 状态到达。
    // 边界保留在 pendingBoundaries，由 data-state 变更触发后续 pass。
    if (scope.some(b => b.rows.some(r => rowState(r) === 'running'))) return false
    // 保持现有产品语义：完全没有 think/tool 的回合不生成一级摘要。
    if (scope.length === 0) return true

    // 回合内工作消息：assistant-step（有正文）与 context 注入。注意：纯正文
    // assistant-step（无 think 行）与 context 注入不在 blocks 里，需独立收集。
    const steps: HTMLElement[] = []
    const contexts: HTMLElement[] = []
    let firstWork: HTMLElement | null = null
    const flow = boundary.parentElement
    if (flow !== null) {
      const kidsArr = Array.from(flow.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement,
      )
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
        // 真实 DSH：过程 step 是 assistant-step，回合最终输出是 assistant
        //（finalNode kind='assistant'，含中断场景）。两者带正文的都收进
        // steps：最后一个（真实最终输出）只认领不折叠，其余（中间过程
        // 正文）整条折叠。只认 assistant-step 会把最后一个中间 step 误当
        // 最终输出，导致它的过程正文在完成态残留可见。
        if ((kind === 'assistant-step' || kind === 'assistant') && hasBodyText(el)) steps.push(el)
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
    return true
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
          // 一级展开只恢复可见性：绝对不要改 expandedByHost —— 二级命令
          // chip 保持收起态，三级原生 disclosure 状态不触发、不重置。
        }
        // 一级展开后所有二级一律重置为收起（展开状态不跨一级保留）。
        this.collapseAllChips()
        row.setAttribute('aria-expanded', 'true')
        row.title = '收起工作过程'
      }
      this.schedule()
    })
    this.processedRows.set(row, entry)
    return row
  }

  /** 连续思考合并行：插在第一个思考行前，标题用第一行思考内容；
   * 点击切换显示/隐藏全部原始思考行。 */
  private syncMergedThink(host: HTMLElement, rows: readonly HTMLElement[]): void {
    let row = this.mergedThinks.get(host)
    if (row === undefined || !row.isConnected) {
      row = document.createElement('button')
      row.type = 'button'
      row.className = 'dshcf-merged-think'
      row.setAttribute('aria-expanded', 'false')
      const leading = document.createElement('span')
      leading.className = 'dshcf-leading'
      leading.appendChild(createThinkIcon())
      const title = document.createElement('span')
      title.className = 'dshcf-merged-title'
      const chevron = document.createElement('span')
      chevron.className = 'dshcf-chevron'
      row.append(leading, title, chevron)
      const btn = row
      btn.addEventListener('click', () => {
        const next = !this.mergedExpanded.has(host)
        if (next) this.mergedExpanded.add(host)
        else this.mergedExpanded.delete(host)
        btn.setAttribute('aria-expanded', String(next))
        if (next) this.expandMergedBody(host, btn)
        else this.collapseMergedBody(host)
      })
      rows[0].before(row)
      this.mergedThinks.set(host, row)
      row = btn
    }
    const titleEl = row.querySelector<HTMLElement>('.dshcf-merged-title')
    if (titleEl !== null) {
      // 标题 = “Think · 第一句”（模仿原生 Think 行：title + 分隔 + summary）。
      // 提取不到（原生行展开态 follow-end 结构变化）时用缓存，保持不丢。
      let title = this.mergedTitles.get(host)
      if (title === undefined) {
        const first = truncateSummary(stripMarkdown(thinkSummary(rows[0])), 36)
        if (first !== '' && first !== '思考') {
          title = `Think · ${first}`
          this.mergedTitles.set(host, title)
        } else {
          title = '思考'
        }
      }
      if (titleEl.textContent !== title) titleEl.textContent = title
    }
    // 原生思考行始终隐藏：四级行不存在，内容由合并内容块承载。
    const expanded = this.mergedExpanded.has(host)
    if (row.getAttribute('aria-expanded') !== String(expanded)) row.setAttribute('aria-expanded', String(expanded))
    if (row.style.display !== '') row.style.display = ''
    for (const r of rows) {
      if (r.style.display !== 'none') r.style.display = 'none'
    }
    // 展开态且内容块缺失（React 重渲染清掉）→ 用缓存重建。
    if (expanded) this.ensureMergedBody(host, row, false)
  }

  /** 展开合并行：直接读各思考行文本合成内容块（不依赖原生行展开：
   * 程序化 click 不触发 React 展开，且后台 tab 的 rAF 不执行）。 */
  private expandMergedBody(host: HTMLElement, btn: HTMLButtonElement): void {
    const cached = this.mergedBodyTexts.get(host)
    if (cached !== undefined) {
      this.ensureMergedBody(host, btn, true)
      return
    }
    const parts = this.currentThinkRows(host)
      .map(r => r.textContent.replace(/^Think\s*/, '').trim())
      .filter(Boolean)
    if (parts.length === 0) return
    this.mergedBodyTexts.set(host, parts.join('\n\n'))
    this.ensureMergedBody(host, btn, true)
  }

  /** 创建/更新合并内容块（缓存优先，不重新展开原生行）。 */
  private ensureMergedBody(host: HTMLElement, btn: HTMLButtonElement, force: boolean): void {
    const cached = this.mergedBodyTexts.get(host)
    if (cached === undefined) return
    let body = btn.nextElementSibling
    if (body === null || !body.classList.contains('dshcf-merged-body')) {
      body = document.createElement('div')
      body.className = 'dshcf-merged-body'
      btn.after(body)
    }
    if (force || body.textContent !== cached) body.textContent = cached
  }

  /** 收起合并行：移除内容块（原生行保持隐藏）。 */
  private collapseMergedBody(host: HTMLElement): void {
    const btn = this.mergedThinks.get(host)
    if (btn !== undefined) {
      const body = btn.nextElementSibling
      if (body !== null && body.classList.contains('dshcf-merged-body')) body.remove()
    }
  }

  /** 当前宿主内的思考行（现取，React 重渲染后引用仍然有效）。 */
  private currentThinkRows(host: HTMLElement): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('[data-variant="think"]:not([data-tool])')].filter(
      r => r.closest('[data-chat-call-id]') === null && r.closest('[data-subcalls]') === null,
    )
  }

  /** 移除合并思考行（二级收起 / 一级收起时），恢复行由 applyRows 控制。
   * 合并内容块（btn 的兄弟节点）一并移除，避免宿主展开后残留文本。 */
  private removeMergedThink(host: HTMLElement): void {
    const row = this.mergedThinks.get(host)
    if (row !== undefined) {
      const body = row.nextElementSibling
      if (body !== null && body.classList.contains('dshcf-merged-body')) body.remove()
      row.remove()
      this.mergedThinks.delete(host)
    }
    this.mergedExpanded.delete(host)
    this.mergedBodyTexts.delete(host)
  }

  /** 一级展开后的重置：所有二级 chip 收起（行隐藏、状态清零、文案刷新）。 */
  private collapseAllChips(): void {
    for (const chip of this.chips.values()) {
      const k = this.chipKeys.get(chip)
      if (k === undefined) continue
      this.expandedByHost.delete(k)
      const { rows, containers } = this.chipBlocks.get(chip) ?? { rows: [], containers: [] }
      applyRows(rows, containers, false)
      if (chip.getAttribute('aria-expanded') !== 'false') chip.setAttribute('aria-expanded', 'false')
      chip.title = '展开这些卡片'
      updateChip(chip, rows, false, undefined)
    }
    // 合并思考行与二级展开状态一起重置。
    for (const host of [...this.mergedThinks.keys()]) {
      this.removeMergedThink(host)
    }
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
      }
      if (entry.hosts.size === 0 && entry.middleSteps.size === 0) continue

      let target: HTMLElement | null = entry.bodyNode.isConnected
        ? entry.bodyNode
        : findBodyAfter(flow, entry.hosts)
      // 块宿主全断开但中间正文（context / 过程 step）仍存活：以第一个存活
      // 的中间正文为锚点重建行，保住 middleSteps 的展开/收起恢复通道。
      if (target === null) {
        const alive = [...entry.middleSteps].find(h => h.isConnected)
        target = alive ?? null
      }
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
    // 占位图标：首次 updateChip 时 syncLeadingIcon 会按块类型换成原生
    // think/command 图标（带 data-dshcf-icon），之后 kind 不变不再替换。
    leading.appendChild(createTerminalIcon())
    chip.appendChild(leading)
    chip.appendChild(createSpan('dshcf-chip-title'))
    chip.appendChild(createSpan('dshcf-chip-sep'))
    chip.appendChild(createSpan('dshcf-chip-summary'))
    chip.appendChild(createSpan('dshcf-chevron'))
    chip.addEventListener('click', () => {
      const parent = chip.parentElement
      if (parent === null) return
      const k = this.chipKeys.get(chip) ?? parent
      const next = !(this.expandedByHost.get(k) ?? false)
      this.expandedByHost.set(k, next)
      const { rows, containers } = this.chipBlocks.get(chip) ?? { rows: [], containers: [] }
      applyRows(rows, containers, next)
      // 同步应用合并思考行：展开瞬间不闪“4 行原始思考再收成 1 行”。
      if (next && rows.length > 1 && rows.every(r => isThinkRow(r))) {
        this.syncMergedThink(parent, rows)
      } else {
        this.removeMergedThink(parent)
      }
      updateChip(chip, rows, next, this.blockElapsed.get(k))
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

/** 终端小方块图标（无原生 command leading 可克隆时的兜底；素材 Codex
 * 对齐：方框 + >_ 提示符）。 */
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

/** DSH 原生 ReasoningRow 的思考图标（IconThinkOutline14）path 数据，14x14
 * 兜底用（与 dsh-client-ui-primitives 的导出逐字一致）。 */
const THINK_ICON_PATHS: ReadonlyArray<{ d: string; evenodd?: boolean }> = [
  {
    d: 'M7.06431 5.93342C7.68763 5.93342 8.19307 6.43904 8.19322 7.06233C8.19322 7.68573 7.68772 8.19123 7.06431 8.19123C6.44099 8.19113 5.9354 7.68567 5.9354 7.06233C5.93555 6.43911 6.44108 5.93353 7.06431 5.93342Z',
  },
  {
    evenodd: true,
    d: 'M8.6815 0.963693C10.1169 0.447019 11.6266 0.374829 12.5633 1.31135C13.5 2.24805 13.4277 3.75776 12.911 5.19319C12.7126 5.74431 12.4386 6.31796 12.0965 6.89729C12.4969 7.54638 12.8141 8.19018 13.036 8.80647C13.5527 10.2419 13.6251 11.7516 12.6883 12.6883C11.7516 13.625 10.242 13.5527 8.8065 13.036C8.19022 12.8141 7.54641 12.4969 6.89732 12.0965C6.31797 12.4386 5.74435 12.7125 5.19322 12.911C3.75777 13.4276 2.2481 13.5 1.31138 12.5633C0.374859 11.6266 0.447049 10.1168 0.963724 8.68147C1.17185 8.10338 1.46321 7.50063 1.82896 6.8924C1.52182 6.35711 1.27235 5.82825 1.08872 5.31819C0.572068 3.88278 0.499714 2.37306 1.43638 1.43635C2.37308 0.499655 3.8828 0.572044 5.31822 1.08869C5.82828 1.27232 6.35715 1.5218 6.89243 1.82893C7.50066 1.46318 8.10341 1.17181 8.6815 0.963693ZM11.3573 8.01154C10.9083 8.62253 10.3901 9.22873 9.80943 9.8094C9.22877 10.3901 8.62255 10.9083 8.01158 11.3572C8.4257 11.5841 8.8287 11.7688 9.21275 11.9071C10.5456 12.3868 11.4246 12.2547 11.8397 11.8397C12.2548 11.4246 12.3869 10.5456 11.9071 9.21272C11.7688 8.82866 11.5841 8.42568 11.3573 8.01154ZM2.56529 8.02912C2.37344 8.39322 2.21495 8.74796 2.09263 9.08772C1.61291 10.4204 1.74512 11.2995 2.16001 11.7147C2.57505 12.1297 3.45415 12.2618 4.78697 11.7821C5.11057 11.6656 5.44786 11.5164 5.7938 11.3367C5.249 10.9223 4.70922 10.4533 4.19029 9.9344C3.57578 9.31987 3.03169 8.67633 2.56529 8.02912ZM6.90708 3.2469C6.24065 3.70479 5.5646 4.26321 4.91392 4.91389C4.26325 5.56456 3.70482 6.24063 3.24693 6.90705C3.72674 7.63325 4.32777 8.37459 5.03892 9.08576C5.64943 9.69627 6.28183 10.2265 6.90806 10.6678C7.59368 10.2025 8.2908 9.63076 8.96079 8.96076C9.6308 8.29075 10.2025 7.59366 10.6678 6.90803C10.2265 6.2818 9.69631 5.6494 9.08579 5.03889C8.37462 4.32773 7.63328 3.72672 6.90708 3.2469ZM11.7147 2.15998C11.2996 1.74509 10.4204 1.61288 9.08775 2.0926C8.74835 2.21479 8.39382 2.37271 8.03013 2.56428C8.67728 3.03065 9.31995 3.5758 9.93443 4.19026C10.4534 4.7092 10.9223 5.24896 11.3368 5.79377C11.5164 5.44785 11.6656 5.11052 11.7821 4.78694C12.2618 3.45416 12.1297 2.57502 11.7147 2.15998ZM4.91197 2.2176C3.57922 1.73788 2.70004 1.86995 2.28501 2.28498C1.87001 2.70003 1.73791 3.5792 2.21763 4.91194C2.31709 5.18822 2.44112 5.47427 2.58677 5.7674C3.01931 5.1887 3.51474 4.6158 4.06529 4.06526C4.61584 3.5147 5.18872 3.01928 5.76743 2.58674C5.47431 2.4411 5.18824 2.31706 4.91197 2.2176Z',
  },
]

/** 从原生 [data-variant="think"] [data-disclosure-row] 找真实 think SVG。
 * IconThinkOutline14 有 2 个 path，chevron 只有 1 个 —— 原生行打开时
 * leading 里只剩 chevron，按 path 数量判断可避免克隆到 chevron。 */
function findNativeThinkSvg(): SVGSVGElement | null {
  for (const drow of document.querySelectorAll<HTMLElement>('[data-variant="think"] [data-disclosure-row]')) {
    for (const svg of drow.querySelectorAll<SVGSVGElement>('svg')) {
      if (svg.querySelectorAll('path').length >= 2) return svg
    }
  }
  return null
}

/** 思考块 leading 图标：优先克隆原生 think SVG（与原生 ReasoningRow 完全
 * 一致），无可用克隆（原生行打开、或暂无非正文 think 行）时用
 * IconThinkOutline14 的 14x14 兜底。 */
function createThinkIcon(): SVGSVGElement {
  const native = findNativeThinkSvg()
  if (native !== null) return native.cloneNode(true) as SVGSVGElement
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 14 14')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  for (const p of THINK_ICON_PATHS) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    if (p.evenodd === true) {
      path.setAttribute('fill-rule', 'evenodd')
      path.setAttribute('clip-rule', 'evenodd')
    }
    path.setAttribute('d', p.d)
    path.setAttribute('fill', 'currentColor')
    svg.appendChild(path)
  }
  return svg
}

/** 从原生 [data-chat-call-id] [data-disclosure-row] 找真实 command leading
 * SVG：GenericCommandCard.leadingFor(state) 正常态 = IconApiOutline14
 * （14x14、2 个 path），error 态 = StateDot。按 path 数量排除 chevron 等
 * 单 path 图标；优先选择 14x14（width/height 或 viewBox 0 0 14 14）——
 * 命中 14x14 且 path ≥2 直接返回，其余 path ≥2 的留作兜底。只从工具卡行
 * 取：think 行没有 data-chat-call-id，天然不会克隆到思考图标。 */
function findNativeCommandSvg(): SVGSVGElement | null {
  let fallback: SVGSVGElement | null = null
  for (const drow of document.querySelectorAll<HTMLElement>('[data-chat-call-id] [data-disclosure-row]')) {
    for (const svg of drow.querySelectorAll<SVGSVGElement>('svg')) {
      if (svg.querySelectorAll('path').length < 2) continue // chevron / StateDot 等
      if (isIcon14(svg)) return svg
      if (fallback === null) fallback = svg
    }
  }
  return fallback
}

/** svg 是否为 14x14（width/height 属性或 viewBox 0 0 14 14）。 */
function isIcon14(svg: SVGSVGElement): boolean {
  if (svg.getAttribute('width') === '14' && svg.getAttribute('height') === '14') return true
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/\s+/)
  return vb.length === 4 && Number(vb[2]) === 14 && Number(vb[3]) === 14
}

/** 工具块 leading 图标：优先克隆原生 command leading SVG（与原生
 * GenericCommandCard 的 IconApiOutline14 完全一致），找不到（页面尚无工具
 * 卡、或卡片 leading 暂被状态图标替换）时保留终端小方块兜底。 */
function createCommandIcon(): SVGSVGElement {
  const native = findNativeCommandSvg()
  if (native !== null) return native.cloneNode(true) as SVGSVGElement
  return createTerminalIcon()
}

/** 按块类型切换 chip leading 图标（工具块 = 原生 command 图标，无原生
 * 可克隆时终端小方块兜底；思考块 = 原生 think 图标）。kind 不变时不动
 * DOM——updateChip 只在 kind 变化时才调用本函数，不会每帧替换。 */
function syncLeadingIcon(chip: HTMLButtonElement, kind: 'tool' | 'think'): void {
  const leading = chip.querySelector<HTMLElement>('.dshcf-leading')
  if (leading === null) return
  const existing = leading.querySelector('svg')
  if (existing !== null && existing.getAttribute('data-dshcf-icon') === kind) return
  for (const child of [...leading.childNodes]) child.remove()
  const svg = kind === 'think' ? createThinkIcon() : createCommandIcon()
  svg.setAttribute('data-dshcf-icon', kind)
  leading.appendChild(svg)
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
  // 上一个消息“正文后的遗留思考行”（Think1-正文-Think2 的 Think2）：
  // 不单独成 chip（一个消息一个 chip，避免 anchor 方案在 React 重渲染
  // 下累积 chip），而是并入下一个堆积块；到流末尾仍未消费时并入宿主
  // 消息的块，保证完成态不残留可见的思考行。
  let carry: HTMLElement[] = []
  let carryHost: HTMLElement | null = null

  for (const el of children) {
    // 顶层 context 注入节点：在一级工作流中独立展示（processTurn 把它收进
    // middleSteps，整条折叠/展开），不参与折叠、不生成二级 chip —— 直接
    // 跳过并断开当前合并。
    if (el.getAttribute('data-chat-flow-kind') === 'context') {
      run = null
      continue
    }
    const thinkRows = thinkRowsIn(el)
    const callRows = callRowsIn(el)
    const isToolPile = callRows.length > 0
    // 正文检测：排除 think 行 / 工具卡 / 插件 chip 内部的文本，其余非空文本
    // 都算正文输出（推理摘要渲染在 [data-variant="think"] 内，不算正文）。
    // 工具组跳过 walker（工具卡必然有文本，不参与正文判定）。
    const hasText = !isToolPile ? hasBodyText(el) : false

    if (isToolPile || (thinkRows.length > 0 && !hasText)) {
      // 堆积（工具组 / 纯 think 消息）→ 并入当前块。
      if (run === null) {
        run = { host: el, rows: [], containers: [] }
        blocks.push(run)
      }
      if (carry.length > 0) {
        run.rows.push(...carry)
        carry = []
      }
      run.rows.push(...thinkRows, ...callRows)
      // 非宿主的堆积元素（相邻工具组、合并进来的纯 think 消息）随块折叠/
      // 展开 —— 否则完成态这些空 seat 仍占位，造成 "已处理" 行与最终正文
      // 之间的空白；块宿主（chip 插在它内部）不能隐藏。
      if (el !== run.host) {
        run.containers.push(el)
      }
    } else if (el.hasAttribute('data-chat-anchor-key') || (hasText && el.getAttribute('data-chat-flow-kind') !== null)) {
      // 正文消息：think 先并入前面的块（无块则自成一块），然后断开合并。
      // 正文 = 带 data-chat-anchor-key 的 seat（真实 DSH 所有消息节点都有
      // key）；hasText 兜底无 key 但带 kind 的输出。
      // 装饰元素（TurnStatus / PendingSteering / older 按钮等：无 key 无
      // kind，如 role="status" 的 "Deep diving..." 状态行）即使有文本也
      // 不当作正文——否则运行中的状态行会断开相邻工具组合并。
      if (thinkRows.length > 0) {
        // 块内按正文切分（luna 分段思考 Think1-正文-Think2）：第一段并入
        // 当前块；正文后的段落作为遗留行（carry），由下一个堆积块吸收，
        // 避免“文本上下的思考折叠到一起”且不引入第二个 chip。
        const segments = splitThinkByBody(el, thinkRows)
        if (run === null) {
          run = { host: el, rows: [], containers: [] }
          blocks.push(run)
        }
        run.rows.push(...segments[0])
        carry = segments.slice(1).flat()
        carryHost = el
      }
      run = null
    }
    // 其他装饰元素（无 anchor、无行）不打断合并。
  }
  // 流末尾残留的遗留思考行（Think2 后无堆积块）：并入宿主消息的块（宿主
  // 有 think 时必是块宿主），宿主 think 已并入前块时并入最后一块——否则
  // 这些行在回合完成态保持可见，破坏“只留模型说的话”。
  if (carry.length > 0 && carryHost !== null) {
    const own = blocks.find(b => b.host === carryHost)
    if (own !== undefined) own.rows.push(...carry)
    else if (blocks.length > 0) blocks[blocks.length - 1].rows.push(...carry)
  }
  return blocks
}

/** 块内切分：think 行按“think 容器外的正文文本”分段。同一消息里
 * Think1-正文-Think2 时返回 [Think1] [Think2]；无正文间隔的相邻思考
 * 保持在同一段（合并）。 */
function splitThinkByBody(el: HTMLElement, rows: HTMLElement[]): HTMLElement[][] {
  const segments: HTMLElement[][] = []
  let current: HTMLElement[] = []
  for (let i = 0; i < rows.length; i++) {
    current.push(rows[i])
    if (i + 1 < rows.length && hasBodyBetween(el, rows[i], rows[i + 1])) {
      segments.push(current)
      current = []
    }
  }
  if (current.length > 0) segments.push(current)
  return segments.length > 0 ? segments : [rows]
}

/** a 行之后、b 行之前（DOM 顺序）是否存在 think 容器外的正文文本。 */
function hasBodyBetween(el: HTMLElement, a: HTMLElement, b: HTMLElement): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null) !== null) {
    if (node.data.trim() === '') continue
    const parent = node.parentElement
    if (parent !== null && parent.closest('[data-variant="think"], [data-chat-call-id], .dshcf-chip, .dshcf-merged-think, .dshcf-merged-body') !== null) continue
    const posA = a.compareDocumentPosition(node)
    const posB = b.compareDocumentPosition(node)
    if ((posA & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && (posB & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
      return true
    }
  }
  return false
}

/** 消息是否含正文文本：正文由 MarkdownText 渲染，但 CSS Modules 构建产物
 * 的类名是短哈希（如 uqINua_body），无法用类名字面量识别。改为文本节点
 * walker：折叠行（think 推理块 / 工具卡片）与插件自己的 chip、三级合并
 * 思考行/内容块之外的任何非空文本都算正文——正文渲染的段落
 * （p/pre/li 等）必然携带这些文本。 */
function hasBodyText(el: HTMLElement): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null) !== null) {
    if (node.data.trim() === '') continue
    const parent = node.parentElement
    if (parent !== null && parent.closest('[data-variant="think"], [data-chat-call-id], .dshcf-chip, .dshcf-merged-think, .dshcf-merged-body') !== null) continue
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

/** 折叠/展开：只切换 CSSOM display，React 不会覆盖。目标值不变时不写。 */
function applyRows(rows: readonly HTMLElement[], containers: readonly HTMLElement[], expanded: boolean): void {
  const display = expanded ? '' : 'none'
  for (const row of rows) {
    if (row.style.display !== display) row.style.display = display
  }
  for (const container of containers) {
    if (container.style.display !== display) container.style.display = display
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

/** 刷新 chip 内容：实时反映当前正在进行的工作。只在内容真正变化时才写
 * DOM —— 流式思考时摘要逐帧变化，无变化写入会触发 MutationObserver
 * childList 自激（pass → 写 → mutation → pass 循环）并造成文本跳动。 */
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
  // 展开态（出现三级原生行）后右侧摘要消失：三级行自带流式思考/命令
  // 展示，二级不再重复展示摘要；收起态显示摘要。
  const collapsed = !expanded
  let titleText: string
  let summaryText: string

  if (info.runningTool !== null) {
    // 正在调用工具："正在运行" + 命令/参数。
    titleText = '正在运行'
    summaryText = collapsed ? info.runningTool.summary : ''
  } else if (info.runningThink !== null) {
    // 正在思考：显示思考的最新一行。
    titleText = '正在思考'
    summaryText = collapsed ? info.runningThink.summary : ''
  } else if (info.tools.length > 0) {
    // 全部完成："运行了命令"，信息在展开态明细里。
    titleText = '运行了命令'
    summaryText = ''
  } else {
    // 纯 think 块完成：固定 "已思考"。
    titleText = '已思考'
    summaryText = ''
  }

  // 收起/展开状态由 chevron 方向表达，标题不附加"收起"字样。
  const kind = running !== null ? running.kind : info.tools.length > 0 ? 'tool' : 'think'

  if (title.textContent !== titleText) title.textContent = titleText
  if (summary.textContent !== summaryText) summary.textContent = summaryText
  if (sep !== null) {
    const sepDisplay = summaryText === '' ? 'none' : ''
    if (sep.style.display !== sepDisplay) sep.style.display = sepDisplay
  }
  // running 时摘要跟随最新内容：视口贴住右端（原生 ReasoningRow 的
  // scrollLeft 跟随），流式更新时新内容向左流动；非 running 复位开头。
  summary.scrollLeft = running !== null ? summary.scrollWidth - summary.clientWidth : 0
  const expandedAttr = String(expanded)
  if (chip.getAttribute('aria-expanded') !== expandedAttr) {
    chip.setAttribute('aria-expanded', expandedAttr)
  }
  if (chip.dataset.kind !== kind) {
    chip.dataset.kind = kind
    syncLeadingIcon(chip, kind)
  }
  const tip = expanded ? '收起这些卡片' : '展开这些卡片'
  if (chip.title !== tip) chip.title = tip
  setClass(chip, 'running', running !== null)
  setClass(chip, 'error', !running && info.hasError)
  setClass(chip, 'stopped', !running && info.hasStopped && !info.hasError)
}

/** 仅当目标状态与当前不同时才写 class（避免每帧重复 classList 操作）。 */
function setClass(el: HTMLElement, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on)
}

/** 摘要截断：去首尾空白、压缩换行，超长截断加省略号。 */
function truncateSummary(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** 去掉 markdown 强调/标题标记（think 摘要常为 **粗体** 或 # 标题）。 */
function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, '').replace(/^#{1,3}\s+/, '').trim()
}

/** 行是否为原生思考行。 */
function isThinkRow(row: HTMLElement): boolean {
  return row.matches('[data-variant="think"]') && !row.hasAttribute('data-tool')
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
  // 旧格式：turn-tail 带 "用时 33秒" / "用时 2分05秒"。
  const m = text.match(/用时\s*(\d+)分(\d+)秒|用时\s*(\d+)秒/)
  if (m !== null) {
    if (m[1] !== undefined && m[2] !== undefined) return Number(m[1]) * 60000 + Number(m[2]) * 1000
    if (m[3] !== undefined) return Number(m[3]) * 1000
    if (m[1] !== undefined) return Number(m[1]) * 1000
    return undefined
  }
  // 新格式：turn-tail 只有结束时间（"8月14日 22:11 · 66 tok/s"），
  // 回合开始时间在用户消息的 timeStart（"8月14日 21:56"）——取差值。
  const end = parseTimeText(text)
  const start = findTurnStart(boundary)
  if (end !== undefined && start !== undefined && end > start) return end - start
  return undefined
}

/** 解析 DSH 时间文本（"8月14日 21:56" / "2026年8月14日 22:11"）。 */
function parseTimeText(text: string): number | undefined {
  const m = text.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/)
  if (m === null) return undefined
  const year = m[1] !== undefined ? Number(m[1]) : new Date().getFullYear()
  const t = new Date(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime()
  return Number.isNaN(t) ? undefined : t
}

/** boundary 之前（含）最近的回合开始时间（timeStart 类元素）。 */
function findTurnStart(boundary: HTMLElement): number | undefined {
  const flow = boundary.parentElement
  if (flow === null) return undefined
  let best: HTMLElement | null = null
  for (const s of flow.querySelectorAll<HTMLElement>('[class*="timeStart"]')) {
    // timeStart 在用户消息内部（flow 深层），用 DOM 位置判断在 boundary 前
    // （CONTAINED_BY = boundary 是用户消息时 timeStart 在它内部）。
    const pos = s.compareDocumentPosition(boundary)
    if ((pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 || (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) !== 0 || s === boundary) best = s
    else break
  }
  if (best === null) return undefined
  return parseTimeText(best.textContent ?? '')
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
  const text = document.createElement('span')
  text.textContent = duration !== undefined ? `已处理 ${formatDuration(duration)}` : '已处理'
  const chevron = document.createElement('span')
  chevron.className = 'dshcf-processed-chevron'
  btn.append(text, chevron)
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

/** 毫秒 → 中文紧凑时长（素材 Codex 对齐：14秒 / 2分05秒 / 15分）。
 * 整分钟（秒为 0）省略秒位：15分00秒 → 15分；整小时 → X小时。 */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}秒`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) {
    // 小时级：X小时 / X小时Y分（秒省略，分钟粒度足够）。
    return m > 0 ? `${h}小时${m}分` : `${h}小时`
  }
  // 分钟级：整分省略秒位（15分00秒 → 15分）。
  if (r === 0) return `${m}分`
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
function replaceTurnStatus(originals: Map<Text, string>): void {
  for (const status of document.querySelectorAll<HTMLElement>('[role="status"]')) {
    for (const node of status.childNodes) {
      if (node instanceof Text && node.data.includes('Deep diving')) {
        if (!originals.has(node)) originals.set(node, node.data)
        const next = node.data.replace('Deep diving', 'Deep sleeping')
        // 写入守卫：值不变不赋值。否则每轮 pass 的赋值会产生
        // characterData mutation，在 characterData 观察下自激循环。
        if (node.data !== next) node.data = next
      }
    }
  }
}

/** 只恢复仍保留插件改写文案的节点，避免覆盖宿主之后的状态更新。 */
function restoreTurnStatus(originals: Map<Text, string>): void {
  for (const [node, original] of originals) {
    if (node.isConnected && node.data.includes('Deep sleeping')) node.data = original
  }
  originals.clear()
}

function removeStyle(): void {
  document.getElementById(STYLE_ID)?.remove()
}
