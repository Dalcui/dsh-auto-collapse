import { readTurnMetrics, readPreviousTurnLastInput } from './turn-metrics.ts'

/**
 * FoldController —— dsh-auto-collapse 的核心。
 *
 * 把会话流（[data-chat-flow]）里的“非正文 display”折叠成内联的一行，
 * 折叠行实时显示**当前正在进行的工作**（与 Codex 对齐）：
 *
 *   - 块里有运行中的工具调用 → 标题 = "Running" + 工具名（Bash/Read/
 *     Search…，读 data-tool），摘要 = 正在执行的命令/路径/查询（读工具
 *     卡片的 summary 行）；标题与摘要带平滑呼吸动画（Pulse）。
 *   - 块里正在思考（think running）→ 标题 = "Thinking"，摘要 = 思考的
 *     最新一行（读 [data-follow-end]，官方 ReasoningRow 的实时摘要锚点）。
 *   - 全部完成 → 标题 = 类型总结（编辑了文件 / 运行了命令 / 已思考 /
 *     上下文注入），摘要清空；出错 → 红色，中断 → 琥珀。
 *
 * 另外把官方 ChatView 尾部的运行状态行文字 "Deep diving..." 替换为
 * 可配置的状态提示词（默认 "Deep sleeping..."；流光特效在 CSS 上，
 * 替换文本节点不影响）。React 重渲染会恢复原文，pass() 每轮自愈改回。
 * 设置为空时不替换，等价于恢复官方 "Deep diving..."。
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

/** 默认状态提示词，与设置在设置页里展示的默认值保持一致。 */
const DEFAULT_STATUS_TEXT = 'Deep sleeping...'
/** 进行中回合最后保留不折叠的系统提示行数（与 locales/settings 的权威默认一致）。 */
const DEFAULT_KEEP_LAST_ROWS = 3

/** 显示动画参数（issue #2 区间 150–250ms）。 */
const ANIM_DURATION_MS = 180
const ANIM_EASING = 'ease-out'

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
  align-self: flex-start;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
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
  /* 展开态补的 margin-bottom 16px 由 aria-expanded/has-body 翻转驱动，
     一帧瞬开（与三级行 display 翻转同 pass 同帧，无下推）；收起方向
     由 JS 侧钉住间距（收起 fade 期间内联 16px，最后一条在途渐隐 settle
     后归零，见 reconcileBlock / hasPendingCollapse）。不设 CSS transition
     ——v13 的过渡与 chip 元素生命周期随机交互，产生展开方向双重人格
     （复用元素缓动下推三级行 vs 新建元素瞬开），同类型块不一致。 */
}
.dshcf-chip[aria-expanded="true"],
.dshcf-chip.dshcf-has-body {
  margin-bottom: 16px;
}
/* context 等 before-mounted chip 是 flow 的直接子项，已经享受宿主
   row-gap: 16px；展开时不能再叠加自身 margin，否则二级到三级会变 32px。 */
.dshcf-chip.dshcf-flow-chip {
  margin-bottom: 0;
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
  /* 运行色保留；图标跳动动画已按用户要求移除。 */
  color: var(--dsw-static-deepseek-500, #4d6bfe);
}

/* 运行指示三个点：已按用户要求移除（不再创建/显示）。 */

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
/* 完成态计数摘要用普通文本，不复用工具命令的等宽字体/代码衬底。 */
.dshcf-chip[data-kind="tool"] .dshcf-chip-summary.dshcf-chip-counts {
  font-family: inherit;
  font-size: 14px;
  line-height: 24px;
  background: none;
  padding: 0;
}
/* 失败计数（浅红），对齐 dsh-turn-fold 的 activityGroup.failures。 */
.dshcf-chip .dshcf-chip-failure {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--dsw-alias-state-error-primary, #e5484d);
  white-space: nowrap;
}
/* 完成态二级折叠「最后一次 Code 工具 description」：独立 span，可在
   hover 模式（dshcf-hover-only）下悬停浮现，不占常显位置。 */
.dshcf-chip .dshcf-chip-code {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.dshcf-chip .dshcf-chip-code::before {
  content: ' · ';
  white-space: pre;
}
.dshcf-chip .dshcf-chip-code.dshcf-hover-only {
  display: none;
}
.dshcf-chip:hover .dshcf-chip-code.dshcf-hover-only,
.dshcf-chip:focus-visible .dshcf-chip-code.dshcf-hover-only {
  display: inline;
}

/* 运行中文字使用平滑呼吸动画（Pulse），适配浅色/深色主题，避免 background-clip 裁切问题。 */
.dshcf-chip.running .dshcf-chip-title,
.dshcf-chip.running .dshcf-chip-summary {
  color: var(--dsw-alias-label-tertiary, #8b8f99);
  -webkit-text-fill-color: currentColor;
  animation: dshcf-pulse 1.6s ease-in-out infinite;
}
.dshcf-chip.running[data-kind="tool"] .dshcf-chip-summary {
  background: transparent;
}
@keyframes dshcf-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* "已处理"行：最终输出出现后工作过程整体隐藏，只留这一行 + 时长。
   字体与二级 chip 对齐（14px/24px），左右无内边距（与正文左缘对齐）。 */
.dshcf-processed {
  display: flex;
  align-self: stretch;
  width: 100%;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  padding: 4px 0 8px;
  border: none;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: none;
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  /* 对齐 DSH 原生工具行摘要的次级层级（label-tertiary）。 */
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  user-select: none;
  border-radius: 0;
  transition: color 0.15s ease;
}
.dshcf-processed:hover {
  color: var(--dsw-alias-label-primary);
  background: transparent;
}
.dshcf-processed:focus-visible {
  outline: 2px solid var(--dsw-alias-state-focus-ring, rgba(77, 107, 254, 0.8));
  outline-offset: 2px;
}
/* 折叠箭头：使用 DSH 原生 IconChevronDownOutline14 的 14x14 path。 */
.dshcf-processed .dshcf-processed-chevron {
  display: inline-flex;
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.55;
  transform: rotate(-90deg);
  transition: transform 0.12s ease, opacity 0.1s ease;
}
.dshcf-processed:hover .dshcf-processed-chevron {
  opacity: 0.9;
}
.dshcf-processed[aria-expanded="true"] .dshcf-processed-chevron {
  transform: rotate(0deg);
}

/* 实时摘要行（回合进行中）：与“已处理”行同族，但非交互、带运行呼吸点。 */
.dshcf-processing {
  display: flex;
  align-self: stretch;
  width: 100%;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  padding: 4px 0 8px;
  border: none;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: none;
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--dsw-alias-label-tertiary);
  user-select: none;
  border-radius: 0;
}
.dshcf-processing .dshcf-live-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-static-deepseek-500, #4d6bfe);
  animation: dshcf-pulse 1.6s ease-in-out infinite;
}

/* 三级合并思考行：展开二级后连续思考合并为一行（标题 = 第一行思考内容）。
   样式与 chip 同族（16px 图标盒、14px/24px、原生 label token 色）。 */
.dshcf-merged-think {
  box-sizing: border-box;
  display: flex;
  align-self: flex-start;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
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
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.55;
  transform: rotate(-90deg);
  transition: transform 0.12s ease, opacity 0.1s ease;
}
.dshcf-merged-think:hover .dshcf-chevron,
.dshcf-merged-think:focus-visible .dshcf-chevron {
  opacity: 0.9;
}
.dshcf-merged-think[aria-expanded="true"] .dshcf-chevron {
  transform: rotate(0deg);
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
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.5;
  transform: rotate(-90deg);
  transition: opacity 0.1s ease, transform 0.12s ease;
}
.dshcf-chip:hover .dshcf-chevron,
.dshcf-chip:focus-visible .dshcf-chevron,
.dshcf-chip[aria-expanded="true"] .dshcf-chevron {
  opacity: 0.9;
}
.dshcf-chip[aria-expanded="true"] .dshcf-chevron {
  transform: rotate(0deg);
}
.dshcf-chip:focus-visible {
  outline: 2px solid var(--dsw-alias-state-focus-ring, rgba(77, 107, 254, 0.8));
  outline-offset: 2px;
  border-radius: 4px;
}

/* 挂进 DSH 原生 turn-process disclosure 行的指标摘要（compact 模式协同）。
   原生行自身 14px label；本 span 用次级色、13px，chevron 前留白。 */
.dshcf-native-metrics {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 24px;
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
}

@media (prefers-reduced-motion: reduce) {
  .dshcf-chip.running .dshcf-leading svg { animation: none; }
  .dshcf-chip.running .dshcf-chip-title,
  .dshcf-chip.running .dshcf-chip-summary {
    animation: none;
    opacity: 1;
  }
}
`

/** 一个“折叠块”：正文之间的非正文系统信息（think / 工具 / 上下文注入 / 状态行）合成的一块。 */
interface Block {
  /** 跨 React 元素替换保持稳定的块标识。 */
  key: string
  /** 首个堆积元素（think 消息 / 工具组 / 上下文注入元素）。 */
  host: HTMLElement
  /** 块顶元素：块内 flow 级成员（host ∪ containers ∪ statusRows）中 DOM 顺序最靠前者；
   *  chip 以此为锚 —— 块前状态行也折叠在 chip 之下，展开/收起时 chip 位置稳定不跳动。 */
  head: HTMLElement
  /** 需要折叠/展开的行（推理块行 + 顶层工具卡片行 + 上下文注入元素）。 */
  rows: HTMLElement[]
  /** 需要随块折叠/展开的容器（工具组元素等，避免折叠后残留空白；含 chip 不在其内的 host）。 */
  containers: HTMLElement[]
  /** 块内回合级状态装饰行（model-retry 等）：随块二级折叠，二级展开时恢复。 */
  statusRows: HTMLElement[]
  /** chip 是否插在 host 内部（否则插在 head 之前，flow 级 chip）。 */
  mount: 'inside' | 'before'
}

interface SegmentSnapshot {
  key: string
  boundary: HTMLElement | null
  startMarker: HTMLElement | null
  blocks: Block[]
  /** 回合内中间正文消息（assistant-step + 正文，非最终输出）。 */
  middleSteps: Set<HTMLElement>
  /** 回合级状态装饰行（DSH 原生 model-retry 重试链投影行），随段一级折叠隐藏。 */
  statusRows: HTMLElement[]
  finalStep: HTMLElement | null
  firstWork: HTMLElement | null
  closed: boolean
  running: boolean
  hasWork: boolean
  /** 回合异常终止（已停止 / turn-error / turn-max-tokens）却无 turn-tail 边界时置真，
   * 视同闭合生成一级行、折叠内容。 */
  terminated: boolean
  /** 终止标签来源：仅 stopped/aborted 行状态置 'aborted'（显示「已停止」）。 */
  termination: 'aborted' | undefined
  /** 回合内段序号：被 steering（插话）切分的段序号（0=首轮段、1=首次插话后…）。
   * 用于按段读取注入器发布的精确指标，避免插话前后段共享回合级聚合值。 */
  segOrdinal: number
  /** 段所属回合号（位置兜底值）：按 user 边界递增、以 turn-tail 的 data-turn-tail
   * 锚定。注入器 data-dshcf-turn / turn-tail data-turn-tail 缺失时的最后兜底，
   * 窗口截断（可见流首回合号 >1）且注入器缺失时可能不准确，仅作无害回退。 */
  turn: number | undefined
}

/** 回合指标数据，从 DOM turn-tail 元素中提取。 */
interface TurnMetrics {
  durationMs?: number
  startTime?: number
  /** 回合开始时间（ms，记录级，来自 turnTimings/注入器）。 */
  turnStartTime?: number
  /** 回合结束时间（ms，记录级）。 */
  turnEndTime?: number
  toolCalls?: number
  modelCalls?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  timeToFirstToken?: number
  tokensPerSecond?: number
  /** 本回合最后一次模型调用（finalStep）的输入 token 总量（含缓存读/写）。 */
  lastModelInputTokens?: number
  /** 本回合新增上下文 = 本回合末模型输入 - 上一回合末模型输入（可能为负）。 */
  contextDelta?: number
  /** 终止原因：completed / aborted / interrupted */
  termination?: 'completed' | 'aborted' | 'interrupted'
  /** token 用量是否为部分值（流式中间态） */
  tokenUsagePartial?: boolean
}

interface SegmentState {
  key: string
  row: HTMLButtonElement | null
  expanded: boolean
  snapshot: SegmentSnapshot
  duration?: number
  metrics?: TurnMetrics
  /** 是否有交互（键盘焦点/文本选择）阻止折叠 */
  hasInteraction?: boolean
  /** token 提取尝试次数（防止 DOM 无 token 源时每 pass 无限重扫） */
  metricsAttempts?: number
}

interface ChipRecord {
  host: HTMLElement
  chip: HTMLButtonElement
}

/** 一行的实时摘要信息。 */
interface RowInfo {
  kind: 'tool' | 'think' | 'context'
  label: string
  summary: string
  state: string
  /** 原始工具名（data-tool，如 run_code / bash / read），非工具行为 undefined。 */
  tool?: string
}

/** 一条在途显示动画的记录。target 是动画的目标方向（非当前视觉状态）。 */
interface PendingAnim {
  anim: Animation
  target: 'hidden' | 'visible'
  /** fade=纯透明度/位移；height=几何锁动画（在途取消时需同步清锁高内联）。 */
  kind: 'fade' | 'height'
}

export class FoldController {
  private observer: MutationObserver | null = null
  private raf = 0
  private timer = 0
  private disposed = false
  private lastPassError = ''

  private flow: HTMLElement | null = null
  /** 稳定 block key → 当前 React 渲染中的 chip/host。 */
  private chips = new Map<string, ChipRecord>()
  private currentBlocks = new Map<string, Block>()
  private blockExpanded = new Map<string, boolean>()
  /** host → 三级合并思考行（展开二级后连续思考合并显示为一个三级行）。 */
  private mergedThinks = new Map<HTMLElement, HTMLButtonElement>()
  /** 合并思考行的展开状态（true = 显示合并内容块）。 */
  private mergedExpanded = new WeakSet<HTMLElement>()
  /** 合并内容缓存（首次从原生行读取后保存，pass 重建内容块时不再重新展开原生行）。 */
  private mergedBodyTexts = new WeakMap<HTMLElement, string>()
  /** 合并行标题缓存（原生行展开态提取不到摘要时保持首次标题，不丢成“思考”）。 */
  private mergedTitles = new WeakMap<HTMLElement, string>()
  /** 稳定 segment key → 一级折叠行与展开状态。 */
  private segmentStates = new Map<string, SegmentState>()
  /** segment 首次观察到 running 的时间，用于没有官方时长的实时回合。 */
  private runningSince = new Map<string, number>()
  /** segment 首次读到的记录级回合起点 turnStartTime（缓存，published 抖动时计时不跳源）。 */
  private liveTurnStarts = new Map<string, number>()
  /** 曾完成过的 segment key：段恢复运行时据此重开本地计时，防止重新结算
   * 的本地时长吞掉完成间隙。 */
  private completedOnce = new Set<string>()
  /** 进行中 segment 的实时摘要行（key → 行元素）。 */
  private liveRows = new Map<string, HTMLDivElement>()
  /** 实时摘要行的 1s 重排定时器 id（让耗时走表）。 */
  private liveTick = 0
  /** 插件改写 display 前的精确原值；受控集合用于分类漂移和 stop() 恢复。 */
  private originalDisplay = new WeakMap<HTMLElement, string>()
  private controlledDisplay = new Set<HTMLElement>()
  /** 被改写为状态提示词的原生状态文本，卸载时按节点恢复。 */
  /** 被改写为状态提示词的原生状态文本：original = 宿主原文（卸载还原用），
   * written = 插件最后一次写入的值（仅当节点仍等于它时才还原，避免覆盖
   * 宿主在插件写入之后的状态更新）。 */
  private turnStatusTexts = new Map<Text, { original: string; written: string }>()
  /** 当前状态提示词读取器；返回空串时插件不替换状态行。 */
  private statusTextProvider: () => string | undefined
  private summaryFieldsProvider: () => string
  /** 完成态二级折叠「最后一次 Code 工具 description」显示模式读取器。 */
  private codeDescriptionProvider: () => string
  /** 进行中回合最后保留不折叠的系统提示行数量读取器（默认 3）。 */
  private keepLastRowsProvider: () => number
  /** 正文判定缓存（消息元素 → 有无正文）：流式期间只有被 mutation 命中的
   * 消息失效重算，历史消息跨 pass 复用，避免每帧全量 TreeWalker。 */
  private bodyTextCache = new WeakMap<HTMLElement, boolean>()
  /** 自上次 pass 以来子树发生变化的 flow 顶层消息；pass 开头统一失效。 */
  private dirtyMessages = new Set<HTMLElement>()
  /** 在途显示动画（元素 → 记录）：冲突仲裁、记账对齐与生命周期清理的依据。
   * 用 Map 不用 WeakMap——switchFlow/stop 需要遍历全量 cancel。 */
  private pendingAnims = new Map<HTMLElement, PendingAnim>()
  /** 手势点击的一次性可动画 block key；segment 级点击另保留中间正文的门控。 */
  private animatableKeys = new Set<string>()
  /** segment 点击时只让点击前已存在的 block 播放 reveal；流式中新出现的
   * 临时分裂块直接显示，避免分类收敛时留下半透明 stale chip。 */
  private animatableSegmentBlocks = new Map<string, ReadonlySet<string>>()

  /** 全局展开/收起快捷键处理器（Ctrl/Cmd+Shift+E）：无新增 UI 的一键展开全部。 */
  private onKeydown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'E' || event.key === 'e')) {
      if (event.repeat === true) return // 长按自动重复不反复 toggle
      // 输入框内不劫持（避免与文本编辑快捷键冲突）。
      const target = event.target as HTMLElement | null
      if (target !== null && typeof target.tagName === 'string') {
        const tag = target.tagName.toUpperCase()
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable === true) return
      }
      event.preventDefault?.()
      this.toggleExpandAll()
    }
  }

  constructor(statusTextProvider?: () => string | undefined, summaryFieldsProvider?: () => string, codeDescriptionProvider?: () => string, keepLastRowsProvider?: () => number) {
    this.statusTextProvider = statusTextProvider ?? (() => DEFAULT_STATUS_TEXT)
    this.summaryFieldsProvider = summaryFieldsProvider ?? (() => '')
    this.codeDescriptionProvider = codeDescriptionProvider ?? (() => 'always')
    this.keepLastRowsProvider = keepLastRowsProvider ?? (() => DEFAULT_KEEP_LAST_ROWS)
  }

  /** 设置变更后重跑一轮，让状态提示词立即生效。 */
  refresh(): void {
    this.schedule()
  }

  start(): void {
    if (this.disposed) return
    injectStyle()
    try {
      this.observer = new MutationObserver(records => {
        if (this.shouldSchedule(records)) {
          // 先定向失效正文缓存再调度：flow 外的噪音 mutation 不走这里。
          this.markDirty(records)
          this.schedule()
        }
      })
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
      // 全局展开/收起快捷键：Ctrl/Cmd+Shift+E（无新增 UI，可发现性靠 title/README 提示）。
      document.addEventListener('keydown', this.onKeydown)
    } catch (error) {
      this.reportError(error)
      throw error
    }
  }
  stop(): void {
    this.disposed = true
    if (this.raf !== 0) cancelAnimationFrame(this.raf)
    if (this.timer !== 0) clearTimeout(this.timer)
    document.removeEventListener('keydown', this.onKeydown)
    this.observer?.disconnect()
    this.switchFlow(null)
    removeStyle()
  }

  /** body 级 observer 只负责发现 flow 替换；已有 flow 外的文本变化不再触发全量扫描。 */
  private shouldSchedule(records: MutationRecord[]): boolean {
    // 左栏切换会话时 React 会先把旧 flow 整体 detach，再在同一父容器挂入
    // 新 flow。MutationObserver 回调触发时 record.target 已不再是旧 flow 的
    // 祖先，因此仅靠祖先链过滤会漏掉这次替换，直到刷新才重新初始化。
    if (records.length === 0 || this.flow === null || !this.flow.isConnected) return true
    return records.some(record => (
      nodeWithin(record.target, this.flow as HTMLElement)
      || nodeWithin(this.flow as HTMLElement, record.target)
    ))
  }

  /** 记录本批 mutation 命中的 flow 顶层消息，供正文判定缓存定向失效。
   * 从 record.target 沿 parentNode 走到 flow 的直接子级即所属消息；
   * 归属不到单一顶层消息（flow 直挂层结构变化、flow 外节点、文本直接
   * 子节点）时全量失效——保守正确且罕见。 */
  private markDirty(records: MutationRecord[]): void {
    const flow = this.flow
    if (flow === null || !flow.isConnected) return
    if (records.length === 0) {
      // 空批次 = 宿主/测试桩只通知“一轮调度、DOM 可能已变”而无细粒度
      // 记录（真实浏览器 observer 不会以空记录回调）：保守全量失效。
      this.bodyTextCache = new WeakMap()
      this.dirtyMessages.clear()
      return
    }
    for (const record of records) {
      let current: Node | null = record.target
      while (current !== null && current.parentNode !== flow) current = current.parentNode
      if (!(current instanceof HTMLElement)) {
        this.bodyTextCache = new WeakMap()
        this.dirtyMessages.clear()
        return
      }
      this.dirtyMessages.add(current)
    }
  }

  private schedule(): void {
    if (this.disposed || this.raf !== 0) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      if (this.timer !== 0) {
        clearTimeout(this.timer)
        this.timer = 0
      }
      this.runPass()
    })
    // 后台 tab 的 rAF 会被浏览器挂起（冻结后 this.raf 永非 0，后续
    // schedule 全部被吞，插件假死）：setTimeout 兜底，保证 pass 一定执行。
    if (this.timer !== 0) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = 0
      if (this.raf !== 0) {
        cancelAnimationFrame(this.raf)
        this.raf = 0
        this.runPass()
      }
    }, 60)
  }

  /** 异步 observer 异常不能静默杀死协调器；保留非可视诊断并允许后续 mutation 重试。 */
  private runPass(): void {
    try {
      this.pass()
      this.lastPassError = ''
      const style = document.getElementById(STYLE_ID)
      style?.setAttribute('data-dshcf-state', 'active')
      style?.removeAttribute('data-dshcf-error')
    } catch (error) {
      this.reportError(error)
    } finally {
      // 手势门控一次性消费放 finally：pass() 早退或中途抛错都不把 key
      // 泄漏到下一轮，避免协调器驱动的转换被误动画（评审 nit）。
      this.animatableKeys.clear()
      this.animatableSegmentBlocks.clear()
    }
  }

  private reportError(error: unknown): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    const style = document.getElementById(STYLE_ID)
    style?.setAttribute('data-dshcf-state', 'error')
    style?.setAttribute('data-dshcf-error', message.slice(0, 500))
    if (message === this.lastPassError) return
    this.lastPassError = message
    console.error('[dsh-auto-collapse] fold pass failed', error)
  }

  /** 一轮重放：重算堆积 → 应用折叠/展开 → 摆放并更新 chip → 替换状态行。 */
  private pass(): void {
    if (this.disposed) return

    const nextFlow = findFlow()
    if (nextFlow !== this.flow) this.switchFlow(nextFlow)
    const flow = this.flow
    if (flow === null) return

    // 正文缓存定向失效：只重算本 pass 前被 mutation 命中的消息。
    for (const el of this.dirtyMessages) this.bodyTextCache.delete(el)
    this.dirtyMessages.clear()
    const blocks = findBlocks(flow, (el) => this.hasBodyCached(el))
    this.currentBlocks = new Map(blocks.map(block => [block.key, block]))
    const segments = buildSegments(flow, blocks, (el) => this.hasBodyCached(el))
    const liveSegmentKeys = new Set(segments.map(segment => segment.key))

    // DSH 0.1.2-alpha.3+ 原生「对话显示」compact 模式：回合完成后原生渲染 disclosure 行
    // （turn-process 节点，button[data-turn-process] 携带回合号）并自行隐藏过程行
    // （hidden=until-found）。存在原生行的回合由原生接管一级折叠——本插件不再创建
    // 「已处理」行、不做一级隐藏（否则原生展开后行仍被本插件的 display:none 卡死），
    // 改为把指标摘要挂进原生 disclosure 行。normal 模式 / 无原生行的回合（如异常终止）
    // 维持原有行为。以 DOM 为准自适应，不依赖设置快照时序。
    //
    // data-turn-process 取值契约（已对照 dsh-client-ui-chat 源码核实）：
    // TurnProcessNodeView 渲染 "data-turn-process": node.data.turn，而 node.data
    // 来自 turn-process 投影的 encodeTurnProcess(spec)，spec.turn = turn.turn（回合号）；
    // 同一回合的 turn-tail 渲染 "data-turn-tail": data.turn（同为回合号）。
    // 因此下方用 segmentMetricsKeys(segment).turn（优先 data-turn-tail，回退注入器
    // data-dshcf-turn）做 String 精确匹配是成立的。
    const nativeTurns = new Set<string>()
    for (const btn of flow.querySelectorAll<HTMLElement>('[data-turn-process]')) {
      const t = btn.getAttribute('data-turn-process')
      if (t !== null && t !== '') nativeTurns.add(t)
    }
    const nativeManaged = new Set<string>()
    for (const segment of segments) {
      const keys = segmentMetricsKeys(segment)
      if (keys.turn !== undefined && nativeTurns.has(String(keys.turn))) nativeManaged.add(segment.key)
    }

    for (const segment of segments) {
      if (!segment.running) continue
      // 曾完成又恢复运行的回合（罕见）：丢弃旧起点重开计时，避免重新结算
      // 的本地时长吞掉完成间隙（段完成态时长已冻结，不在此覆盖）。
      if (this.completedOnce.has(segment.key)) {
        this.completedOnce.delete(segment.key)
        this.runningSince.delete(segment.key)
      }
      if (!this.runningSince.has(segment.key)) {
        this.runningSince.set(segment.key, Date.now())
      }
    }

    this.syncLiveRows(segments, flow)

    const completedKeys = new Set<string>()
    for (const snapshot of segments) {
      // 异常终止（无 turn-tail 边界）也视同闭合，生成一级行折叠内容。
      if (!snapshot.closed && !snapshot.terminated) continue
      if (snapshot.running || !snapshot.hasWork) continue
      completedKeys.add(snapshot.key)
      this.completedOnce.add(snapshot.key)
      let state = this.segmentStates.get(snapshot.key)
      if (state === undefined) {
        state = { key: snapshot.key, row: null, expanded: false, snapshot }
        this.segmentStates.set(snapshot.key, state)
      } else {
        state.snapshot = snapshot
      }
      const started = this.runningSince.get(snapshot.key)
      const turnTail = findTurnTail(snapshot)
      const parsed = turnTail === null ? undefined : parseTurnDuration(turnTail)
      const keys = segmentMetricsKeys(snapshot)
      // 提取回合指标（token 用量、工具调用等）
      // 仅在 metrics 未定义或无 token 数据时重试；重试次数上限防 DOM 无 token 源时每 pass 全树重扫
      const attempts = state.metricsAttempts ?? 0
      // 重试条件：metrics 未定义 / 无任何 token 数据 / cache 字段缺失（延迟到达的 data-usage 兜底）
      // / 已有末次模型输入但上下文增量尚未算出（上一回合指标晚到时补算）。
      const deltaPending = state.metrics !== undefined && state.metrics.lastModelInputTokens !== undefined && state.metrics.contextDelta === undefined
      if (attempts < 20 && (state.metrics === undefined || !hasTokenMetrics(state.metrics) || (state.metrics.cacheReadTokens === undefined && state.metrics.cacheWriteTokens === undefined) || deltaPending)) {
        state.metricsAttempts = attempts + 1
        // 从 segment DOM 元素提取 turn 号与会话 id：turn 优先 turn-tail 的
        // data-turn-tail（记录级、同步稳定），回退注入器 data-dshcf-turn，再回退
        // buildSegments 的位置兜底号；会话 id 取注入器写的 data-dshcf-session。
        // 按 (sessionId, turn) 精确匹配注入值，避免中断/插话/跨会话串扰。
        // 注意：提取不再以 findTurnTail() 非空为前提——被中断的末段（无 turn-tail、
        // 无后续 user/turn-tail 边界）也能从注入器模块级存储/DOM 属性读到指标。
        const extracted = extractTurnMetrics(turnTail, keys.turn, keys.sessionId, keys.segOrdinal)
        if (extracted !== undefined) {
          // 合并而非替换：保留已有的非 token 字段（如 duration、toolCalls）
          state.metrics = { ...state.metrics, ...extracted }
        }
      }
      // 耗时优先记录级（注入器由 turnTimings 发布的 durationMs，可复现、跨重启一致、
      // 跨插话/会话切换稳定），回退宿主 DOM 文本「用时」，再回退本地 running 区间。
      // 本地区间只在首次结算时取值冻结（否则停止后「已处理 X秒」一直走表）。
      if (state.metrics?.durationMs !== undefined && state.metrics.durationMs > 0) state.duration = state.metrics.durationMs
      else if (parsed !== undefined) state.duration = parsed
      else if (state.duration === undefined && started !== undefined) state.duration = Date.now() - started
      // 异常终止（无 turn-tail）时补认终止标签，摘要栏显示「已停止」。
      if (snapshot.termination !== undefined) {
        if (state.metrics === undefined) state.metrics = {}
        if (state.metrics.termination === undefined) state.metrics.termination = snapshot.termination
      }
      // 交互感知：检查焦点/选择
      state.hasInteraction = hasInteractionInBlocks(snapshot.blocks)
      // 状态持久化：从 localStorage 恢复展开状态
      if (state.expanded === false && !state.hasInteraction) {
        const persisted = persistedSegmentExpanded('default', snapshot.key)
        if (persisted === true) state.expanded = true
      }
      if (nativeManaged.has(snapshot.key)) {
        // DSH 原生 compact 模式：一级折叠由原生 disclosure 行接管，不建「已处理」行、
        // 不做一级隐藏；指标摘要写进原生行（含时长与 token 指标）。
        if (state.row !== null) { state.row.remove(); state.row = null }
        this.syncNativeDisclosure(state, flow, keys.turn)
      } else {
        if (state.row === null || !state.row.isConnected) state.row = this.createProcessedRow(state)
        this.syncProcessedRow(state)
      }
    }

    for (const [key, state] of [...this.segmentStates]) {
      if (completedKeys.has(key)) continue
      state.row?.remove()
      this.segmentStates.delete(key)
    }

    const segmentByBlock = new Map<string, SegmentSnapshot>()
    for (const segment of segments) {
      for (const block of segment.blocks) segmentByBlock.set(block.key, segment)
    }

    // 进行中回合（未闭合）：最后 keepLastRows 个系统提示行（思考/工具/上下文等
    // 非模型输出内容）保留原生可见、不收入折叠（R9）。keepLastRows=0 时连 running
    // 行也不保留（全部折叠）；>0 时 running 行仍按 R3 保留可见。注意用 !closed 而非
    // running——最终正文流式中工具已全部 ok、无 running 行时回合仍是「进行中」，
    // 尾行保留语义不应丢失（R3 扩展）。
    const keepTrailing = new Map<string, Set<HTMLElement>>()
    const keepLastRows = Math.max(0, this.keepLastRowsProvider())
    for (const segment of segments) {
      if (segment.closed) continue
      const sysRows: HTMLElement[] = []
      for (const block of segment.blocks) for (const row of block.rows) sysRows.push(row)
      keepTrailing.set(segment.key, new Set(sysRows.slice(Math.max(0, sysRows.length - keepLastRows))))
    }

    const desiredHidden = new Set<HTMLElement>()
    const seenBlocks = new Set<string>()
    for (const block of blocks) {
      seenBlocks.add(block.key)
      const blockSegment = segmentByBlock.get(block.key) ?? null
      this.reconcileBlock(block, blockSegment, desiredHidden, keepTrailing, keepLastRows, blockSegment !== null && nativeManaged.has(blockSegment.key))
    }

    for (const segment of segments) {
      const state = this.segmentStates.get(segment.key)
      // native 段由原生 disclosure 隐藏过程行，本插件不做一级折叠。
      const collapse = state !== undefined && !state.expanded && !nativeManaged.has(segment.key)
      // 触发门控：仅手势点击的 segment 走动画路径（收起方向 Phase 1 仍瞬变）。
      const animate = this.animatableKeys.has(segment.key)
      for (const middle of segment.middleSteps) {
        if (collapse) this.hideElement(middle, desiredHidden, animate)
        else this.restoreElement(middle, animate)
      }
      // model-retry 等回合级状态装饰行随段一级折叠：收起时与中间正文一同
      // 隐藏（不残留"已重试模型请求"行），展开时恢复显示。
      for (const status of segment.statusRows) {
        if (collapse) this.hideElement(status, desiredHidden, animate)
        else this.restoreElement(status, animate)
      }
      // final 永远显示；它内部的 think 行仍由对应 block 控制。
      if (segment.finalStep !== null) this.restoreElement(segment.finalStep)
    }

    for (const segment of segments) {
      if (nativeManaged.has(segment.key)) continue
      if (segment.hasWork && hasVisibleSegmentWork(segment)) continue
      const state = this.segmentStates.get(segment.key)
      if (state !== undefined && state.row !== null) {
        state.row.remove()
        state.row = null
      }
      for (const block of segment.blocks) this.suppressBlock(block, desiredHidden)
      for (const middle of segment.middleSteps) this.retainDisplayControl(middle, desiredHidden)
      for (const status of segment.statusRows) this.retainDisplayControl(status, desiredHidden)
      if (segment.finalStep !== null) this.retainDisplayControl(segment.finalStep, desiredHidden)
    }

    this.cleanupStaleChips(seenBlocks)
    this.restoreUnusedDisplays(desiredHidden)
    for (const state of this.segmentStates.values()) this.placeProcessedRow(flow, state)

    for (const key of [...this.runningSince.keys()]) {
      if (!liveSegmentKeys.has(key)) this.runningSince.delete(key)
    }
    for (const key of [...this.liveTurnStarts.keys()]) {
      if (!liveSegmentKeys.has(key)) this.liveTurnStarts.delete(key)
    }
    for (const key of [...this.completedOnce]) {
      if (!liveSegmentKeys.has(key)) this.completedOnce.delete(key)
    }
    for (const [node] of [...this.turnStatusTexts]) {
      if (!node.isConnected) this.turnStatusTexts.delete(node)
    }
    // 在途动画清扫：元素已断连的条目直接移除（动画随节点脱离文档自动取消）。
    for (const [el] of [...this.pendingAnims]) {
      if (!el.isConnected) this.pendingAnims.delete(el)
    }
    const statusText = this.statusTextProvider()
    if (statusText === undefined || statusText === '') {
      restoreTurnStatus(this.turnStatusTexts)
    } else {
      replaceTurnStatus(flow, this.turnStatusTexts, statusText)
    }
  }

  /** flow 元素变化即视为会话切换：完整恢复旧 flow，再从新 DOM 重建。 */
  private switchFlow(next: HTMLElement | null): void {
    if (next === this.flow) return
    // 在途动画全部取消：动画元素均已按「开始即收编」记账，
    // 随后的 restoreAllDisplays 能完整还原。异步 oncancel 靠身份守卫自保。
    // 收起动画额外同步清锁高内联，避免还原后残留 height/overflow 裁剪。
    for (const [el, record] of this.pendingAnims) {
      record.anim.cancel()
      if (record.kind === 'height') this.clearCollapseLock(el)
    }
    this.pendingAnims.clear()
    this.animatableKeys.clear()
    this.animatableSegmentBlocks.clear()
    for (const record of this.chips.values()) record.chip.remove()
    this.chips.clear()
    for (const host of [...this.mergedThinks.keys()]) this.removeMergedThink(host)
    for (const state of this.segmentStates.values()) state.row?.remove()
    this.segmentStates.clear()
    this.currentBlocks.clear()
    this.blockExpanded.clear()
    this.runningSince.clear()
    this.liveTurnStarts.clear()
    this.completedOnce.clear()
    for (const row of this.liveRows.values()) row.remove()
    this.liveRows.clear()
    if (this.liveTick !== 0) {
      clearTimeout(this.liveTick)
      this.liveTick = 0
    }
    this.bodyTextCache = new WeakMap()
    this.dirtyMessages.clear()
    this.restoreAllDisplays()
    restoreTurnStatus(this.turnStatusTexts)
    this.flow = next
  }

  private createProcessedRow(state: SegmentState): HTMLButtonElement {
    const row = createProcessedRowElement(state.duration, state.metrics, this.summaryFieldsProvider())
    row.addEventListener('click', (event?: { shiftKey?: boolean }) => {
      const blocks = state.snapshot.blocks
      // Shift+点击：一键展开/收起该回合全部二级（并保证一级展开）——修饰键方案，
      // 不新增 UI；再次 Shift+点击把该回合二级全部收起。
      if (event?.shiftKey === true) {
        const allExpanded = blocks.length > 0 && blocks.every(block => this.blockExpanded.get(block.key) === true)
        state.expanded = true
        const target = !allExpanded
        for (const block of blocks) {
          this.blockExpanded.set(block.key, target)
          this.removeMergedThink(block.host)
        }
        persistSegmentExpanded('default', state.key, state.expanded)
        // 触发门控：本 segment 本轮的显示转换走动画路径（一次性，pass 消费）。
        this.animatableKeys.add(state.key)
        this.animatableSegmentBlocks.set(state.key, new Set(blocks.map(block => block.key)))
        this.syncProcessedRow(state)
        this.schedule()
        return
      }
      state.expanded = !state.expanded
      // 持久化展开状态
      persistSegmentExpanded('default', state.key, state.expanded)
      // 触发门控：本 segment 本轮的显示转换走动画路径（一次性，pass 消费）。
      this.animatableKeys.add(state.key)
      this.animatableSegmentBlocks.set(state.key, new Set(blocks.map(block => block.key)))
      if (state.expanded) {
        // 只重置本回合的二级块，不影响其他已展开回合。
        for (const block of blocks) {
          this.blockExpanded.set(block.key, false)
          this.removeMergedThink(block.host)
        }
      }
      this.syncProcessedRow(state)
      this.schedule()
    })
    return row
  }

  /** 全局展开/收起：一键切换所有已闭合回合的一级展开 + 所有块的二级展开。
   * 快捷键（Ctrl/Cmd+Shift+E）与原生 disclosure 行的 Shift+点击触发；
   * 瞬时生效，不叠加逐块动画（避免整屏级联）。
   * rc.1 compact 模式：同时驱动原生 button[data-turn-process] 的打开状态——
   * 原生行打开/收起由 React turnProcess.setOpen 控制，插件只能通过合成
   * click()（isTrusted=false、无 shift，被上面的守卫放行）触发其原生
   * onClick；aria-expanded 以 DOM 现值为准判定每行是否需要翻转。 */
  private toggleExpandAll(): void {
    if (this.flow === null) return
    const segments = [...this.segmentStates.values()]
    const blockKeys = [...this.currentBlocks.keys()]
    const nativeButtons = [...this.flow.querySelectorAll<HTMLElement>('[data-turn-process]')]
    if (segments.length === 0 && blockKeys.length === 0 && nativeButtons.length === 0) return
    // every 对空集为空真（vacuous true）：无折叠块（纯文本回合 / 全是单条不折叠块）
    // 时由 segment 展开态单独驱动 toggle，避免「永远只展开、无法收起一级行」的 P1。
    const allSegmentsExpanded = segments.every(s => s.expanded)
    const allBlocksExpanded = blockKeys.every(k => this.blockExpanded.get(k) === true)
    const allNativeOpen = nativeButtons.every(b => b.getAttribute('aria-expanded') === 'true')
    const target = !(allSegmentsExpanded && allBlocksExpanded && allNativeOpen)
    for (const state of segments) {
      state.expanded = target
      persistSegmentExpanded('default', state.key, state.expanded)
    }
    for (const block of this.currentBlocks.values()) {
      this.blockExpanded.set(block.key, target)
      this.removeMergedThink(block.host)
    }
    for (const button of nativeButtons) {
      const open = button.getAttribute('aria-expanded') === 'true'
      if (open === target) continue
      if (typeof button.click === 'function') button.click()
    }
    this.schedule()
  }

  private syncProcessedRow(state: SegmentState): void {
    const row = state.row
    if (row === null) return
    const text = row.firstElementChild
    const label = buildMetricsSummary(state.duration, state.metrics, this.summaryFieldsProvider())
    if (text !== null && text.textContent !== label) text.textContent = label
    const expanded = String(state.expanded)
    if (row.getAttribute('aria-expanded') !== expanded) row.setAttribute('aria-expanded', expanded)
    const title = state.expanded ? '收起工作过程' : '展开工作过程'
    if (row.title !== title) row.title = title
    row.setAttribute('aria-label', label + ' - ' + title)
  }

  /** DSH 原生 compact 模式协同：把回合指标摘要写进原生 turn-process disclosure 行。
   * 原生行是 React 管理的 button[data-turn-process]（label span + chevron）；
   * 本插件在其 label 后插入一个次级色 span。React 重渲染（展开/收起原生行）会
   * 清掉这个 span——与其它自愈注入同款：每 pass 重建/更新，不依赖一次插入存活。 */
  private syncNativeDisclosure(state: SegmentState, flow: HTMLElement, turn: number | undefined): void {
    if (turn === undefined) return
    const button = flow.querySelector<HTMLElement>('[data-turn-process="' + String(turn) + '"]')
    if (button === null) return
    // Shift+点击原生 disclosure 行 = 一键展开/收起所有折叠项（rc.1 compact 模式
    // 下插件自建行不存在，这条原生行就是「轮次指标行」）。一次性绑定：
    // dataset 标记防止每次 pass 重复 addEventListener（React 重渲染只换
    // 子节点、button 元素本身复用；元素重建时标记随节点消失，自然重绑）。
    if (button.dataset.dshcfShiftBound !== '1') {
      button.dataset.dshcfShiftBound = '1'
      button.addEventListener('click', (event: MouseEvent) => {
        // 合成 .click()（isTrusted=false）与非 Shift 点击交给 React 自身的
        // onClick 处理，这里只拦截真实用户的 Shift+点击。
        if (event.shiftKey !== true || event.isTrusted !== true) return
        // 阻止 React onClick 把当前行单独 toggle（否则本行反向，其余行
        // 同向，状态撕裂）。阻止后由 toggleExpandAll 统一驱动所有行。
        event.stopPropagation?.()
        event.preventDefault?.()
        this.toggleExpandAll()
      })
    }
    const label = buildMetricsSummary(state.duration, state.metrics, this.summaryFieldsProvider())
    // 无任何可用指标（duration/metrics 全缺）时摘要只剩裸回退词（已处理/Processed）——
    // 原生行已自带过程计数，此时不插 span，避免冗余文案。
    const bare = getLocale() === 'zh' ? '已处理' : 'Processed'
    if (label === bare) {
      button.querySelector('.dshcf-native-metrics')?.remove()
      return
    }
    let span = button.querySelector('.dshcf-native-metrics')
    if (span === null) {
      span = document.createElement('span')
      span.className = 'dshcf-native-metrics'
      // 插在 label 之后、chevron 之前（label 是第一个 span 子节点）。
      const labelSpan = button.querySelector('span')
      if (labelSpan !== null && labelSpan.nextSibling !== null) button.insertBefore(span, labelSpan.nextSibling)
      else button.appendChild(span)
    }
    if (span.textContent !== label) span.textContent = label
  }

  private placeProcessedRow(flow: HTMLElement, state: SegmentState): void {
    const row = state.row
    if (row === null) return
    if (!state.snapshot.hasWork || !hasVisibleSegmentWork(state.snapshot)) {
      row.remove()
      state.row = null
      return
    }
    let target = state.snapshot.firstWork ?? state.snapshot.finalStep ?? state.snapshot.boundary
    // 防御：快照目标必为 flow 直接子级（均来自 flowItems），理论不可达；
    // 万一出现则移除未摆放的行并置空，让下一 pass 走正常重建路径，避免
    // 每轮残留未连接行并重复绑定 click。
    if (target === null || target.parentElement !== flow) {
      row.remove()
      state.row = null
      return
    }
    while (target.previousElementSibling?.classList.contains('dshcf-flow-chip') === true) {
      target = target.previousElementSibling as HTMLElement
    }
    if (row.parentElement !== flow || row.nextElementSibling !== target) target.before(row)
  }

  /** 进行中 segment 的实时摘要文本：记录级计时耗时（turnStartTime，切会话不归零）
   * + 注入器发布的实时指标。 */
  private buildLiveSummary(segment: SegmentSnapshot): string {
    const started = this.runningSince.get(segment.key)
    const keys = segmentMetricsKeys(segment)
    const seg = keys.segOrdinal
    // 多源读取实时指标：模块 Map（注入器 publish）优先，DOM 属性（注入器 effect 写）兜底——
    // running 流式高频时注入器 useEffect 与 fold pass 异步交错，单一模块 Map 源会在
    // publish 前/空值窗口读到 undefined，导致指标「时不时消失」。
    let published: TurnMetrics | undefined = (keys.turn !== undefined && keys.sessionId !== undefined)
      ? readTurnMetrics(keys.sessionId, keys.turn, seg)
      : undefined
    if (published === undefined && keys.turn !== undefined && this.flow !== null) {
      published = this.readLiveMetricsFromDom(keys.turn, keys.sessionId, seg)
    }
    // 实时耗时优先记录级起点 turnStartTime（切换 main↔subagent 会话不会归零），
    // 回退本地 runningSince（注入器尚未发布 startTime 时兜底）。
    // 插话段（seg>0）的 turnStartTime 是回合级起点（包含段A时间），段B 的实时
    // 耗时应从段起点算——回退 runningSince（段首次观察到 running 的时间）。
    // 记录级起点缓存到 liveTurnStarts：published 暂时读不到时计时不跳回 runningSince
    // 起点，避免「仅剩的计时从 0 重新开始」。值变化时刷新（同 key 复用新回合时
    // turnStartTime 会变，不能只写一次就永久缓存旧起点）。
    const startMsPublished = published?.turnStartTime
    if (startMsPublished !== undefined && this.liveTurnStarts.get(segment.key) !== startMsPublished) {
      this.liveTurnStarts.set(segment.key, startMsPublished)
    }
    const startMs = this.liveTurnStarts.get(segment.key)
    let liveDuration: number | undefined
    if (startMs !== undefined && seg === 0) {
      liveDuration = Math.max(0, Date.now() - startMs)
    } else if (started !== undefined) {
      liveDuration = Math.max(0, Date.now() - started)
    }
    const liveMetrics: TurnMetrics = {
      toolCalls: published?.toolCalls,
      modelCalls: published?.modelCalls,
      inputTokens: published?.inputTokens,
      outputTokens: published?.outputTokens,
      reasoningTokens: published?.reasoningTokens,
      cacheReadTokens: published?.cacheReadTokens,
      cacheWriteTokens: published?.cacheWriteTokens,
      tokensPerSecond: published?.tokensPerSecond,
      lastModelInputTokens: published?.lastModelInputTokens,
    }
    if (keys.turn !== undefined && keys.sessionId !== undefined && published?.lastModelInputTokens !== undefined) {
      const prev = readPreviousTurnLastInput(keys.sessionId, keys.turn, seg)
      if (prev !== undefined) liveMetrics.contextDelta = published.lastModelInputTokens - prev
      else if (keys.turn === 1 && seg === 0) liveMetrics.contextDelta = published.lastModelInputTokens
    }
    return buildMetricsSummary(liveDuration, liveMetrics, this.summaryFieldsProvider(), true)
  }

  /** 从 flow 内注入器 shadow host 的 DOM 属性读取实时指标（模块 Map 读不到的兜底）。
   * 限定在当前 flow 内查询，避免 running 高频 pass 时全文档扫描。 */
  private readLiveMetricsFromDom(turn: number, sessionId: string | undefined, segOrdinal: number): TurnMetrics | undefined {
    const flow = this.flow
    if (flow === null || typeof flow.querySelectorAll !== 'function') return undefined
    const turnStr = String(turn)
    const segStr = String(segOrdinal)
    const numericKeys = ['toolCalls', 'modelCalls', 'inputTokens', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens', 'tokensPerSecond', 'durationMs', 'lastModelInputTokens', 'turnStartTime', 'turnEndTime'] as const
    for (const h of flow.querySelectorAll<HTMLElement>('[data-dshcf-turn-metrics]')) {
      if (h.getAttribute('data-dshcf-turn') !== turnStr) continue
      if (sessionId !== undefined && h.getAttribute('data-dshcf-session') !== sessionId) continue
      const hostSeg = h.getAttribute('data-dshcf-seg') ?? '0'
      if (hostSeg !== segStr) continue
      const raw = h.getAttribute('data-dshcf-turn-metrics')
      if (raw === null || raw === '') continue
      try {
        const injected = JSON.parse(raw) as Record<string, unknown>
        const m: TurnMetrics = {}
        for (const k of numericKeys) {
          const v = injected[k]
          if (typeof v === 'number' && isFinite(v) && v > 0) (m as Record<string, unknown>)[k] = v
        }
        return Object.keys(m).length > 0 ? m : undefined
      } catch { continue }
    }
    return undefined
  }

  /** 同步进行中 segment 的实时摘要行。open 且有工作的段显示；闭合后由 processed
   * 行接管。放置规则与 placeProcessedRow 一致：锚在 firstWork 前、跳过 flow-chip。 */
  private syncLiveRows(segments: SegmentSnapshot[], flow: HTMLElement): void {
    const liveKeys = new Set<string>()
    for (const segment of segments) {
      if (!segment.closed && !segment.terminated && segment.hasWork && segment.firstWork !== null) liveKeys.add(segment.key)
    }
    for (const [key, row] of [...this.liveRows]) {
      if (liveKeys.has(key)) continue
      row.remove()
      this.liveRows.delete(key)
    }
    for (const segment of segments) {
      if (!liveKeys.has(segment.key)) continue
      let row = this.liveRows.get(segment.key)
      if (row === undefined || !row.isConnected) {
        row = createProcessingRowElement()
        this.liveRows.set(segment.key, row)
      }
      const text = row.querySelector<HTMLElement>('.dshcf-processing-text')
      const label = this.buildLiveSummary(segment)
      if (text !== null && text.textContent !== label) text.textContent = label
      const anchor = segment.firstWork
      if (anchor === null || anchor.parentElement !== flow) {
        row.remove()
        this.liveRows.delete(segment.key)
        continue
      }
      let target = anchor
      while (target.previousElementSibling?.classList.contains('dshcf-flow-chip') === true) {
        target = target.previousElementSibling as HTMLElement
      }
      if (row.parentElement !== flow || row.nextElementSibling !== target) target.before(row)
    }
    if (this.liveRows.size > 0) {
      if (this.liveTick === 0) {
        this.liveTick = setTimeout(() => {
          this.liveTick = 0
          this.schedule()
        }, 1000)
      }
    } else if (this.liveTick !== 0) {
      clearTimeout(this.liveTick)
      this.liveTick = 0
    }
  }

  private reconcileBlock(
    block: Block,
    segment: SegmentSnapshot | null,
    desiredHidden: Set<HTMLElement>,
    keepTrailing: ReadonlyMap<string, ReadonlySet<HTMLElement>>,
    keepLastRows: number,
    nativeManaged: boolean,
  ): void {
    const state = segment === null ? undefined : this.segmentStates.get(segment.key)
    // 触发门控：chip 本身被点击，或其所属 segment 的一级行被点击时，
    // 该块的展开方向走动画路径（分层规则：host 恒瞬时，只动画内部行）。
    const segmentAnimatableBlocks = segment === null ? undefined : this.animatableSegmentBlocks.get(segment.key)
    const animate = this.animatableKeys.has(block.key)
      || (segment !== null
        && this.animatableKeys.has(segment.key)
        && (segmentAnimatableBlocks === undefined || segmentAnimatableBlocks.has(block.key)))
    // native 段由原生 disclosure 隐藏过程行，本插件不做一级收起。
    if (nativeManaged) {
      // 原生 compact 模式：过程行显示完全由原生 disclosure 行接管。本插件不做
      // 任何隐藏（含二级 chip），只把指标写进原生行；running 阶段创建的 chip 与
      // 隐藏一并还原——否则用户展开原生 disclosure 后行仍被本插件的 display:none
      // 卡死，两套折叠机制互相打架。
      const stale = this.chips.get(block.key)
      if (stale !== undefined) {
        stale.chip.remove()
        this.chips.delete(block.key)
        this.blockExpanded.delete(block.key)
      }
      this.removeMergedThink(block.host)
      this.restoreElement(block.host)
      for (const container of block.containers) this.restoreElement(container)
      for (const row of block.rows) this.restoreElement(row)
      for (const status of block.statusRows) this.restoreElement(status)
      return
    }
    const levelCollapsed = state !== undefined && !state.expanded
    // chip 是否插在 host 内部（false：flow 级 chip，锚在 block.head 之前）。
    const chipInside = block.mount === 'inside' && block.head === block.host

    if (levelCollapsed) {
      // 一级收起（v12）：宿主先行启动渐隐，后代经冻结规则随整体消失——
      // 杜绝「chip/行/合并行先瞬隐 → 宿主高度骤缩」的起步跳变。
      const keepHost = segment?.finalStep === block.host && this.hasBodyCached(block.host)
      let hostFade = false
      if (keepHost) this.restoreElement(block.host)
      else hostFade = this.hideElement(block.host, desiredHidden, animate)
      for (const container of block.containers) this.hideElement(container, desiredHidden, animate)
      for (const row of block.rows) this.hideElement(row, desiredHidden, animate)
      for (const status of block.statusRows) this.hideElement(status, desiredHidden, animate)
      // chip：flow 级是独立 seat、keepHost 时宿主仍可见——两者都需自行收起；
      // inside 级随宿主（宿主渐隐时一起消失，瞬变时才手动隐藏）。
      const existing = this.chips.get(block.key)?.chip
      if (existing !== undefined && existing.style.display !== 'none') {
        // 清收起钉住残留（二级收起 fade 中途被一级收起打断时内联 16px 仍在），
        // 避免一级再展开后 chip 带残留 margin 与 row-gap 叠成 32px。
        existing.style.marginBottom = ''
        if (!chipInside || keepHost) {
          if (animate && this.canAnimate(existing)) this.startFadeCollapse(existing)
          else existing.style.display = 'none'
        } else if (!hostFade) {
          existing.style.display = 'none'
        }
      }
      this.releaseMergedThink(block.host, animate)
      return
    }

    // 进行中回合：保留最后 keepLastRows 个系统提示行（R9）；keepLastRows>0 时
    // running 行仍按 R3 保留可见，=0 时连 running 行也不保留（全部折叠）——
    // 这样 0/1/2… 语义互不重叠。折叠判定沿用「单条不折叠」的总行数口径，
    // 保留行由下方 keepRow 决定。
    const working = segment !== null && !segment.closed
    const hasRunning = working && block.rows.some(row => rowRunning(row))
    const keepRows = segment !== null ? (keepTrailing.get(segment.key) ?? KEEP_NONE) : KEEP_NONE
    const keepRow = (row: HTMLElement): boolean => keepLastRows > 0 && ((hasRunning && rowRunning(row)) || keepRows.has(row))
    // 进行中：真正会被折叠的行数（被 keepRow 保留的行在 chip 外可见、不折叠）。
    const hiddenCount = block.rows.filter(row => !keepRow(row)).length + block.statusRows.length
    // 需求4：单条非模型输出内容（单工具/单思考/单上下文，无相邻同类）不折叠——
    // 直接还原原生展示、不出 chip。一级收起时仍随整个工作流隐藏（走上方
    // levelCollapsed 分支）。foldable 随流式推进可能从「单」变「多」（如思考
    // 后紧接工具），此时本分支不再命中、恢复正常 chip。
    // 另外：进行中若没有任何会被折叠的行（尾行全保留），不出 chip（P3 扩展）——
    // 折叠行只在确有被折叠行时出现，running 工具行本身原生可见，无需 chip 兼作状态头。
    if (blockFoldableCount(block) < 2 || (working && hiddenCount === 0)) {
      const stale = this.chips.get(block.key)
      if (stale !== undefined) {
        stale.chip.remove()
        this.chips.delete(block.key)
        this.blockExpanded.delete(block.key)
      }
      this.removeMergedThink(block.host)
      this.restoreElement(block.host, animate)
      for (const container of block.containers) this.restoreElement(container, animate)
      for (const row of block.rows) this.restoreElement(row, animate)
      for (const status of block.statusRows) this.restoreElement(status, animate)
      return
    }

    let expanded = this.blockExpanded.get(block.key) ?? false
    if (!expanded && block.rows.some(row => row.hasAttribute('data-selected'))) {
      expanded = true
      this.blockExpanded.set(block.key, true)
    }
    // R3（改）：进行中（未闭合）时不再强制整块展开。改为保持 chip 收起、
    // 逐条将已完成行折叠进 chip、running 行与最后 keepLastRows 个系统尾行
    // 留在 chip 外可见（R9）——避免 running→ok→running 切换时整块反复折叠/展开。
    const chip = this.ensureChip(block)
    // 宿主恢复接入手势门控：一级展开时「隐藏的块宿主」（如中间的
    // think+正文消息）整体淡入——它先于 middleSteps 循环执行，若瞬时恢复
    // 会删掉账本导致随后的动画路径 early-return（用户实测：第一次正文输出
    // 无动画）。二级 chip 点击时宿主必然可见，hostWasHidden=false 不受影响。
    // 但 context/command 这类 before-mounted 块可能把宿主自身作为 row；二级
    // 仍收起时宿主就是目标隐藏行，不能先 reveal 再由 rows 循环 fade，否则
    // 会闪出一条原生「上下文注入 · source」再消失。
    const hostIsCollapsedRow = !expanded && block.rows.includes(block.host)
    const hostWasHidden = block.host.style.display === 'none'
    const hostAnimate = !hostIsCollapsedRow && hostWasHidden && animate
    // chip 在 host 内部时 host 保持可见承载 chip；chip 已移出（head 是块前状态行/容器，
    // 或 mount='before'）时，host 作为内容由下方 containers/rows 循环折叠，这里不恢复。
    if (chipInside && !hostIsCollapsedRow) this.restoreElement(block.host, hostAnimate)
    // chip 出现走视觉 reveal；mount='inside' 时 chip 在动画宿主内部，
    // 随宿主一起淡入即可（跳过独立动画防双重淡入）；'before' 的流级 chip
    // 在宿主外部，仍需自身 reveal。
    // chip 是 flow 级独立节点，一级收起的渐隐不经过 restoreElement；
    // 再次展开前必须主动取消仍在途的 target:hidden 动画，否则其 onfinish
    // 会在本次展开后重新写 display:none。
    const pendingChip = this.pendingAnims.get(chip)
    if (pendingChip?.target === 'hidden') this.cancelPendingSync(chip)
    const chipWasHidden = chip.style.display === 'none'
    if (chip.style.display !== '') chip.style.display = ''
    if (chipWasHidden && animate && !(hostAnimate && chipInside)) this.revealVisual(chip)
    // 展开方向清除收起钉住（含反向仲裁：anim.cancel 不触发 settle）。
    // 收起方向只有在无在途动画时解除；同向重放期间保留 16px。
    if (expanded || !this.hasPendingCollapse(block)) this.unpinChipMargin(chip)
    // 容器先行（v12）：容器 seat 先起 reveal，其内部行走 restoreElement 的
    // 祖先在途守卫自动瞬现、骑容器的淡入——消除「容器行双重动画复合位移
    // （4px+4px≈8px）与宿主首行（4px）上升幅度不一致」。
    // 收起方向间距钉住（plan chip-margin-unification 步骤 3）：手势收起时
    // 行/容器/merged 行渐隐期间 chip 与首行的 16px 间距必须保持（v13 的
    // CSS transition 已删除），最后一条在途渐隐 settle 后同帧归零。
    // 判定用 pendingAnims 账本无状态探测（AI 评审：计数器/最后注册者在
    // cancel 路径会卡死；账本在 oncancel/onfinish 都即时清空，天然解锁）。
    const chipSettle = () => {
      if (!this.hasPendingCollapse(block)) this.unpinChipMargin(chip)
    }
    // 辅助：判断容器内是否有需保持可见的行（running 行 / 进行中轮次最后一行）。
    const containerHasKeep = (container: HTMLElement): boolean =>
      block.rows.some(row => keepRow(row) && isDescendantOf(row, container))
    for (const container of block.containers) {
      if (expanded || containerHasKeep(container)) this.restoreElement(container, animate)
      else {
        const started = this.hideElement(container, desiredHidden, animate, chipSettle)
        if (started) this.pinChipMargin(chip)
      }
    }
    for (const row of block.rows) {
      if (expanded || keepRow(row)) this.restoreElement(row, animate)
      else {
        // 二级收起：宿主自身行渐隐；容器已先行渐隐的，行走冻结规则随容器消失。
        const started = this.hideElement(row, desiredHidden, animate, chipSettle)
        if (started) this.pinChipMargin(chip)
      }
    }
    // 块内状态装饰行：随二级 chip 折叠/展开（issue #2 修复）。此前 working 时
    // 强制可见导致 chip 显示「N次重试」但重试行实际未折叠；现在统一跟随 chip
    // 的 expanded 状态——chip 收起时折叠、展开时恢复。块外状态行仍由一级折叠
    // 控制（pass 中 segment.statusRows），工作中无一级折叠故保持可见。
    for (const status of block.statusRows) {
      if (expanded) this.restoreElement(status, animate)
      else this.hideElement(status, desiredHidden, animate)
    }
    if (expanded && block.rows.length > 1 && block.rows.every(row => isThinkRow(row))) {
      this.syncMergedThink(block.host, block.rows, desiredHidden, animate)
    } else {
      // merged 行渐隐同样纳入钉住体系（AI 评审 P0：其 fade 不走 block.rows，
      // 否则思考块收起时钉住失效，v13 间距瞬跳回归）。
      if (this.releaseMergedThink(block.host, animate, chipSettle)) this.pinChipMargin(chip)
    }
    chip.classList.toggle('dshcf-has-body', chipInside && this.hasBodyCached(block.host))
    updateChip(chip, block.rows, expanded, block.statusRows, working, this.codeDescriptionProvider(), keepRows)
  }

  private ensureChip(block: Block): HTMLButtonElement {
    const chipInside = block.mount === 'inside' && block.head === block.host
    const anchor = chipInside ? block.host : block.head
    let record = this.chips.get(block.key)
    const validParent = record !== undefined && (
      chipInside
        ? record.chip.parentElement === block.host
        : record.chip.parentElement === block.head.parentElement
    )
    if (record === undefined || record.host !== block.host || !record.chip.isConnected || !validParent) {
      if (record !== undefined) {
        record.chip.remove()
        this.removeMergedThink(record.host)
      }
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'dshcf-chip'
      chip.setAttribute('aria-expanded', 'false')
      chip.setAttribute('data-dshcf-block-key', block.key)
      const leading = document.createElement('span')
      leading.className = 'dshcf-leading'
      leading.appendChild(createCommandIcon())
      chip.appendChild(leading)
      chip.appendChild(createSpan('dshcf-chip-title'))
      chip.appendChild(createSpan('dshcf-chip-sep'))
      chip.appendChild(createSpan('dshcf-chip-summary'))
      chip.appendChild(createSpan('dshcf-chip-code'))
      chip.appendChild(createSpan('dshcf-chip-failure'))
      chip.appendChild(createChevronIcon('dshcf-chevron'))
      // 新建即隐藏：由 reconcileBlock 的展开分支统一翻转显示，
      // 使「首次出现」与「收起后再现」走同一条 wasHidden → reveal 路径。
      chip.style.display = 'none'
      chip.addEventListener('click', () => {
        this.blockExpanded.set(block.key, !(this.blockExpanded.get(block.key) ?? false))
        // 触发门控：本块本轮的显示转换走动画路径（一次性，pass 消费）。
        this.animatableKeys.add(block.key)
        this.schedule()
      })
      record = { host: block.host, chip }
      this.chips.set(block.key, record)
    }

    const chip = record.chip
    if (chipInside) {
      if (chip.parentElement !== block.host || block.host.firstElementChild !== chip) block.host.prepend(chip)
      chip.classList.remove('dshcf-flow-chip')
    } else {
      if (chip.parentElement !== anchor.parentElement || chip.nextElementSibling !== anchor) anchor.before(chip)
      chip.classList.add('dshcf-flow-chip')
    }
    return chip
  }

  private suppressBlock(block: Block, desiredHidden: Set<HTMLElement>): void {
    const existing = this.chips.get(block.key)?.chip
    if (existing !== undefined && existing.style.display !== 'none') {
      // 隐藏前清收起钉住残留（AI 评审 P1：二级收起 fade 中途被 suppress
      // 打断时内联 16px 仍在，恢复显示后会与 row-gap 叠成 32px）。
      existing.style.marginBottom = ''
      existing.style.display = 'none'
    }
    this.removeMergedThink(block.host)
    this.retainDisplayControl(block.host, desiredHidden)
    for (const row of block.rows) this.retainDisplayControl(row, desiredHidden)
    for (const container of block.containers) this.retainDisplayControl(container, desiredHidden)
    for (const status of block.statusRows) this.retainDisplayControl(status, desiredHidden)
  }

  private retainDisplayControl(el: HTMLElement, desiredHidden: Set<HTMLElement>): void {
    if (this.controlledDisplay.has(el)) desiredHidden.add(el)
  }

  private cleanupStaleChips(seen: ReadonlySet<string>): void {
    for (const [key, record] of [...this.chips]) {
      if (seen.has(key)) continue
      record.chip.remove()
      this.removeMergedThink(record.host)
      this.chips.delete(key)
      this.blockExpanded.delete(key)
    }
  }

  /** 连续思考合并行：插在第一个思考行前，标题用第一行思考内容；
   * 点击切换显示/隐藏全部原始思考行。 */
  private syncMergedThink(
    host: HTMLElement,
    rows: readonly HTMLElement[],
    desiredHidden: Set<HTMLElement>,
    animate = false,
  ): void {
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
      const chevron = createChevronIcon('dshcf-chevron')
      row.append(leading, title, chevron)
      // 新建即隐藏：首次出现与再现统一走 wasHidden → reveal 路径（见下）。
      row.style.display = 'none'
      const btn = row
      btn.addEventListener('click', () => {
        // 释放渐隐中（releaseMergedThink 已把 host 摘出 mergedThinks）的
        // 行忽略点击：展开会取消 body 渐隐留下孤儿 body，settle 移除行后
        // 再展开会新建第二个内容块，同一思考内容显示两份（评审实证）。
        if (this.mergedThinks.get(host) !== btn) return
        const next = !this.mergedExpanded.has(host)
        if (next) {
          // 展开成功（内容可读）才置状态：思考行被 React 重渲染摘走的极窄
          // 竞态下 expandMergedBody 会早退，此时保持收起态，不把按钮留在
          // 「aria-expanded=true 但无内容块」的悬空态。
          if (this.expandMergedBody(host, btn)) {
            this.mergedExpanded.add(host)
            btn.setAttribute('aria-expanded', 'true')
          }
        } else {
          this.mergedExpanded.delete(host)
          btn.setAttribute('aria-expanded', 'false')
          this.collapseMergedBody(host)
        }
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
    // 合并行出现走视觉 reveal（同 chip：插件全资元素，不入账本）；
    // 原生思考行随后的 hideElement 会取消它们自己在本次 pass 的 reveal——
    // 视觉上由合并行的 reveal 替代，不闪现。
    const rowWasHidden = row.style.display === 'none'
    if (row.style.display !== '') row.style.display = ''
    if (rowWasHidden && animate) this.revealVisual(row)
    for (const r of rows) this.hideElement(r, desiredHidden)
    // 展开态且内容块缺失（React 重渲染清掉 / 跨折叠周期重建）→ 用缓存重建；
    // 手势路径下静默新建的 body 也接高度动画，否则「详细内容」瞬现
    // （mergedExpanded 持久化时，点击思考过程会因 created=false 跳过 reveal）。
    if (expanded) {
      const result = this.ensureMergedBody(host, row, false)
      if (result !== null && result.created && animate) this.revealMergedBody(result.body)
    }
  }

  /** 展开合并行：直接读各思考行文本合成内容块（不依赖原生行展开：
   * 程序化 click 不触发 React 展开，且后台 tab 的 rAF 不执行）。
   * 返回是否成功——思考行已不可读（parts 为空）时返回 false，调用方
   * 据此保持收起态，避免展开状态与内容块脱节。 */
  private expandMergedBody(host: HTMLElement, btn: HTMLButtonElement): boolean {
    const cached = this.mergedBodyTexts.get(host)
    if (cached === undefined) {
      const parts = this.currentThinkRows(host)
        .map(r => r.textContent.replace(/^Think\s*/, '').trim())
        .filter(Boolean)
      if (parts.length === 0) return false
      this.mergedBodyTexts.set(host, parts.join('\n\n'))
    }
    const result = this.ensureMergedBody(host, btn, true)
    if (result === null) return false
    if (result.created) {
      this.revealMergedBody(result.body)
    } else {
      // 在途收起（高度卷下）反向仲裁：同步取消并清锁，恢复完整布局。
      this.cancelPendingSync(result.body)
    }
    return true
  }

  /** 创建/更新合并内容块（缓存优先，不重新展开原生行）。
   * 返回内容块与其是否为本次新建（新建才走展开动画）。 */
  private ensureMergedBody(
    host: HTMLElement,
    btn: HTMLButtonElement,
    force: boolean,
  ): { body: HTMLElement; created: boolean } | null {
    const cached = this.mergedBodyTexts.get(host)
    if (cached === undefined) return null
    let body = btn.nextElementSibling
    let created = false
    if (body === null || !body.classList.contains('dshcf-merged-body')) {
      const next = document.createElement('div')
      next.className = 'dshcf-merged-body'
      btn.after(next)
      body = next
      created = true
    }
    if (force || body.textContent !== cached) body.textContent = cached
    return { body: body as HTMLElement, created }
  }

  /** 清理合并 think 行（v12）：状态 map 立即清除；DOM 在手势动画路径下
   * 渐隐后移除（settle 回调），其余路径瞬删。渐隐中途被反向取消时元素
   * 保留，由后续 pass 的 syncMergedThink 重建/复用。
   * settle 透传给每个渐隐目标的移除回调之后（chip 间距钉住的结算探测点，
   * AI 评审 P0：merged 行渐隐不走 block.rows，必须纳入同一钉住体系）。 */
  private releaseMergedThink(host: HTMLElement, animate = false, settle?: () => void): boolean {
    const row = this.mergedThinks.get(host)
    this.mergedExpanded.delete(host)
    this.mergedBodyTexts.delete(host)
    if (row === undefined) return false
    this.mergedThinks.delete(host)
    const body = row.nextElementSibling
    const targets: HTMLElement[] = body !== null && body.classList.contains('dshcf-merged-body') ? [row, body as HTMLElement] : [row]
    if (animate && this.canAnimate(row)) {
      for (const t of targets) this.startFadeCollapse(t, () => { t.remove(); settle?.() })
      return true
    } else {
      for (const t of targets) t.remove()
      return false
    }
  }

  /** merged-body 展开高度动画（机制样板：插件全资 DOM）。
   * 关键帧含 marginBottom 0→16px——其 CSS 有常量 margin-bottom:16px，
   * 高度从 0 起步时这 16px 会先占位产生小跳变。fill:'forwards' 托住终态，
   * onfinish 清内联后 cancel 释放，无闪烁窗口。收起由 collapseMergedBody
   * 做镜像高度卷下（同款账本与身份守卫），开合对称。 */
  private revealMergedBody(body: HTMLElement): void {
    if (!this.canAnimate(body)) return
    // 防御：同元素旧动画条目先同步取消（当前 created 每 body 一生一次、不可达，
    // 但若未来二次 reveal，旧 fill:'forwards' 会永久占位且守卫空转——v9 评审 P3）。
    this.cancelPendingSync(body)
    const targetHeight = body.getBoundingClientRect().height
    if (!(targetHeight > 0)) return
    body.style.height = '0px'
    body.style.overflow = 'hidden'
    body.style.marginBottom = '0px'
    const anim = body.animate(
      [
        { height: '0px', marginBottom: '0px' },
        { height: `${targetHeight}px`, marginBottom: '16px' },
      ],
      { duration: ANIM_DURATION_MS, easing: ANIM_EASING, fill: 'forwards' },
    )
    const record: PendingAnim = { anim, target: 'visible', kind: 'height' }
    this.pendingAnims.set(body, record)
    anim.onfinish = () => {
      if (this.pendingAnims.get(body) !== record) return
      this.pendingAnims.delete(body)
      body.style.height = ''
      body.style.overflow = ''
      body.style.marginBottom = ''
      anim.cancel()
      this.schedule()
    }
    anim.oncancel = () => {
      if (this.pendingAnims.get(body) !== record) return
      this.pendingAnims.delete(body)
    }
  }

  /** 收起合并行：内容块高度卷下后移除——镜像 revealMergedBody 的唯一几何动画，
   * 开合对称。插件全资静态文本 DOM、无 React 协调竞争，可安全做几何收起
   * （与 seat 级拒绝盲卷的场景不同：那里是 React 混杂多卡片）。
   * reduced-motion / 无 WAAPI / 零高度降级为同步 remove()。 */
  private collapseMergedBody(host: HTMLElement): void {
    const btn = this.mergedThinks.get(host)
    if (btn === undefined) return
    const body = btn.nextElementSibling
    if (body === null || !body.classList.contains('dshcf-merged-body')) return
    const el = body as HTMLElement
    if (!this.canAnimate(el)) {
      el.remove()
      return
    }
    // 在途展开动画先同步取消（clearCollapseLock 清锁高内联），落到自然布局再测当前高度。
    this.cancelPendingSync(el)
    const current = el.getBoundingClientRect().height
    if (!(current > 0)) {
      el.remove()
      return
    }
    el.style.height = `${current}px`
    el.style.overflow = 'hidden'
    const anim = el.animate(
      [
        { height: `${current}px`, marginBottom: '16px' },
        { height: '0px', marginBottom: '0px' },
      ],
      { duration: ANIM_DURATION_MS, easing: ANIM_EASING, fill: 'forwards' },
    )
    const record: PendingAnim = { anim, target: 'hidden', kind: 'height' }
    this.pendingAnims.set(el, record)
    anim.onfinish = () => {
      if (this.pendingAnims.get(el) !== record) return
      this.pendingAnims.delete(el)
      el.remove()
      anim.cancel()
      this.schedule()
    }
    anim.oncancel = () => {
      // 反向取消（收起中途再点展开）：清锁恢复自然布局，body 留在 DOM 由展开路径接管。
      if (this.pendingAnims.get(el) !== record) return
      this.pendingAnims.delete(el)
      this.clearCollapseLock(el)
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

  /** 正文判定（带缓存）：同一消息子树未变时直接复用上次结果。失效由
   * markDirty（mutation 定向）与 switchFlow（整体重置）驱动；缓存的是
   * 纯文本/媒体存在性判定，与 display 状态无关，插件自身的显隐切换
   * 不会产生脏数据。 */
  private hasBodyCached(el: HTMLElement): boolean {
    const cached = this.bodyTextCache.get(el)
    if (cached !== undefined) return cached
    const value = hasBodyContent(el)
    this.bodyTextCache.set(el, value)
    return value
  }

  /** 本块是否有在途收起渐隐（rows/containers/merged 行/body 任一）。
   * 基于 pendingAnims 账本无状态判定：onfinish/oncancel 都会即时清账，
   * 取消路径天然解锁（计数器/最后注册者会卡死）。merged 行渐隐时已被
   * releaseMergedThink 摘出 mergedThinks，按 DOM 类名现查。 */
  private hasPendingCollapse(block: Block): boolean {
    const check = (el: HTMLElement | null | undefined): boolean =>
      el !== null && el !== undefined && this.pendingAnims.get(el)?.target === 'hidden'
    if (block.containers.some(check)) return true
    if (block.rows.some(check)) return true
    const mergedRow = block.host.querySelector<HTMLElement>('.dshcf-merged-think')
    if (check(mergedRow)) return true
    const mergedBody = mergedRow?.nextElementSibling
    if (mergedBody instanceof HTMLElement && check(mergedBody)) return true
    return false
  }

  /** 钉住 chip 与首行的 16px 间距（收起 fade 期间；内联优先于 aria=false 的 0）。
   * flow-chip（context 等 before-mounted）豁免：其间距由宿主 row-gap 16px
   * 提供、自身 CSS 恒 0，钉住 16px 会叠加成 32px（真机实测：收起上下文
   * 注入时二级与三级间距瞬间扩大）。
   */
  private pinChipMargin(chip: HTMLButtonElement): void {
    if (chip.classList.contains('dshcf-flow-chip')) return
    if (chip.style.marginBottom !== '16px') chip.style.marginBottom = '16px'
  }

  /** 解除钉住（aria=true 的 16px 或 aria=false 的 0 由 CSS 接管）。 */
  private unpinChipMargin(chip: HTMLButtonElement): void {
    if (chip.style.marginBottom !== '') chip.style.marginBottom = ''
  }

  /** 返回 true 表示启动了渐隐动画（调用方可据此决定内部元素的处置）。
   * settle 在渐隐自然结束时调用（onfinish 链；反向取消不触发）。 */
  private hideElement(el: HTMLElement, desired: Set<HTMLElement>, animate = false, settle?: () => void): boolean {
    // 意图登记先行：无论后续走哪条路径（含同向仲裁早退），本 pass 都期望
    // 该元素隐藏——否则 restoreUnusedDisplays 会把在途收起动画误判为「不再
    // 需要」而反向取消（在途动画 × 后续 pass 的经典竞争）。
    desired.add(el)
    // 冲突仲裁：在途动画同向（目标隐藏）视为已满足；反向取消后写终态。
    const pending = this.pendingAnims.get(el)
    if (pending !== undefined) {
      if (pending.target === 'hidden') return false
      this.cancelPendingSync(el)
    }
    if (!this.originalDisplay.has(el) && !isDisplayed(el)) return false
    // 冻结规则（v12）：祖先 seat 在途动画时后代保持原状——随祖先整体淡出/
    // 淡入呈现。否则「内部瞬隐 → 宿主高度骤缩」会在渐隐起步产生跳变；
    // 意图已登记，不会被 restoreUnusedDisplays 反向恢复，结算后由后续 pass 处理。
    if (this.hasAnimatingAncestor(el)) return false
    if (!this.originalDisplay.has(el)) this.originalDisplay.set(el, el.style.display)
    this.controlledDisplay.add(el)
    if (el.style.display === 'none') return false
    // 手势收起 = 渐隐（镜像 reveal 的 fade），淡完 onfinish 瞬切隐藏。
    // 不锁高、不做 gap 补偿——真机验证高度卷帘方案存在起步瞬切/中途 gap 跳/
    // 末尾 margin 回弹三段跳变，用户裁决弃用（v11）。
    if (animate && this.canAnimate(el)) {
      this.startFadeCollapse(el, settle)
      return true
    }
    el.style.display = 'none'
    return false
  }

  private restoreElement(el: HTMLElement, animate = false): void {
    // 冲突仲裁：在途动画同向（目标可见）视为已满足，账本留给 onfinish 对齐；
    // 反向取消后写终态。同步 delete 并清收起锁高内联，异步 oncancel 靠身份守卫自保。
    const pending = this.pendingAnims.get(el)
    if (pending !== undefined) {
      if (pending.target === 'visible') return
      this.cancelPendingSync(el)
    }
    if (!this.originalDisplay.has(el)) return
    const original = this.originalDisplay.get(el) as string
    // 祖先 seat 在途动画时跳过后代申请（防双重淡入/淡出与高度锁竞争）：
    // 后代随祖先的 overflow 裁剪与整体过渡呈现，自身走瞬变终态。
    if (!animate || !this.canAnimate(el) || this.hasAnimatingAncestor(el)) {
      if (el.style.display !== original) el.style.display = original
      this.originalDisplay.delete(el)
      this.controlledDisplay.delete(el)
      return
    }
    // 动画路径（展开）：占位即刻出现，内容淡入 + 微位移。账本双条目保持到
    // onfinish 对齐（终态可见 = 双删除，镜像 restoreElement 契约）。
    if (el.style.display !== original) el.style.display = original
    this.startReveal(el)
  }

  /** 是否可动画：WAAPI 特性检测 + reduced-motion 门控（均做 typeof 防桩缺失）。 */
  private canAnimate(el: HTMLElement): boolean {
    if (typeof el.animate !== 'function') return false
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    return true
  }

  /** 展开方向淡入（opacity + 4px 微位移）：无高度分量、零布局读取。
   * onfinish 按终态可见对齐账本（双删除）并 schedule() 幂等重同步；
   * oncancel 只做身份守卫删除——取消方的终态写入自己负责。 */
  private startReveal(el: HTMLElement): void {
    const anim = el.animate(
      [
        { opacity: '0', transform: 'translateY(4px)' },
        { opacity: '1', transform: 'translateY(0)' },
      ],
      { duration: ANIM_DURATION_MS, easing: ANIM_EASING },
    )
    const record: PendingAnim = { anim, target: 'visible', kind: 'fade' }
    this.pendingAnims.set(el, record)
    anim.onfinish = () => {
      if (this.pendingAnims.get(el) !== record) return
      this.pendingAnims.delete(el)
      this.originalDisplay.delete(el)
      this.controlledDisplay.delete(el)
      this.schedule()
    }
    anim.oncancel = () => {
      if (this.pendingAnims.get(el) !== record) return
      this.pendingAnims.delete(el)
    }
  }

  /** 同步取消在途动画并清账：收起动画需同时清锁高内联（height/overflow/
   * marginBottom），否则取消方写完终态后元素仍被锁高裁剪一帧以上。 */
  private cancelPendingSync(el: HTMLElement): void {
    const pending = this.pendingAnims.get(el)
    if (pending === undefined) return
    pending.anim.cancel()
    this.pendingAnims.delete(el)
    if (pending.kind === 'height') this.clearCollapseLock(el)
  }

  private clearCollapseLock(el: HTMLElement): void {
    el.style.height = ''
    el.style.overflow = ''
    el.style.marginBottom = ''
    el.style.boxSizing = ''
  }

  /** 祖先 seat 在途动画检测：沿 parentNode 走到 flow，任一祖先在 pendingAnims
   * 即视为在途。分层规则——同一视觉变化只动画一层。 */
  private hasAnimatingAncestor(el: HTMLElement): boolean {
    const flow = this.flow
    if (flow === null) return false
    let node = el.parentElement
    while (node !== null && node !== flow) {
      if (this.pendingAnims.has(node as HTMLElement)) return true
      node = node.parentElement
    }
    return false
  }

  /** 收起方向渐隐动画（v11 定稿）：镜像 reveal 的 opacity + 4px 微位移，
   * 淡完 onfinish 写 display:none 并保持双条目（镜像 hideElement 终态契约）。
   * fill:'forwards' 占位到终态写入后释放；无几何锁、无 gap 补偿。 */
  private startFadeCollapse(el: HTMLElement, settle?: () => void): void {
    const anim = el.animate(
      [
        { opacity: '1', transform: 'translateY(0)' },
        { opacity: '0', transform: 'translateY(4px)' },
      ],
      { duration: ANIM_DURATION_MS, easing: ANIM_EASING, fill: 'forwards' },
    )
    const record: PendingAnim = { anim, target: 'hidden', kind: 'fade' }
    this.pendingAnims.set(el, record)
    anim.onfinish = () => {
      if (this.pendingAnims.get(el) !== record) return
      this.pendingAnims.delete(el)
      if (el.style.display !== 'none') el.style.display = 'none'
      // settle：渐隐自然结束后的延迟清理（如 DOM 移除）；反向取消不执行。
      settle?.()
      anim.cancel()
      this.schedule()
    }
    anim.oncancel = () => {
      if (this.pendingAnims.get(el) !== record) return
      this.pendingAnims.delete(el)
    }
  }

  /** 轻量视觉 reveal（opacity + 4px 微位移）：用于插件全资元素的即时显示
   * 路径——chip（一级展开时出现）与 merged-think 行（二级展开时出现）。
   * 这些元素的 display 完全由插件直写、无 React 协调竞争，因此不入
   * pendingAnims 账本、无仲裁；收起同为直写 display:none，无 fill 的在途
   * 动画残留在隐藏元素上自然失效。门控沿用 animate 布尔（手势路径才调）。 */
  private revealVisual(el: HTMLElement): void {
    if (!this.canAnimate(el)) return
    el.animate(
      [
        { opacity: '0', transform: 'translateY(4px)' },
        { opacity: '1', transform: 'translateY(0)' },
      ],
      { duration: ANIM_DURATION_MS, easing: ANIM_EASING },
    )
  }

  private restoreUnusedDisplays(desired: ReadonlySet<HTMLElement>): void {
    for (const el of [...this.controlledDisplay]) {
      if (!desired.has(el)) this.restoreElement(el)
    }
  }

  private restoreAllDisplays(): void {
    for (const el of [...this.controlledDisplay]) this.restoreElement(el)
    this.controlledDisplay.clear()
    this.originalDisplay = new WeakMap<HTMLElement, string>()
  }
}

/** 解析以 K/M 为单位的紧凑 token 数字（如 "1.2K"、"856"、"1.5M"）。 */
function parseFormattedTokenCount(str: string): number | undefined {
  const m = str.trim().match(/^(\d+(?:\.\d+)?)\s*(K|M)?$/i)
  if (m === null) return undefined
  const num = Number(m[1])
  if (m[2] !== undefined) {
    if (m[2].toUpperCase() === 'K') return Math.round(num * 1000)
    if (m[2].toUpperCase() === 'M') return Math.round(num * 1000000)
  }
  return Math.round(num)
}

/** 从文本中提取 token 计数（支持中英文多种格式）。 */
function extractTokenCountsFromText(text: string): { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } {
  const result: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } = {}

  // 模式1: "1.2K输入 · 856输出 · 324推理" 或 "1.2K input · 856 output · 324 reasoning"
  // 匹配 "数字+单位?+标签" 格式，标签前后可能有空格/分隔符
  const tokenPattern = /(\d+(?:\.\d+)?)\s*(K|M)?\s*(输入|input|输出|output|推理|reasoning|rsn)/gi
  let match
  while ((match = tokenPattern.exec(text)) !== null) {
    const raw = match[1]
    const unit = (match[2] ?? '').toUpperCase()
    const label = match[3].toLowerCase()
    let num = Number(raw)
    if (unit === 'K') num *= 1000
    else if (unit === 'M') num *= 1000000
    num = Math.round(num)

    if (label === '输入' || label === 'input') result.inputTokens = num
    else if (label === '输出' || label === 'output') result.outputTokens = num
    else if (label === '推理' || label === 'reasoning' || label === 'rsn') result.reasoningTokens = num
  }

  // 模式2: "token 输入 1234" / "token output 856" / "input tokens 1234" / "output tokens 856"
  // 标签在前，数字在后
  const tokenPattern2 = /(输入|input|输出|output|推理|reasoning|rsn)\s*(?:tokens?|token)?\s*(\d+(?:\.\d+)?)\s*(K|M)?/gi
  while ((match = tokenPattern2.exec(text)) !== null) {
    const label = match[1].toLowerCase()
    const raw = match[2]
    const unit = (match[3] ?? '').toUpperCase()
    let num = Number(raw)
    if (unit === 'K') num *= 1000
    else if (unit === 'M') num *= 1000000
    num = Math.round(num)

    if (label === '输入' || label === 'input') {
      if (result.inputTokens === undefined) result.inputTokens = num
    } else if (label === '输出' || label === 'output') {
      if (result.outputTokens === undefined) result.outputTokens = num
    } else if (label === '推理' || label === 'reasoning' || label === 'rsn') {
      if (result.reasoningTokens === undefined) result.reasoningTokens = num
    }
  }

  // 模式3: DSH 官方 StatsLine 格式 "输入 1.2K tok · 输出 856 tok"
  const tokenPattern3 = /(输入|input|输出|output|推理|reasoning|rsn)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(K|M)?\s*(?:tok|tokens|token)\b/gi
  while ((match = tokenPattern3.exec(text)) !== null) {
    const label = match[1].toLowerCase()
    const raw = match[2]
    const unit = (match[3] ?? '').toUpperCase()
    let num = Number(raw)
    if (unit === 'K') num *= 1000
    else if (unit === 'M') num *= 1000000
    num = Math.round(num)
    if (label === '输入' || label === 'input') {
      if (result.inputTokens === undefined) result.inputTokens = num
    } else if (label === '输出' || label === 'output') {
      if (result.outputTokens === undefined) result.outputTokens = num
    } else if (label === '推理' || label === 'reasoning' || label === 'rsn') {
      if (result.reasoningTokens === undefined) result.reasoningTokens = num
    }
  }

  // 模式4: "数字[单位] input/output/reasoning tokens"（如 "1.2K input tokens"）
  const tokenPattern4 = /(\d+(?:\.\d+)?)\s*(K|M)?\s*(input|output|reasoning|rsn)\s*(?:tokens?|token)\b/gi
  while ((match = tokenPattern4.exec(text)) !== null) {
    const raw = match[1]
    const unit = (match[2] ?? '').toUpperCase()
    const label = match[3].toLowerCase()
    let num = Number(raw)
    if (unit === 'K') num *= 1000
    else if (unit === 'M') num *= 1000000
    num = Math.round(num)
    if (label === 'input') {
      if (result.inputTokens === undefined) result.inputTokens = num
    } else if (label === 'output') {
      if (result.outputTokens === undefined) result.outputTokens = num
    } else if (label === 'reasoning' || label === 'rsn') {
      if (result.reasoningTokens === undefined) result.reasoningTokens = num
    }
  }

  return result
}

/** 简单文本拼接辅助：避免额外空字符串污染。 */
function wordWrapSafe(...parts: string[]): string {
  return parts.join(' ').replace(/\s+/g, ' ')
}

/** 从 turn-tail DOM 元素提取回合指标数据。
 * 在 DSH Web 中，turn-tail 元素包含 token 用量和终止状态信息。
 * turnTail 可为 null：被中断的末段没有 turn-tail 边界时，仅能走模块级 Map /
 * DOM 属性路径（路径1/2），文本解析类兜底（时长/usage/token 文本）自然跳过。
 */
function extractTurnMetrics(turnTail: HTMLElement | null, turn: number | undefined, sessionId: string | undefined, segOrdinal = 0): TurnMetrics | undefined {
  const text = turnTail?.textContent ?? ''
  const metrics: TurnMetrics = {}

  // 优先读取指标注入器（turn-metrics.ts shadow 渲染器）写入的精确值。
  // 注入器在 React 层按 node.location.turn.turn === turn 精确归属后，
  // publishTurnMetrics(turn, metrics) 到模块级 Map 并写 DOM data-dshcf-turn-metrics。
  // 这里按 turn 号精确读取，不再用 DOM 位置就近匹配——后者在中断/插话场景
  // 会导致 turn B 取到 turn A 的注入值（错位 bug）。
  //
  // 路径1：模块级 Map（最精确，注入器 publishTurnMetrics 的权威源）
  if (turn !== undefined && sessionId !== undefined) {
    const published = readTurnMetrics(sessionId, turn, segOrdinal)
    if (published) {
      if (typeof published.toolCalls === 'number' && published.toolCalls > 0) metrics.toolCalls = published.toolCalls
      if (typeof published.modelCalls === 'number' && published.modelCalls > 0) metrics.modelCalls = published.modelCalls
      if (typeof published.inputTokens === 'number' && published.inputTokens > 0) metrics.inputTokens = published.inputTokens
      if (typeof published.outputTokens === 'number' && published.outputTokens > 0) metrics.outputTokens = published.outputTokens
      if (typeof published.reasoningTokens === 'number' && published.reasoningTokens > 0) metrics.reasoningTokens = published.reasoningTokens
      if (typeof published.cacheReadTokens === 'number' && published.cacheReadTokens > 0) metrics.cacheReadTokens = published.cacheReadTokens
      if (typeof published.cacheWriteTokens === 'number' && published.cacheWriteTokens > 0) metrics.cacheWriteTokens = published.cacheWriteTokens
      if (typeof published.tokensPerSecond === 'number' && published.tokensPerSecond > 0) metrics.tokensPerSecond = published.tokensPerSecond
      if (typeof published.durationMs === 'number' && published.durationMs > 0) metrics.durationMs = published.durationMs
      if (typeof published.lastModelInputTokens === 'number' && published.lastModelInputTokens > 0) metrics.lastModelInputTokens = published.lastModelInputTokens
      if (typeof published.turnStartTime === 'number' && published.turnStartTime > 0) metrics.turnStartTime = published.turnStartTime
      if (typeof published.turnEndTime === 'number' && published.turnEndTime > 0) metrics.turnEndTime = published.turnEndTime
    }
  }
  // 路径2：DOM data-dshcf-turn-metrics 属性（注入器 useEffect 写入），按 turn+seg 号过滤
  if (turn !== undefined) {
    try {
      const flowEl = turnTail?.closest('[data-chat-flow]') ?? null
      const hosts = flowEl === null
        ? document.querySelectorAll<HTMLElement>('[data-dshcf-turn-metrics]')
        : flowEl.querySelectorAll<HTMLElement>('[data-dshcf-turn-metrics]')
      const turnStr = String(turn)
      const segStr = String(segOrdinal)
      for (const h of hosts) {
        if (h.getAttribute('data-dshcf-turn') !== turnStr) continue
        if (sessionId !== undefined && h.getAttribute('data-dshcf-session') !== sessionId) continue
        // 缺少 data-dshcf-seg 的旧注入器产物视为 seg 0（仅匹配 segOrdinal=0 的段）
        const hostSeg = h.getAttribute('data-dshcf-seg') ?? '0'
        if (hostSeg !== segStr) continue
        if (h.getAttribute('data-dshcf-turn-metrics') === '') continue
        const injected = JSON.parse(h.getAttribute('data-dshcf-turn-metrics') ?? '{}')
        // 逐字段兜底：只补模块级 Map 未提供的字段
        if (metrics.toolCalls === undefined && typeof injected.toolCalls === 'number' && injected.toolCalls > 0) metrics.toolCalls = injected.toolCalls
        if (metrics.modelCalls === undefined && typeof injected.modelCalls === 'number' && injected.modelCalls > 0) metrics.modelCalls = injected.modelCalls
        if (metrics.inputTokens === undefined && typeof injected.inputTokens === 'number' && injected.inputTokens > 0) metrics.inputTokens = injected.inputTokens
        if (metrics.outputTokens === undefined && typeof injected.outputTokens === 'number' && injected.outputTokens > 0) metrics.outputTokens = injected.outputTokens
        if (metrics.reasoningTokens === undefined && typeof injected.reasoningTokens === 'number' && injected.reasoningTokens > 0) metrics.reasoningTokens = injected.reasoningTokens
        if (metrics.cacheReadTokens === undefined && typeof injected.cacheReadTokens === 'number' && injected.cacheReadTokens > 0) metrics.cacheReadTokens = injected.cacheReadTokens
        if (metrics.cacheWriteTokens === undefined && typeof injected.cacheWriteTokens === 'number' && injected.cacheWriteTokens > 0) metrics.cacheWriteTokens = injected.cacheWriteTokens
        if (metrics.tokensPerSecond === undefined && typeof injected.tokensPerSecond === 'number' && injected.tokensPerSecond > 0) metrics.tokensPerSecond = injected.tokensPerSecond
        if (metrics.durationMs === undefined && typeof injected.durationMs === 'number' && injected.durationMs > 0) metrics.durationMs = injected.durationMs
        if (metrics.lastModelInputTokens === undefined && typeof injected.lastModelInputTokens === 'number' && injected.lastModelInputTokens > 0) metrics.lastModelInputTokens = injected.lastModelInputTokens
        break // 找到本 turn 的 host 即可（同一 turn 所有 host 值相同）
      }
    } catch { /* 注入数据不存在或非法时忽略，走文本解析兜底 */ }
  }

  // 解析耗时（仅当记录级/注入值未提供时兜底：不得覆盖 turnTimings 发布的 durationMs）
  if (metrics.durationMs === undefined) {
    const durMatch = text.match(/用时\s*(\d+)分(\d+)秒|用时\s*(\d+)秒/)
    if (durMatch !== null) {
      if (durMatch[1] !== undefined && durMatch[2] !== undefined) metrics.durationMs = Number(durMatch[1]) * 60000 + Number(durMatch[2]) * 1000
      else if (durMatch[3] !== undefined) metrics.durationMs = Number(durMatch[3]) * 1000
    }
  }

  // 解析 tokensPerSecond（如 "66 tok/s"）
  const tpsMatch = text.match(/(\d+(?:\.\d+)?)\s*tok\/s/)
  if (tpsMatch !== null) metrics.tokensPerSecond = Number(tpsMatch[1])

  // 解析 data-usage 属性（可能存在于 turn-tail 内部元素）——旧版 DSH 或某些插件可能注入
  // DSH 的 usage.inputTokens 是未缓存输入，总输入需加 cacheRead+cacheWrite（同
  // dsh-token-meter pressureFrom），否则有缓存命中时显示偏小。
  // 注意：只填充模块级 Map / DOM 属性尚未提供的字段，避免覆盖注入器精确值。
  const usageEl = turnTail?.querySelector('[data-usage]') ?? null
  if (usageEl !== null) {
    try {
      const usage = JSON.parse(usageEl.getAttribute('data-usage') ?? '{}')
      if (metrics.inputTokens === undefined && typeof usage.inputTokens === 'number') {
        let total = usage.inputTokens
        if (typeof usage.cacheReadTokens === 'number') total += usage.cacheReadTokens
        if (typeof usage.cacheWriteTokens === 'number') total += usage.cacheWriteTokens
        metrics.inputTokens = total
      }
      if (metrics.outputTokens === undefined && typeof usage.outputTokens === 'number') metrics.outputTokens = usage.outputTokens
      if (metrics.cacheReadTokens === undefined && typeof usage.cacheReadTokens === 'number') metrics.cacheReadTokens = usage.cacheReadTokens
      if (metrics.cacheWriteTokens === undefined && typeof usage.cacheWriteTokens === 'number') metrics.cacheWriteTokens = usage.cacheWriteTokens
      if (metrics.reasoningTokens === undefined && typeof usage.reasoningTokens === 'number') metrics.reasoningTokens = usage.reasoningTokens
    } catch { /* ignore parse errors */ }
  }

  // 若 data-usage 未提供全部 token 数据，则从文本内容解析（turn-tail 文本 + 本回合相邻的 token 来源）
    // 若 data-usage 未提供全部 token 数据，则从多种 DOM 来源解析（并行多路）
  // 1. dsh-turn-fold 摘要栏 [data-dsh-summary-owner] （单回合精确值）
  // 2. DSH 会话 StatsLine（按内容特征定位，不依赖 hash 类名）
  if (metrics.inputTokens === undefined || metrics.outputTokens === undefined || metrics.reasoningTokens === undefined) {
    const candidates: string[] = []
    // --- 来源1: 局部化扫描（仅 turnTail 所在 flow 内且 与 turnTail 相关的最近摘要栏，避免跨回合污染） ---
    if (typeof document !== 'undefined' && turnTail !== null) {
      const root = turnTail.closest('[data-chat-flow]') ?? document
      const BEFORE = Node.DOCUMENT_POSITION_PRECEDING
      const CONTAINS = Node.DOCUMENT_POSITION_CONTAINED_BY
      let nearest = null
      let nearestIsSelf = false
      for (const sel of ['[data-dsh-summary-owner]', '[data-ch4acko3-dsh-turn-fold-summary]', '.__ch4acko3-dsh-turn-fold__label', '.ccg-header-title', '.ccg-header-fallback .ccg-title']) {
        for (const el of root.querySelectorAll(sel)) {
          if (nearestIsSelf) break
          const t = (el.textContent ?? '').trim()
          if (t.length < 2 || !/(tok|token|input|output|reasoning|\u6d88\u8017|\u7f13\u5b58|token\u3226?)/i.test(t)) continue
          const pos = el.compareDocumentPosition(turnTail)
          const inSelf = (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) !== 0
          const before = (pos & BEFORE) !== 0
          if (inSelf) { nearest = el; nearestIsSelf = true; break }
          if (before) nearest = el
        }
        if (nearestIsSelf) break
      }
      if (nearest !== null) candidates.push(nearest.textContent ?? '')
      // --- 来源2: StatsLine 子节点（flow 内；真实 DOM 才扫描 '*'，fake-dom 不支持 '*'） ---
      try {
        let statsRoot = null
        for (const el of root.querySelectorAll('*')) {
          const t = el.textContent ?? ''
          if (t.length > 3 && t.length < 500 && t.includes('tok')) {
            const pos = el.compareDocumentPosition(turnTail)
            const ok = (pos & BEFORE) !== 0 || (pos & CONTAINS) !== 0
            if (ok && (statsRoot === null || el.children.length < statsRoot.children.length)) statsRoot = el
          }
        }
        if (statsRoot !== null) candidates.push(statsRoot.textContent ?? '')
      } catch { /* fake-dom 不支持 '*' 选择器；生产环境不会触发 */ }
    }
    // --- 合并去重后解析 ---
    const combined = wordWrapSafe(text, ...candidates)
    const tokenCounts = extractTokenCountsFromText(combined)
    // 逐字段独立兜底：只补缺失字段，不覆盖 data-usage 已提供的精确值
    if (metrics.inputTokens === undefined && tokenCounts.inputTokens !== undefined) metrics.inputTokens = tokenCounts.inputTokens
    if (metrics.outputTokens === undefined && tokenCounts.outputTokens !== undefined) metrics.outputTokens = tokenCounts.outputTokens
    if (metrics.reasoningTokens === undefined && tokenCounts.reasoningTokens !== undefined) metrics.reasoningTokens = tokenCounts.reasoningTokens
  }

  // 解析 timeToFirstToken（"首token X秒" / "ttft X秒" 等，turn-tail 或相邻摘要文本）
  if (metrics.timeToFirstToken === undefined) {
    const ttftMatch = text.match(/首\s?token\s*(\d+(?:\.\d+)?)\s*秒|ttft\s*(\d+(?:\.\d+)?)\s*s/i)
    if (ttftMatch !== null) metrics.timeToFirstToken = Math.round(Number(ttftMatch[1] ?? ttftMatch[2]) * 1000)
  }

  // 检测终止状态
  if (text.includes('已停止') || text.includes('Stopped')) metrics.termination = 'aborted'
  else if (text.includes('已中断') || text.includes('Interrupted')) metrics.termination = 'interrupted'

  // 工具/模型调用次数由注入器（turn-metrics.ts）按 location.turn.turn 精确归属到
  // 当前回合后写入 data-dshcf-turn-metrics，上方已读取。此处不再用
  // turnTail.parentElement.querySelectorAll 做全局统计——那会统计整个 flow
  // （所有回合的 data-chat-call-id / assistant-step），导致每个回合都显示
  // 会话总数（"多个轮次显示相同统计结果"的重复 bug）。

  // 交叉回合上下文增量：本轮新增上下文 = 本回合末模型输入 - 上一回合末模型输入。
  // 需求1：首轮（turn 1）无上一回合，基线取 0 → contextDelta = 本回合末输入；
  // turn > 1 但上一回合末输入缺失（窗口截断等）保持 undefined，不臆造基线。
  if (turn !== undefined && sessionId !== undefined && metrics.lastModelInputTokens !== undefined) {
    const prev = readPreviousTurnLastInput(sessionId, turn, segOrdinal)
    if (prev !== undefined) metrics.contextDelta = metrics.lastModelInputTokens - prev
    else if (turn === 1 && segOrdinal === 0) metrics.contextDelta = metrics.lastModelInputTokens
  }

  return Object.keys(metrics).length > 0 ? metrics : undefined
}

/** 从 segment 的 DOM 元素提取 (turn 号, 会话 id, 段序号)，供折叠层按记录级数据取指标。
 * turn 优先级（越靠前越权威）：① turn-tail 的 data-turn-tail（同步、稳定、记录级）
 * ② 注入器同步写的 data-dshcf-turn ③ buildSegments 按 user 边界算出的位置兜底号。
 * sessionId 读注入器写的 data-dshcf-session；segment 自身候选缺失时回退整个 flow
 * 里任意注入器 host 的 data-dshcf-session（同 flow 即同会话）。segOrdinal 优先取
 * buildSegments 算出的 segment.segOrdinal，兜底读注入器写的 data-dshcf-seg。 */
function segmentMetricsKeys(segment: SegmentSnapshot): { turn: number | undefined; sessionId: string | undefined; segOrdinal: number } {
  const candidates: HTMLElement[] = []
  if (segment.boundary !== null) candidates.push(segment.boundary)
  if (segment.finalStep !== null) candidates.push(segment.finalStep)
  for (const block of segment.blocks) {
    candidates.push(block.host)
    for (const row of block.rows) candidates.push(row)
  }
  for (const step of segment.middleSteps) candidates.push(step)
  let turn: number | undefined
  let sessionId: string | undefined
  let segOrdinal: number | undefined
  const parseTurn = (v: string | null): number | undefined => {
    if (v === null || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  const parseSeg = (v: string | null): number | undefined => {
    if (v === null || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  for (const el of candidates) {
    // 元素自身 + 一个内层（shadow host 包裹 / TurnTailNodeView 内层）各查一次
    const inner = el.querySelector?.('[data-turn-tail], [data-dshcf-turn], [data-dshcf-session], [data-dshcf-seg]')
    for (const src of [el, inner]) {
      if (src === null || src === undefined) continue
      if (turn === undefined) {
        turn = parseTurn(src.getAttribute('data-turn-tail')) ?? parseTurn(src.getAttribute('data-dshcf-turn'))
      }
      if (sessionId === undefined) {
        const ds = src.getAttribute('data-dshcf-session')
        if (ds !== null && ds !== '') sessionId = ds
      }
      if (segOrdinal === undefined) {
        segOrdinal = parseSeg(src.getAttribute('data-dshcf-seg'))
      }
      if (turn !== undefined && sessionId !== undefined && segOrdinal !== undefined) break
    }
    if (turn !== undefined && sessionId !== undefined && segOrdinal !== undefined) break
  }
  // 位置兜底回合号（buildSegments 计算）：仅在 data-turn-tail / data-dshcf-turn 都缺失时采用。
  if (turn === undefined) turn = segment.turn
  // sessionId 兜底：segment 候选缺失时，从 flow 内任一注入器 host 读取（同 flow = 同会话）。
  if (sessionId === undefined && typeof document !== 'undefined') {
    const flow = (segment.boundary ?? segment.finalStep ?? segment.blocks[0]?.host)?.closest?.('[data-chat-flow]')
    const host = (flow ?? document).querySelector?.('[data-dshcf-session]')
    const ds = host?.getAttribute?.('data-dshcf-session')
    if (ds !== null && ds !== undefined && ds !== '') sessionId = ds
  }
  return { turn, sessionId, segOrdinal: segment.segOrdinal ?? segOrdinal ?? 0 }
}

/** 元素是否 turn-tail 类（turn-tail / turn-tail-timing 两种 kind）。 */
function isTurnTailElement(el: HTMLElement): boolean {
  const kind = el.getAttribute('data-chat-flow-kind')
  return kind === 'turn-tail' || kind === 'turn-tail-timing'
}

/** 从 DOM 中查找回合的 turn-tail 元素。boundary 仅在确为 turn-tail 类时采用——
 * 否则（如被下一 user/steering 切断的异常终止段）回退 finalStep 后向查找，避免
 * 把 user/steering 边界误当 turn-tail 解析耗时/指标。 */
function findTurnTail(segment: SegmentSnapshot): HTMLElement | null {
  if (segment.boundary !== null && isTurnTailElement(segment.boundary)) return segment.boundary
  if (segment.finalStep !== null) {
    // 从 finalStep 往后找 turn-tail
    let el = segment.finalStep.nextElementSibling
    while (el !== null) {
      if (el instanceof HTMLElement && isTurnTailElement(el)) return el
      el = el.nextElementSibling
    }
  }
  return null
}

/** 检查当前是否有键盘焦点或文本选择在 segment 的活动区域内。 */
function hasInteractionInBlocks(blocks: Block[]): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  if (active !== null) {
    for (const block of blocks) {
      // fake-dom 的元素无 contains()，生产真实 DOM 有——加能力检测
      if (typeof block.host.contains === 'function' && block.host.contains(active)) return true
      for (const row of block.rows) {
        if (typeof row.contains === 'function' && row.contains(active)) return true
      }
    }
  }
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  for (const block of blocks) {
    if (typeof range.intersectsNode === 'function' && range.intersectsNode(block.host)) return true
    for (const row of block.rows) {
      if (typeof range.intersectsNode === 'function' && range.intersectsNode(row)) return true
    }
  }
  return false
}

/** 存储/恢复 segment 展开状态的 localStorage 持久化。 */
function persistedSegmentExpanded(sessionId: string, segmentKey: string): boolean | undefined {
  try {
    const key = 'dshcf:expanded:' + sessionId + ':' + segmentKey
    const val = localStorage.getItem(key)
    if (val === 'true') return true
    if (val === 'false') return false
  } catch { /* localStorage may be unavailable */ }
  return undefined
}

function persistSegmentExpanded(sessionId: string, segmentKey: string, expanded: boolean): void {
  try {
    const key = 'dshcf:expanded:' + sessionId + ':' + segmentKey
    if (expanded) localStorage.setItem(key, 'true')
    else localStorage.removeItem(key)
  } catch { /* localStorage may be unavailable */ }
}

function createSpan(cls: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = cls
  return span
}

/** 原生 command 工具行 leading 图标（IconApiOutline14，>_ 形）path 数据：
 * 14 坐标系、3 path（圆角框 + > + _，带 transform），逐字复制自
 * dsh-client-ui-primitives 的 IconApiOutline14 导出。
 * 硬编码而非运行时克隆：不依赖页面当下是否有可克隆的命令卡（此前
 * 兜底手搓终端方块与原生有细微差异，极少数会话下所有卡片 leading 被
 * 状态图标替换时克隆失败会露出该手搓图标）。 */
const COMMAND_ICON_PATHS: ReadonlyArray<{ d: string; transform: string }> = [
  {
    transform: 'translate(0.6689 1.073)',
    d: 'M11.4818 5.57813C11.4818 4.45301 11.4807 3.66237 11.4075 3.05908C11.3359 2.46953 11.2024 2.13852 10.9939 1.89441C10.9247 1.81341 10.8493 1.73801 10.7683 1.66882C10.5242 1.46033 10.1932 1.32686 9.60364 1.25525C9.00034 1.18198 8.20974 1.18091 7.0846 1.18091L5.57813 1.18091C4.45301 1.18091 3.66238 1.18198 3.05908 1.25525C2.46953 1.32686 2.13852 1.46033 1.89441 1.66882C1.81341 1.73801 1.73801 1.81341 1.66882 1.89441C1.46033 2.13852 1.32686 2.46953 1.25525 3.05908C1.18198 3.66238 1.18091 4.45301 1.18091 5.57813L1.18091 6.2771C1.18091 7.40218 1.18197 8.19288 1.25525 8.79614C1.32687 9.38553 1.46036 9.71674 1.66882 9.96082C1.73797 10.0417 1.81347 10.1173 1.89441 10.1864C2.13851 10.3948 2.13965 10.5275 3.05908 10.5991C3.66238 10.6724 4.45298 10.6735 5.57813 10.6735L7.0846 10.6735C8.20977 10.6735 9.00033 10.6724 9.60364 10.5991C10.1931 10.5275 10.5242 10.3948 10.7683 10.1864C10.8493 10.1173 10.9247 10.0417 10.9939 9.96082C11.2024 9.71674 11.3358 9.38553 11.4075 8.79614C11.4808 8.19288 11.4818 7.40218 11.4818 6.2771L11.4818 5.57813ZM12.6627 6.2771C12.6627 7.37222 12.6637 8.247 12.5798 8.93799C12.4942 9.64284 12.3133 10.2359 11.8928 10.7282C11.7834 10.8562 11.6637 10.9751 11.5356 11.0845C11.0434 11.5049 10.4511 11.6867 9.74634 11.7723C9.05525 11.8563 8.17999 11.8552 7.0846 11.8552L5.57813 11.8552C4.48273 11.8552 3.60747 11.8563 2.91638 11.7723C2.21157 11.6867 1.61933 11.5049 1.12708 11.0845C0.99901 10.9751 0.879281 10.8562 0.769898 10.7282C0.349454 10.2359 0.168506 9.64284 0.0828864 8.93799C-0.00101964 8.247 4.88512e-07 7.37222 6.47206e-07 6.2771L6.47206e-07 5.57813C6.47206e-07 4.48273 -0.00106163 3.60747 0.0828864 2.91638C0.168502 2.21168 0.349594 1.61928 0.769898 1.12708C0.879302 0.998981 0.998981 0.879302 1.12708 0.769898C1.61928 0.349594 2.21168 0.168502 2.91638 0.0828864C3.60747 -0.00106163 4.48273 6.47206e-07 5.57813 6.47206e-07L7.0846 6.47206e-07C8.17999 6.47206e-07 9.05525 -0.00106163 9.74634 0.0828864C10.451 0.168505 11.0434 0.349587 11.5356 0.769898C11.6637 0.879302 11.7834 0.998981 11.8928 1.12708C12.3131 1.61928 12.4942 2.21169 12.5798 2.91638C12.6638 3.60747 12.6627 4.48273 12.6627 5.57813L12.6627 6.2771Z',
  },
  {
    transform: 'translate(0.6689 1.073)',
    d: 'M6.02607 5.50955L6.44306 5.9274L3.84284 8.52762L3.425 8.11063L3.00715 7.69278L4.77253 5.9274L3.00715 4.16202L3.84284 3.32633L6.02607 5.50955Z',
  },
  {
    transform: 'translate(0.6689 1.073)',
    d: 'M9.23789 7.35397L9.23789 8.53488L6.96238 8.53488L6.96238 7.35397L9.23789 7.35397Z',
  },
]

const NATIVE_CHEVRON_DOWN_PATH = 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'

function createChevronIcon(className: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('class', className)
  svg.setAttribute('viewBox', '0 0 14 14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', NATIVE_CHEVRON_DOWN_PATH)
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)
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

/** 从原生命令卡找真实 command leading SVG：IconApiOutline14（>_ 形，
 * 14x14、3 个 path：方框 + > + _）——bash ToolRow 与 GenericCommandCard 的
 * 默认命令图标都是它；read/write 等工具专属图标（16 坐标系）与 chevron /
 * StateDot（单 path）天然排除。找不到返回 null，调用方用 COMMAND_ICON_PATHS
 * 硬编码原生 path 兜底（与克隆视觉完全一致）。 */
function findNativeCommandSvg(): SVGSVGElement | null {
  const selector = '[data-chat-call-id] [data-disclosure-row], [data-chat-flow-kind="command"] [data-disclosure-row], [data-chat-flow-kind="manual-compaction"] [data-disclosure-row]'
  for (const drow of document.querySelectorAll<HTMLElement>(selector)) {
    for (const svg of drow.querySelectorAll<SVGSVGElement>('svg')) {
      if (svg.querySelectorAll('path').length === 3 && isIcon14(svg)) return svg
    }
  }
  return null
}

/** svg 是否为 14x14（width/height 属性或 viewBox 0 0 14 14）。 */
function isIcon14(svg: SVGSVGElement): boolean {
  if (svg.getAttribute('width') === '14' && svg.getAttribute('height') === '14') return true
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/\s+/)
  return vb.length === 4 && Number(vb[2]) === 14 && Number(vb[3]) === 14
}

/** 首次成功克隆的原生命令图标模板：之后所有 chip 复用其克隆，不再依赖
 * 页面当下是否还有工具卡可扫。 */
let cachedNativeCommandSvg: SVGSVGElement | null = null

/** 工具块 leading 图标：优先克隆页面上的原生 command leading SVG（跟随
 * DSH 未来图标更新），克隆不可得（页面暂无命令卡 / 卡片 leading 被状态
 * 图标替换）时用 COMMAND_ICON_PATHS 硬编码原生 path 兜底——与克隆视觉
 * 完全一致，不再出现手搓终端方块。 */
function createCommandIcon(): SVGSVGElement {
  if (cachedNativeCommandSvg !== null) return cachedNativeCommandSvg.cloneNode(true) as SVGSVGElement
  const native = findNativeCommandSvg()
  if (native !== null) {
    cachedNativeCommandSvg = native
    return native.cloneNode(true) as SVGSVGElement
  }
  return createCommandIconFallback()
}

/** COMMAND_ICON_PATHS 硬编码构建（与原生 IconApiOutline14 逐字一致）。 */
function createCommandIconFallback(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 14 14')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  for (const p of COMMAND_ICON_PATHS) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('transform', p.transform)
    path.setAttribute('d', p.d)
    path.setAttribute('fill', 'currentColor')
    svg.appendChild(path)
  }
  return svg
}

/** 原生上下文注入行的 leading 图标 path（16 坐标系、3 path：圆角框 + 上下
 * 两条横线，取样自真实 [data-chat-flow-kind="context"] 行；16 坐标系渲染
 * 14x14，与 IconApiOutline14 的 14 坐标系区分）。 */
const CONTEXT_ICON_PATHS: ReadonlyArray<{ d: string }> = [
  {
    d: 'M11.2426 4.80473V6.10551H4.75819V4.80473H11.2426Z',
  },
  {
    d: 'M9.40858 7.84478V9.14557H4.75819V7.84478H9.40858Z',
  },
  {
    d: 'M9.23438 0.546389C10.1941 0.546389 10.9683 0.544914 11.5859 0.611819C12.2161 0.680096 12.7634 0.825745 13.2393 1.17139C13.5172 1.3733 13.7619 1.61812 13.9639 1.896C14.3096 2.37183 14.4551 2.91922 14.5234 3.54932C14.5903 4.16686 14.5889 4.94133 14.5889 5.90088V10.0981C14.5889 11.0576 14.5903 11.8321 14.5234 12.4497C14.4552 13.0798 14.3094 13.6272 13.9639 14.103C13.7619 14.381 13.5172 14.6257 13.2393 14.8276C12.7633 15.1734 12.2163 15.3189 11.5859 15.3872C10.9683 15.4541 10.1942 15.4536 9.23438 15.4536H6.76563C5.80591 15.4536 5.03168 15.4541 4.41407 15.3872C3.78385 15.3189 3.23665 15.1734 2.76074 14.8276C2.48291 14.6257 2.23802 14.3809 2.03614 14.103C1.69066 13.6272 1.54483 13.0798 1.47657 12.4497C1.40973 11.8321 1.41114 11.0576 1.41114 10.0981V5.90088C1.41113 4.94132 1.40966 4.16686 1.47657 3.54932C1.54488 2.91921 1.69042 2.37184 2.03614 1.896C2.2381 1.61807 2.4828 1.37333 2.76074 1.17139C3.23665 0.825682 3.78386 0.680109 4.41407 0.611819C5.03168 0.544905 5.80591 0.546389 6.76563 0.546389H9.23438ZM6.76563 1.896C5.77586 1.896 5.0876 1.89738 4.55957 1.95459C4.0443 2.01043 3.76214 2.11349 3.55469 2.26416C3.39135 2.38284 3.24761 2.52662 3.12891 2.68994C2.97821 2.89736 2.8752 3.17967 2.81934 3.69483C2.76214 4.22279 2.76075 4.91131 2.76074 5.90088V10.0981C2.76074 11.0876 2.76221 11.7762 2.81934 12.3042C2.87516 12.8194 2.97829 13.1026 3.12891 13.3101C3.24754 13.4733 3.39147 13.6172 3.55469 13.7358C3.76213 13.8865 4.04438 13.9896 4.55957 14.0454C5.0876 14.1026 5.77586 14.103 6.76563 14.103H9.23438C10.2242 14.103 10.9124 14.1026 11.4404 14.0454C11.9556 13.9896 12.2379 13.8865 12.4453 13.7358C12.6086 13.6172 12.7525 13.4733 12.8711 13.3101C13.0217 13.1026 13.1248 12.8195 13.1807 12.3042C13.2378 11.7762 13.2393 11.0876 13.2393 10.0981V5.90088C13.2393 4.91131 13.2379 4.22279 13.1807 3.69483C13.1248 3.17969 13.0218 2.89736 12.8711 2.68994C12.7524 2.52667 12.6086 2.38281 12.4453 2.26416C12.2379 2.11355 11.9556 2.01041 11.4404 1.95459C10.9124 1.8974 10.2241 1.896 9.23438 1.896H6.76563Z',
  },
]

/** 从原生 [data-chat-flow-kind="context"] [data-disclosure-row] 找真实 context
 * leading SVG（上下文注入图标，16 坐标系、3 path）；chevron（单 path）排除。 */
function findNativeContextSvg(): SVGSVGElement | null {
  for (const ctx of document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="context"]')) {
    const drow = ctx.querySelector('[data-disclosure-row]')
    if (drow === null) continue
    for (const svg of drow.querySelectorAll<SVGSVGElement>('svg')) {
      if (svg.querySelectorAll('path').length >= 2) return svg
    }
  }
  return null
}

/** context 块 leading 图标：优先克隆原生 context leading SVG（与原生
 * 上下文注入行完全一致），找不到时用 16 坐标系硬编码 path 兜底。 */
function createContextIcon(): SVGSVGElement {
  const native = findNativeContextSvg()
  if (native !== null) return native.cloneNode(true) as SVGSVGElement
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  for (const p of CONTEXT_ICON_PATHS) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', p.d)
    path.setAttribute('fill', 'currentColor')
    svg.appendChild(path)
  }
  return svg
}

/** 原生 write/edit 工具行的 leading 图标（IconEditOutline16）：16 坐标系、
 * 单 path（铅笔 + 下划线），取样自 dsh-client-ui-tool 的 write/edit 工具行
 * 图标映射，与 dsh-client-ui-primitives 导出逐字一致。16 坐标系渲染
 * 14x14（与 IconApiOutline14 的 14 坐标系区分）。 */
const WRITE_ICON_PATH = 'M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z'

/** 从原生 write/edit 工具行找真实 leading SVG：IconEditOutline16（16 坐标系、
 * 1 path），与 chevron / StateDot（14 坐标系单 path）及 Browse/Search/Code
 *（16 坐标系多 path）区分。找不到返回 null，调用方用 WRITE_ICON_PATH 兜底。 */
function findNativeWriteSvg(): SVGSVGElement | null {
  const selector = '[data-tool="write"] [data-disclosure-row], [data-tool="edit"] [data-disclosure-row]'
  for (const drow of document.querySelectorAll<HTMLElement>(selector)) {
    for (const svg of drow.querySelectorAll<SVGSVGElement>('svg')) {
      if (svg.querySelectorAll('path').length === 1 && isIcon16(svg)) return svg
    }
  }
  return null
}

/** svg 是否为 16 坐标系（viewBox 0 0 16 16）。 */
function isIcon16(svg: SVGSVGElement): boolean {
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/\s+/)
  return vb.length === 4 && Number(vb[2]) === 16 && Number(vb[3]) === 16
}

/** 编辑了文件块 leading 图标：优先克隆原生 write/edit 工具行 leading SVG，
 * 克隆不可得时用 WRITE_ICON_PATH 硬编码原生 path 兜底（视觉完全一致）。 */
function createWriteIcon(): SVGSVGElement {
  const native = findNativeWriteSvg()
  if (native !== null) return native.cloneNode(true) as SVGSVGElement
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', WRITE_ICON_PATH)
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)
  return svg
}

/** 按块类型切换 chip leading 图标（工具块 = 原生 command 图标；思考块 = 原生
 * write 图标）。kind 不变时不动
 * DOM——updateChip 只在 kind 变化时才调用本函数，不会每帧替换。 */
function syncLeadingIcon(chip: HTMLButtonElement, kind: 'tool' | 'think' | 'context' | 'write'): void {
  const leading = chip.querySelector<HTMLElement>('.dshcf-leading')
  if (leading === null) return
  const existing = leading.querySelector('svg')
  if (existing !== null && existing.getAttribute('data-dshcf-icon') === kind) return
  for (const child of [...leading.childNodes]) child.remove()
  const svg = kind === 'think' ? createThinkIcon() : kind === 'context' ? createContextIcon() : kind === 'write' ? createWriteIcon() : createCommandIcon()
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

/** parentNode 链判断，兼容 Element 与 Text mutation target。 */
function nodeWithin(node: Node, ancestor: Node): boolean {
  for (let current: Node | null = node; current !== null; current = current.parentNode) {
    if (current === ancestor) return true
  }
  return false
}

/** 判断 descendant 是否在 ancestor 的子树内（含自身）。 */
function isDescendantOf(descendant: HTMLElement, ancestor: HTMLElement): boolean {
  if (descendant === ancestor) return true
  for (let cur: Node | null = descendant; cur !== null; cur = cur.parentNode) {
    if (cur === ancestor) return true
  }
  return false
}

/** 排除插件自己插入的一级行/实时摘要行/flow 级 chip，得到宿主的真实顶层消息顺序。 */
function flowItems(flow: HTMLElement): HTMLElement[] {
  return [...flow.children].filter((el): el is HTMLElement => (
    el instanceof HTMLElement
    && !el.classList.contains('dshcf-processed')
    && !el.classList.contains('dshcf-processing')
    && !el.classList.contains('dshcf-flow-chip')
  ))
}

function isDisplayed(el: HTMLElement): boolean {
  if (typeof getComputedStyle === 'function') return getComputedStyle(el).display !== 'none'
  return el.style.display !== 'none'
}


function stableElementKey(el: HTMLElement, fallbackIndex: number): string {
  const kind = el.getAttribute('data-chat-flow-kind') ?? 'node'
  const key = el.getAttribute('data-chat-flow-key')
    ?? el.getAttribute('data-chat-anchor-key')
    ?? `${kind}:${fallbackIndex}`
  return `${kind}:${key}`
}

function hasLeadingTurnWork(items: readonly HTMLElement[]): boolean {
  return items.some(el => {
    const kind = el.getAttribute('data-chat-flow-kind')
    return kind === 'assistant-step'
      || kind === 'assistant'
      || kind === 'tool-call'
      || kind === 'command'
      || kind === 'manual-compaction'
  })
}

/** DSH 原生"回合级状态装饰行"的 kind：重试链投影行（model-retry，"已重试
 * 模型请求…"）、终态失败（turn-error）、达到输出 token 上限（turn-max-tokens）。
 * 它们都是 flow 直接子级、携带正文文本但 kind 非 assistant-step——若不特殊
 * 处理，findBlocks 会把它们当正文消息断开合并且不进任何块，导致折叠后残留
 * 可见。统一排除并收集到 statusRows，随段一级折叠隐藏。 */
const STATUS_ROW_KINDS = new Set(['model-retry', 'turn-error', 'turn-max-tokens'])
function isStatusRow(el: HTMLElement): boolean {
  return STATUS_ROW_KINDS.has(el.getAttribute('data-chat-flow-kind') ?? '')
}

/**
 * 每轮按当前 DOM 顺序重建 segment。user/steering 同时是上一段边界和下一段
 * 起点，turn-tail 结束当前段。首个 user 前只有 context 时，context 归入该
 * user；首个 steering 前已有 assistant/tool 时，则把那批历史中段收尾。
 */
function buildSegments(flow: HTMLElement, blocks: readonly Block[], hasBody: (el: HTMLElement) => boolean): SegmentSnapshot[] {
  const items = flowItems(flow)
  const itemIndex = new Map(items.map((el, index) => [el, index]))
  const snapshots: SegmentSnapshot[] = []
  let contentStart = 0
  let startMarker: HTMLElement | null = null
  // 回合内段序号：user=0（新回合）、steering=++（同回合新段）、turn-tail=0（重置）
  let segOrdinal = 0
  // 位置兜底回合号：user 边界递增、turn-tail 的 data-turn-tail 锚定。仅供
  // data-turn-tail / data-dshcf-turn 都缺失时兜底，不参与正常指标归属。
  let turn = 0

  // 从 turn-tail 元素（含内层 [data-turn-tail]）读取权威回合号作锚点。
  const turnTailTurnOf = (el: HTMLElement): number | undefined => {
    for (const src of [el, el.querySelector?.('[data-turn-tail]')]) {
      if (src === null || src === undefined) continue
      const v = src.getAttribute?.('data-turn-tail')
      if (v === null || v === '' || v === undefined) continue
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) return n
    }
    return undefined
  }

  const append = (end: number, boundary: HTMLElement | null, closed: boolean, turnNumber: number | undefined): void => {
    if (end < contentStart) return
    const range = items.slice(contentStart, end)
    const inRange = new Set(range)
    const segmentBlocks = blocks.filter(block => inRange.has(block.host))
    const bodySteps = range.filter(el => {
      const kind = el.getAttribute('data-chat-flow-kind')
      return (kind === 'assistant-step' || kind === 'assistant') && hasBody(el)
    })
    const finalStep = bodySteps.length > 0 ? bodySteps[bodySteps.length - 1] : null
    const middleSteps = new Set(bodySteps.slice(0, -1))
    // DSH 原生回合级状态装饰行（model-retry/turn-error/turn-max-tokens）：
    // 携带正文文本但 kind 非 assistant-step，既不该当 finalStep 也不该断开工具
    // 组合并（见 findBlocks 的 isStatusRow 排除）；单独收集，随段一级折叠隐藏。
    // 状态装饰行分两类：落在某块内的（findBlocks 已收进 block.statusRows）随块
    // 二级折叠；块外的（块前/块后）仍由本段一级折叠控制。
    const inBlockStatus = new Set<HTMLElement>(segmentBlocks.flatMap(block => block.statusRows))
    const statusRows = range.filter(el => isStatusRow(el) && !inBlockStatus.has(el))
    const workHosts = new Set<HTMLElement>([
      ...segmentBlocks.map(block => block.host),
      ...middleSteps,
    ])
    // 一级摘要行锚在回合工作流最顶端：任何工作宿主 / 中间正文 / 状态装饰行之前。
    // 块内状态行必在其块宿主之后，不影响该查找；块前状态行则会被优先命中，
    // 确保"已处理"指标行不会落到"已重试模型请求"行下方。
    const firstWork = range.find(el => workHosts.has(el) || isStatusRow(el)) ?? finalStep
    const identity = startMarker
      ?? range.find(el => hasLeadingTurnWork([el]))
      ?? boundary
    const identityIndex = identity === null ? contentStart : (itemIndex.get(identity) ?? contentStart)
    const prefix = startMarker === null ? 'leading' : 'segment'
    const key = `${prefix}:${identity === null ? `open:${contentStart}` : stableElementKey(identity, identityIndex)}`
    // 异常终止检测：无 turn-tail 边界却已出现终态信号——「已停止」工具行
    // 或终态失败（turn-error）/输出上限（turn-max-tokens）状态行。此时视同
    // 闭合以便折叠内容（对策：手动停止、会话中断等意外导致的轮次会话中断）。
    const hasTerminalStatus = range.some(el => {
      const k = el.getAttribute('data-chat-flow-kind')
      return k === 'turn-error' || k === 'turn-max-tokens'
    })
    const hasStoppedRow = segmentBlocks.some(block => block.rows.some(row => {
      const s = rowState(row)
      return s === 'stopped' || s === 'aborted'
    }))
    // 段级 running 判定**有意**只用 rowState（不用 rowRunning）——终止判定
    // （terminated）依赖它避免「已停止但 data-state 缺省、残留 [data-follow-end]」的
    // 行被误判为仍在 running，从而拒绝闭合。块级 keepRow/计数才用 rowRunning 求
    // 「保留可见」。两处口径不同、各自正确，勿做无差别一致化。
    const runningNow = segmentBlocks.some(block => block.rows.some(row => rowState(row) === 'running'))
    // 仅当「无运行中行」时才认定终止——避免 termination 信号与 running 行并存的
    // 极窄竞态（如停止瞬间仍有行残留 running）把回合误判为既运行又不显示实时行。
    const terminated = !runningNow && (hasTerminalStatus || hasStoppedRow)
    snapshots.push({
      key,
      boundary,
      startMarker,
      blocks: segmentBlocks,
      middleSteps,
      statusRows,
      finalStep,
      firstWork,
      closed,
      running: runningNow,
      hasWork: segmentBlocks.length > 0 || middleSteps.size > 0,
      terminated,
      termination: hasStoppedRow ? 'aborted' : undefined,
      segOrdinal,
      turn: turnNumber,
    })
  }

  for (let index = 0; index < items.length; index++) {
    const el = items[index]
    const kind = el.getAttribute('data-chat-flow-kind')
    if (kind === 'user' || kind === 'steering') {
      if (startMarker !== null) {
        append(index, el, true, turn)
        contentStart = index + 1
      } else {
        const leading = items.slice(contentStart, index)
        if (hasLeadingTurnWork(leading)) {
          append(index, el, true, turn)
          contentStart = index + 1
        }
        // 仅有顶部 context 时保留 contentStart，让它归入这个 user 的段。
      }
      // user = 新回合起点（segOrdinal=0、回合号 +1）；steering = 同回合内新段（segOrdinal++）
      if (kind === 'user') {
        segOrdinal = 0
        turn++
      } else {
        segOrdinal++
      }
      startMarker = el
      continue
    }
    if (kind === 'turn-tail') {
      const anchored = turnTailTurnOf(el)
      // 该 turn-tail 关闭的段 = data-turn-tail（权威）或当前位置计数器。
      append(index, el, true, anchored ?? turn)
      if (anchored !== undefined) turn = anchored
      contentStart = index + 1
      startMarker = null
      segOrdinal = 0
    }
  }
  if (contentStart < items.length) append(items.length, null, false, turn)
  return snapshots
}

function hasVisibleSegmentWork(segment: SegmentSnapshot): boolean {
  const workHosts = new Set<HTMLElement>([
    ...segment.blocks.map(block => block.host),
    ...segment.middleSteps,
  ])
  if (segment.startMarker !== null) workHosts.add(segment.startMarker)
  if (segment.finalStep !== null) workHosts.add(segment.finalStep)
  return [...workHosts].some(isDisplayed)
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
function findBlocks(flow: HTMLElement, hasBody: (el: HTMLElement) => boolean): Block[] {
  const blocks: Block[] = []
  const children = flowItems(flow)
  let run: Block | null = null
  let runHasTool = false
  let carry: HTMLElement[] = []
  let carryHost: HTMLElement | null = null
  let pendingStatus: HTMLElement[] = []

  const makeBlock = (host: HTMLElement): Block => {
    const block: Block = {
      key: '',
      host,
      head: host,
      rows: [],
      containers: [],
      statusRows: [],
      mount: 'inside',
    }
    blocks.push(block)
    return block
  }

  const flushCarry = (): void => {
    if (carry.length === 0 || carryHost === null) return
    let own = blocks.find(block => block.host === carryHost)
    if (own === undefined) own = makeBlock(carryHost)
    own.rows.push(...carry)
    carry = []
    carryHost = null
  }

  for (const el of children) {
    const kind = el.getAttribute('data-chat-flow-kind')
    if (kind === 'user' || kind === 'steering' || kind === 'turn-tail') {
      flushCarry()
      pendingStatus = []
      run = null
      runHasTool = false
      continue
    }
    const thinkRows = thinkRowsIn(el)
    const workRows = [...callRowsIn(el), ...commandRowsIn(el)]
    const isToolPile = workRows.length > 0
    const isContext = kind === 'context'
    const msgHasBody = !isToolPile && !isContext ? hasBody(el) : false

    if (isStatusRow(el)) {
      if (run !== null) run.statusRows.push(el)
      else pendingStatus.push(el)
      continue
    }

    if (isToolPile || isContext || (thinkRows.length > 0 && !msgHasBody)) {
      // 工具 → 进行中的纯思考 边界切分：工具行后紧接的「正在思考」元素
      // 是新一轮推理（随后会产出新的工具调用），不再并入上一工具块——否则
      // 进行中的思考会把上方已完成工具块的 chip 标题带成「正在思考」并逐帧
      // 刷新其内容（两行同时刷新）。仅 running 时切分：已完成态仍按 R2 跨
      // 类别合并（tool→think 不拆块，保持既有合并语义）。
      const thinkOnly = thinkRows.length > 0 && workRows.length === 0 && !isContext
      const thinkRunning = thinkOnly && thinkRows.some(row => rowRunning(row))
      if (thinkRunning && run !== null && runHasTool) {
        run = null
        runHasTool = false
      }
      if (run === null) {
        run = makeBlock(el)
        runHasTool = false
      }
      if (pendingStatus.length > 0) {
        run.statusRows.push(...pendingStatus)
        pendingStatus = []
      }
      if (carry.length > 0) {
        run.rows.push(...carry)
        carry = []
        carryHost = null
      }
      if (isContext) {
        run.rows.push(el)
        if (el === run.host) run.mount = 'before'
      } else {
        run.rows.push(...thinkRows, ...workRows)
        if (workRows.length > 0) runHasTool = true
        if (el !== run.host && !workRows.includes(el)) {
          run.containers.push(el)
        }
        if (workRows.includes(el)) run.mount = 'before'
      }
      continue
    }

    if (!isStatusRow(el) && ((el.hasAttribute('data-chat-anchor-key') && (thinkRows.length > 0 || msgHasBody)) || (msgHasBody && kind !== null))) {
      flushCarry()
      if (thinkRows.length > 0) {
        const segments = splitThinkByBody(el, thinkRows)
        if (run === null) {
          run = makeBlock(el)
          runHasTool = false
        }
        if (pendingStatus.length > 0) {
          run.statusRows.push(...pendingStatus)
          pendingStatus = []
        }
        run.rows.push(...segments[0])
        carry = segments.slice(1).flat()
        carryHost = el
      } else {
        pendingStatus = []
      }
      run = null
      runHasTool = false
    } else if (kind !== null && kind !== 'assistant-step' && kind !== 'assistant' && !isStatusRow(el)) {
      flushCarry()
      pendingStatus = []
      run = null
      runHasTool = false
    }
  }
  flushCarry()

  const indexOf = new Map(children.map((el, index) => [el, index] as const))
  const counts = new Map<string, number>()
  for (const block of blocks) {
    if (block.rows.includes(block.host)) block.mount = 'before'
    const base = stableElementKey(block.host, indexOf.get(block.host) ?? 0)
    const ordinal = counts.get(base) ?? 0
    counts.set(base, ordinal + 1)
    block.key = base + ':block:' + ordinal
    // 块顶 head = host ∪ containers ∪ statusRows 中在 flow 子序列里最靠前者
    // （用 children 数组下标判定，不依赖 compareDocumentPosition，桩与真机一致）。
    const members = [block.host, ...block.containers, ...block.statusRows]
    block.head = members.reduce((a, b) => (indexOf.get(a) ?? Infinity) <= (indexOf.get(b) ?? Infinity) ? a : b)
    const chipInside = block.mount === 'inside' && block.head === block.host
    if (!chipInside && !block.rows.includes(block.host) && !block.containers.includes(block.host)) {
      block.containers.push(block.host)
    }
  }
  return blocks
}


/** 块内切分：think 行按“think 容器外的正文文本”分段。同一消息里
 * Think1-正文-Think2 时返回 [Think1] [Think2]；无正文间隔的相邻思考
 * 保持在同一段（合并）。
 * 正文文本节点一次 walker 预收集（DOM 顺序），行间判断用顺序扫描：
 * 首达「在 a 之后」的正文节点若不在 b 之前，后续节点只会更靠后，
 * 可直接判定无正文——避免每对相邻行各扫一次全树。 */
function splitThinkByBody(el: HTMLElement, rows: HTMLElement[]): HTMLElement[][] {
  const texts: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null) !== null) {
    if (node.data.trim() === '') continue
    const parent = node.parentElement
    if (parent !== null && parent.closest('[data-variant="think"], [data-chat-call-id], .dshcf-chip, .dshcf-merged-think, .dshcf-merged-body') !== null) continue
    texts.push(node)
  }
  const hasBetween = (a: HTMLElement, b: HTMLElement): boolean => {
    for (const t of texts) {
      const posA = a.compareDocumentPosition(t)
      if ((posA & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue
      // 首达在 a 之后的正文节点：在 b 之前 → 区间内有正文；否则后续
      // 节点只会更靠后，区间内不可能再有正文。
      const posB = b.compareDocumentPosition(t)
      return (posB & Node.DOCUMENT_POSITION_PRECEDING) !== 0
    }
    return false
  }
  const segments: HTMLElement[][] = []
  let current: HTMLElement[] = []
  for (let i = 0; i < rows.length; i++) {
    current.push(rows[i])
    if (i + 1 < rows.length && hasBetween(rows[i], rows[i + 1])) {
      segments.push(current)
      current = []
    }
  }
  if (current.length > 0) segments.push(current)
  return segments.length > 0 ? segments : [rows]
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

/** 正文也可能是纯图片/媒体，没有文本节点（ImageGallery 加载完成即如此）。 */
function hasBodyContent(el: HTMLElement): boolean {
  // 命令卡 / 手动压缩卡是工作流程展示，不是正文消息：其原生内容区文本
  // 不参与"正文"判定——否则 chip 被误判 has-body，折叠态 margin 悬空，
  // 与 flow row-gap 叠加成 32px 视觉间隔（正常 16px）。
  const kind = el.getAttribute('data-chat-flow-kind')
  if (kind === 'command' || kind === 'manual-compaction') return false
  if (hasBodyText(el)) return true
  const excluded = '[data-variant="think"], [data-chat-call-id], [data-variant="others"][data-state], .dshcf-chip, .dshcf-merged-think, .dshcf-merged-body'
  for (const media of el.querySelectorAll<HTMLElement>('img, video, audio, canvas')) {
    if (media.closest(excluded) === null) return true
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

/** command/manual-compaction 使用 GenericCommandCard，没有 data-chat-call-id。 */
function commandRowsIn(el: HTMLElement): HTMLElement[] {
  const kind = el.getAttribute('data-chat-flow-kind')
  if (kind !== 'command' && kind !== 'manual-compaction') return []
  const rows: HTMLElement[] = []
  for (const row of el.querySelectorAll<HTMLElement>('[data-variant="others"][data-state]')) {
    const parent = row.parentElement?.closest('[data-variant="others"][data-state]')
    if (parent !== null && parent !== undefined && parent !== row) continue
    rows.push(row)
  }
  // 极早期 skeleton 尚未挂 GenericCommandCard 时，整条 seat 仍作为可折叠行。
  return rows.length > 0 ? rows : [el]
}

/** 工具行的「根」元素：优先 [data-tool]（通用 ToolRow），回退
 * [data-sample]（bash 等 keyed toolview 的 bash-sample 样式——只有
 * data-sample/data-variant/data-state，没有 data-tool）。根上携带
 * data-state；工具名从 data-tool / data-sample 读取。 */
function toolRootIn(row: HTMLElement): HTMLElement {
  // data-sample 仅当同时带 data-variant 才视为 bash 等 keyed toolview 根（避免误匹配任意内容）
  return row.querySelector<HTMLElement>('[data-tool], [data-sample][data-variant]') ?? row
}

/** 工具名：优先 data-tool（通用 ToolRow），回退 data-sample（bash-sample）；空串按缺失处理。 */
function toolNameOf(root: HTMLElement): string {
  const tool = root.getAttribute('data-tool')
  if (tool !== null && tool !== '') return tool
  const sample = root.getAttribute('data-sample')
  return sample !== null && sample !== '' ? sample : ''
}

/** 一行 → 实时摘要信息（工具名/思考摘要/状态）。工具行的 data-tool 与
 * data-state 在内层 [data-tool] root 上（外层 callRow 只有 class /
 * data-chat-anchor-key / data-chat-call-id），需向下查一层。bash 等
 * keyed toolview（bash-sample）无 data-tool，改用 data-sample 识别。 */
function deriveRowInfo(row: HTMLElement): RowInfo {
  const isThink = row.matches('[data-variant="think"]') && !row.hasAttribute('data-tool')
  if (isThink) {
    return { kind: 'think', label: 'Think', summary: thinkSummary(row), state: row.getAttribute('data-state') ?? 'ok' }
  }
  // 上下文注入节点（二级块行 = 元素自身）：固定标题 + DisclosureRow 摘要。
  if (row.getAttribute('data-chat-flow-kind') === 'context') {
    return { kind: 'context', label: '上下文注入', summary: toolSummary(row), state: 'ok' }
  }
  const commandSeat = row.closest<HTMLElement>('[data-chat-flow-kind="command"], [data-chat-flow-kind="manual-compaction"]')
  if (commandSeat !== null) {
    const commandKind = commandSeat.getAttribute('data-chat-flow-kind')
    return {
      kind: 'tool',
      label: commandKind === 'manual-compaction' ? 'Compact' : 'Command',
      summary: toolSummary(row),
      state: row.getAttribute('data-state') ?? 'ok',
    }
  }
  const root = toolRootIn(row)
  const tool = toolNameOf(root)
  const state = root.getAttribute('data-state') ?? 'ok'
  const label = TOOL_LABELS[tool] ?? tool
  return { kind: 'tool', label: label !== '' ? label : 'Tool', summary: toolSummary(row), state, tool }
}

/** Think 行摘要：优先官方 ReasoningRow 的实时摘要锚点 [data-follow-end]
 * （仅 running 时存在，内容为最新一行；完成态属性消失，走 summaryFallback）。 */
function thinkSummary(row: HTMLElement): string {
  const follow = row.querySelector<HTMLElement>('[data-follow-end]')
  if (follow !== null) {
    const text = (follow.textContent ?? '').trim()
    if (text !== '') return text
  }
  return summaryFallback(row)
}

/** 工具行摘要：DisclosureRow 的前两个直接子元素是 leading/title，之后
 * collapsedContent 从 separator 开始；summarySuffix 可能跟在 summary 后，
 * 因此取 title 之后第一个非空直接子元素，不能取 lastElementChild。
 * bash 等 keyed toolview（bash-sample）没有 [data-disclosure-row]：根元素
 * [data-sample] 的 children 同为 [leading, title, sep, summary]，照同样规则取。 */
function toolSummary(row: HTMLElement): string {
  const drow = row.querySelector<HTMLElement>('[data-disclosure-row]')
  if (drow !== null) {
    const children = [...drow.children].filter((el): el is HTMLElement => el instanceof HTMLElement)
    for (const child of children.slice(2)) {
      const text = (child.textContent ?? '').trim()
      if (text !== '') return text
    }
  }
  const sample = row.querySelector<HTMLElement>('[data-sample][data-variant]')
  if (sample !== null) {
    // bash-sample 根 children = [leading, (visuallyHidden 状态), title, sep, summary]：
    // running/error/stopped 时中间会多一个 visuallyHidden 状态 span，不能用
    // slice(2) 固定偏移（会取到 title「Bash」）；summary 恒为最后一个直接子元素，
    // 从末尾向前取第一个非空文本最稳。
    const children = [...sample.children].filter((el): el is HTMLElement => el instanceof HTMLElement)
    for (let i = children.length - 1; i >= 0; i--) {
      const text = (children[i].textContent ?? '').trim()
      if (text !== '') return text
    }
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
  hasError: boolean
  hasStopped: boolean
  /** 块是否全由上下文注入构成（完成态标题用 "上下文注入"）。 */
  allContext: boolean
  /** 分层粒度计数（对齐 dsh-turn-fold activityGroup）。 */
  thinkCount: number
  toolCount: number
  contextCount: number
  failureCount: number
  /** 每个工具展示名出现的次数（按数量降序、并列保序），用于「名称 ×N」统计。 */
  toolCounts: { label: string; count: number }[]
  /** 该折叠块中最后一次工具调用的说明（不限工具类型：Code 的 description、
   * Bash 的命令、Read/Grep 的路径等 summary 均尽量提取）。 */
  lastToolDescription?: string
  /** 块内 model-retry 状态行数（用于「N 次重试」类别计数）。 */
  retryCount: number
}

/** PTC（run_code）行内 dsh 解析出的子工具名：[data-subcalls] 内嵌套工具卡
 * 的 data-tool（bash 等 keyed toolview 用 data-sample）。run_code 自身不计入；
 * 未解析到时返回空数组，调用方回退用 Code。 */
function subToolsIn(row: HTMLElement): string[] {
  const names: string[] = []
  for (const sub of row.querySelectorAll<HTMLElement>('[data-subcalls] [data-tool], [data-subcalls] [data-sample][data-variant]')) {
    const t = toolNameOf(sub)
    if (t === '' || t === 'run_code') continue
    names.push(t)
  }
  return names
}

/** 进行中回合不被尾行保留的行的集合（完成态 / 无 segment 时为空集）。 */
const KEEP_NONE: ReadonlySet<HTMLElement> = new Set<HTMLElement>()

/** 块的「有效行数」：rows + statusRows + run_code 行解析出的子工具数（Code+子工具占 2+ 行 → 折叠）。 */
function blockFoldableCount(block: Block): number {
  let n = block.rows.length + block.statusRows.length
  for (const row of block.rows) {
    n += subToolsIn(row).length
  }
  return n
}

function deriveBlockInfo(rows: readonly HTMLElement[], statusRows: readonly HTMLElement[] = [], excludeRunning = false, excludeRows: ReadonlySet<HTMLElement> | null = null): BlockInfo {
  const pairs = rows.map(row => ({ row, info: deriveRowInfo(row) }))
  const runningTool = pairs.find(p => p.info.kind === 'tool' && p.info.state === 'running')?.info ?? null
  const runningThink = pairs.find(p => p.info.kind === 'think' && rowRunning(p.row))?.info ?? null
  // excludeRunning（运行中 chip 收起态）：计数只含已完成行，running 行在 chip 外可见；
  // excludeRows（进行中轮次保留的尾行）同样在 chip 外可见，不重复计入。
  // 注意：running 判定必须与 keepRow 一致（用 rowRunning，而非 info.state），否则
  // data-follow-end 兜底识别为 running 的 think 行会被保留可见却又被计入 thinkCount。
  const countedPairs = pairs.filter(p => {
    if (excludeRunning && rowRunning(p.row)) return false
    if (excludeRows !== null && excludeRows.has(p.row)) return false
    return true
  })
  const countedInfos = countedPairs.map(p => p.info)
  const tools = [...new Set(countedInfos.filter(i => i.kind === 'tool').map(i => i.label))]
  // 工具调用按名称 ×次数 统计；PTC(run_code) 解析出子工具名时用子工具名计数代替 Code。
  // 需求5：统计完按数量降序排列，并列保持首次出现顺序（Array.sort 稳定）。
  const toolCounts: { label: string; count: number }[] = []
  let lastToolDescription: string | undefined
  const addCount = (label: string): void => {
    const found = toolCounts.find(c => c.label === label)
    if (found !== undefined) found.count += 1
    else toolCounts.push({ label, count: 1 })
  }
  for (const { row, info } of countedPairs) {
    if (info.kind !== 'tool') continue
    if (info.tool === 'run_code') {
      const subs = subToolsIn(row)
      if (subs.length > 0) {
        for (const sub of subs) addCount(TOOL_LABELS[sub] ?? sub ?? 'Code')
      } else {
        addCount(info.label !== '' ? info.label : 'Code')
      }
    } else {
      addCount(info.label !== '' ? info.label : 'Tool')
    }
    // 最后一次工具调用的说明（不限工具类型）：Code 的 description、Bash 的
    // 命令、Read/Grep 的路径等 summary 都尽量提取；后出现的工具覆盖先出现的。
    const desc = info.summary.trim()
    if (desc !== '') lastToolDescription = desc
  }
  toolCounts.sort((a, b) => b.count - a.count)
  return {
    runningTool,
    runningThink,
    tools,
    hasError: countedInfos.some(i => i.state === 'error'),
    hasStopped: countedInfos.some(i => i.state === 'stopped'),
    allContext: countedInfos.length > 0 && countedInfos.every(i => i.label === '上下文注入'),
    thinkCount: countedInfos.filter(i => i.kind === 'think').length,
    toolCount: countedInfos.filter(i => i.kind === 'tool').length,
    contextCount: countedInfos.filter(i => i.kind === 'context').length,
    failureCount: countedInfos.filter(i => i.kind === 'tool' && i.state === 'error').length,
    toolCounts,
    lastToolDescription,
    retryCount: statusRows.filter(el => (el.getAttribute('data-chat-flow-kind') ?? '') === 'model-retry').length,
  }
}

/** 二级 chip 的分层粒度计数标签（对齐 dsh-turn-fold 的 activityGroup）。 */
function thinkCountLabel(count: number): string {
  return getLocale() === 'zh' ? `${count} 段思考` : `${count} reasoning step${count === 1 ? '' : 's'}`
}
function contextCountLabel(count: number): string {
  return getLocale() === 'zh' ? `${count} 次上下文注入` : `${count} context injection${count === 1 ? '' : 's'}`
}
/** 工具调用统计改为「名称 ×次数」量化（如 Pwsh ×2 · Read ×1），保持首次出现顺序。 */
function toolCountsLabel(counts: { label: string; count: number }[]): string {
  return counts.map(c => `${c.label} ×${c.count}`).join(' · ')
}
function failureCountLabel(count: number): string {
  return getLocale() === 'zh' ? `${count} 个失败` : `${count} failed`
}
function retryCountLabel(count: number): string {
  return getLocale() === 'zh' ? `${count} 次重试` : `${count} retr${count === 1 ? 'y' : 'ies'}`
}

/** 刷新 chip 内容：实时反映当前正在进行的工作。只在内容真正变化时才写
 * DOM —— 流式思考时摘要逐帧变化，无变化写入会触发 MutationObserver
 * childList 自激（pass → 写 → mutation → pass 循环）并造成文本跳动。 */
function updateChip(
  chip: HTMLButtonElement,
  rows: readonly HTMLElement[],
  expanded: boolean,
  statusRows: readonly HTMLElement[] = [],
  working = false,
  codeDescriptionMode = 'always',
  keepRows: ReadonlySet<HTMLElement> | null = null,
): void {
  // 运行中 chip 收起态：计数只含已完成行（running 行 + 进行中轮次保留的最后一行
  // 在 chip 外可见），并在摘要中追加 running 行的实时命令/思考——逐条将已完成的
  // 纳入折叠（issue #3）。
  // I2 加固：白名单归一化，非法值一律按 always 处理。
  const mode = codeDescriptionMode === 'hover' || codeDescriptionMode === 'never' ? codeDescriptionMode : 'always'
  const collapsed = !expanded
  const showCompletedCounts = collapsed && working
  const info = deriveBlockInfo(rows, statusRows, showCompletedCounts, keepRows)
  const title = chip.querySelector<HTMLElement>('.dshcf-chip-title')
  const summary = chip.querySelector<HTMLElement>('.dshcf-chip-summary')
  const code = chip.querySelector<HTMLElement>('.dshcf-chip-code')
  const sep = chip.querySelector<HTMLElement>('.dshcf-chip-sep')
  if (title === null || summary === null) return

  const running = info.runningTool ?? info.runningThink
  // 展开态（出现三级原生行）后右侧摘要消失：三级行自带流式思考/命令
  // 展示，二级不再重复展示摘要；收起态显示摘要。
  // 完成态二级 chip 展示分层粒度计数（思考/上下文/工具调用/失败），对齐
  // dsh-turn-fold 的 activityGroup；运行中（chip 收起、running 行在外）
  // 也展示已完成计数 + running 实时摘要。
  const countParts: string[] = []
  if (info.thinkCount > 0) countParts.push(thinkCountLabel(info.thinkCount))
  if (info.contextCount > 0) countParts.push(contextCountLabel(info.contextCount))
  if (info.toolCounts.length > 0) countParts.push(toolCountsLabel(info.toolCounts))
  if (info.retryCount > 0) countParts.push(retryCountLabel(info.retryCount))
  const countText = collapsed ? countParts.join(' · ') : ''
  // 失败计数只在完成态展示（running 中仍显示实时命令，与计数摘要对称；
  // 运行中的瞬时 error 不闪红，retry 后自然恢复）。
  const failureText = running === null && collapsed && info.failureCount > 0 ? failureCountLabel(info.failureCount) : ''
  let titleText: string
  let summaryText: string
  let codeText = ''

  if (info.runningTool !== null) {
    // 正在调用工具："正在运行" + 已完成计数 + 命令/参数。
    titleText = '正在运行'
    const cmd = collapsed ? info.runningTool.summary : ''
    summaryText = (showCompletedCounts && countText !== '') ? countText + ' · ' + cmd : cmd
  } else if (info.tools.length > 0) {
    // 工具块（含 PTC 子工具）：标题按是否编辑文件区分；计数摘要后追加最后一次工具调用的说明。
    titleText = info.tools.some(tool => tool === 'Edit' || tool === 'Write') ? '编辑了文件' : '运行了命令'
    summaryText = countText
    if (collapsed && info.lastToolDescription !== undefined && info.lastToolDescription !== '') {
      codeText = info.lastToolDescription
    }
  } else if (info.contextCount > 0 && info.thinkCount === 0) {
    // 纯上下文注入块。
    titleText = '上下文注入'
    summaryText = countText
  } else {
    // 纯思考块，或思考 + 上下文注入（无工具）：固定 "已思考"。
    titleText = '已思考'
    summaryText = countText
  }

  // 收起/展开状态由 chevron 方向表达，标题不附加"收起"字样。
  // 完成态的「编辑了文件」用原生 write 图标（与标题同条件：块内含
  // Edit/Write 工具）。running 思考不再镜像「正在思考」标题——chip 图标
  // 跟随实际标题类别（有折叠工具 → 工具图标；否则思考/上下文图标）。
  let kind: 'tool' | 'think' | 'context' | 'write' = info.runningTool !== null
    ? 'tool'
    : info.allContext
      ? 'context'
      : info.tools.length > 0 ? 'tool' : 'think'
  if (info.runningTool === null && info.tools.some(tool => tool === 'Edit' || tool === 'Write')) kind = 'write'
  if (title.textContent !== titleText) title.textContent = titleText
  if (summary.textContent !== summaryText) summary.textContent = summaryText
  if (code !== null) {
    if (code.textContent !== codeText) code.textContent = codeText
    // 显示模式：always=内联常显；hover=悬停浮现；never=不显示。
    const visible = codeText !== '' && mode !== 'never'
    const hoverOnly = mode === 'hover'
    code.classList.toggle('dshcf-hover-only', hoverOnly && visible)
    const codeDisplay = visible ? '' : 'none'
    if (code.style.display !== codeDisplay) code.style.display = codeDisplay
  }
  const failure = chip.querySelector<HTMLElement>('.dshcf-chip-failure')
  if (failure !== null) {
    if (failure.textContent !== failureText) failure.textContent = failureText
    const failureDisplay = failureText === '' ? 'none' : ''
    if (failure.style.display !== failureDisplay) failure.style.display = failureDisplay
  }
  // 计数摘要用普通文本，不复用工具命令的等宽衬底。
  // 运行中 chip 收起态（showCompletedCounts）摘要含已完成计数 + running 命令，
  // 也用普通文本样式（命令部分不再独占等宽衬底）。
  summary.classList.toggle('dshcf-chip-counts', collapsed && summaryText !== '' && (running === null || showCompletedCounts))
  if (sep !== null) {
    const sepDisplay = summaryText === '' ? 'none' : ''
    if (sep.style.display !== sepDisplay) sep.style.display = sepDisplay
  }
  // running 时摘要跟随最新内容：视口贴住右端（原生 ReasoningRow 的
  // scrollLeft 跟随），流式更新时新内容向左流动。只在 running 或刚离开
  // running（上一轮还是 running）时读写滚动量：静止 chip 完全不碰 layout
  // 属性，避免每个 pass 强制回流。
  if (running !== null) {
    summary.scrollLeft = summary.scrollWidth - summary.clientWidth
  } else if (chip.classList.contains('running') && summary.scrollLeft !== 0) {
    summary.scrollLeft = 0
  }
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

/** 从回合尾时间戳消息解析官方耗时（"用时 33秒" / "用时 2分05秒"），
 * 历史会话加载时没有本地 running 起点，用它补上 "已处理 {时长}"。 */
function parseTurnDuration(boundary: HTMLElement): number | undefined {
  const text = boundary.textContent ?? ''
  // 旧格式：turn-tail 带 "用时 33秒" / "用时 2分05秒"。
  const m = text.match(/用时\s*(\d+)分(\d+)秒|用时\s*(\d+)秒/)
  if (m !== null) {
    // 用时 X分Y秒 / 用时 X秒（m[1]/m[2] 与 m[3] 互斥，无其他可达分支）。
    if (m[1] !== undefined && m[2] !== undefined) return Number(m[1]) * 60000 + Number(m[2]) * 1000
    if (m[3] !== undefined) return Number(m[3]) * 1000
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

/** 行的运行状态：工具行的 data-state 在内层 [data-tool] / [data-sample]
 * root 上（外层 callRow 只有 class/anchor/call-id），think 行在自身。 */
function rowState(row: HTMLElement): string {
  if (row.matches('[data-variant="think"]') && !row.hasAttribute('data-tool')) {
    return row.getAttribute('data-state') ?? 'ok'
  }
  const root = toolRootIn(row)
  return root.getAttribute('data-state') ?? 'ok'
}

/** think 行是否处于 running：data-state 优先；data-state 缺失/滞后时用官方
 * ReasoningRow 仅在 running 期存在的实时摘要锚点 [data-follow-end] 兜底。
 * 仅当 data-state 真正缺省（null）时才启用兜底——显式 'ok'（完成态）即使残留
 * follow-end 也不误判，避免完成态思考被错误保留可见。 */
function thinkRowRunning(row: HTMLElement): boolean {
  const state = row.getAttribute('data-state')
  if (state === 'running') return true
  if (state === null) return row.querySelector('[data-follow-end]') !== null
  return false
}

/** 统一行 running 判定：think 行走 thinkRowRunning 兜底；工具行走 data-state。 */
function rowRunning(row: HTMLElement): boolean {
  if (isThinkRow(row)) return thinkRowRunning(row)
  return rowState(row) === 'running'
}

/** 获取当前语言环境。 */
function getLocale(): string {
  if (typeof document === 'undefined' || !document.documentElement) return 'zh'
  const lang = document.documentElement.lang || 'zh-CN'
  return lang.startsWith('en') ? 'en' : 'zh'
}

/** 单个可选指标字段：key = 字段名，label = 用户自定义展示名（可缺省）。 */
interface SummaryFieldSpec {
  key: string
  label?: string
}

/** 解析用户填写的摘要栏字段串：逗号分隔，支持 `字段名(自定义展示名)`。
 * 从括号中解析展示名（未解析到/为空则保持默认）；按 key 去重、保留填写顺序。 */
function parseSummaryFields(fields: string): SummaryFieldSpec[] {
  const specs: SummaryFieldSpec[] = []
  const seen = new Set<string>()
  for (const raw of fields.split(',')) {
    const part = raw.trim()
    if (part === '') continue
    const m = part.match(/^([A-Za-z0-9_]+)\s*\(([^()]*)\)$/)
    const key = m !== null ? m[1] : part
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    // 有括号 → 括号内即为显示名；空括号 () 保留 label=''，表示「只显示值、不显示任何文字」。
    // 无括号 → 无 label（undefined），渲染时使用默认文案。
    const label = m !== null ? m[2].trim() : undefined
    specs.push(m !== null ? { key, label } : { key })
  }
  return specs
}

/** 构建回合摘要文本（含指标和状态标签）。
 *
 * 字段顺序遵循用户在设置中填写的顺序（逗号分隔、支持 name(自定义名) 且去重）；
 * 未填写字段时按规范顺序渲染所有可用指标。终止标签（已停止/已中断）始终追加在末尾。 */
function buildMetricsSummary(duration?: number, metrics?: TurnMetrics, fields?: string, running = false): string {
  const parts: string[] = []
  const orderedFields = fields ? parseSummaryFields(fields) : []
  const fieldList: SummaryFieldSpec[] = orderedFields.length > 0
    ? orderedFields
    : ['duration', 'toolCalls', 'modelCalls', 'inputTokens', 'contextDelta', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cacheHitRate', 'timeToFirstToken', 'tokensPerSecond'].map(key => ({ key }))
  for (const field of fieldList) {
    const part = renderMetricPart(field, duration, metrics, running)
    if (part !== null) parts.push(part)
  }
  if (metrics !== undefined) {
    if (metrics.termination === 'aborted') parts.push(getLocale() === 'zh' ? '\u5df2\u505c\u6b62' : 'Stopped')
    else if (metrics.termination === 'interrupted') parts.push(getLocale() === 'zh' ? '\u5df2\u4e2d\u65ad' : 'Interrupted')
  }
  return parts.length > 0 ? parts.join('  ·  ') : (getLocale() === 'zh' ? (running ? '\u6b63\u5728\u5de5\u4f5c' : '\u5df2\u5904\u7406') : (running ? 'Working' : 'Processed'))
}

/** 渲染单个指标为可读片段；数据缺失时返回 null（跳过该字段）。
 * 自定义展示名存在时以 `值 名称` 形式替换默认后缀；展示名为空串（name()）时只显示值、不显示任何文字。 */
function renderMetricPart(field: SummaryFieldSpec, duration?: number, metrics?: TurnMetrics, running = false): string | null {
  const key = field.key
  const custom = field.label
  const zh = getLocale() === 'zh'
  // 默认文案后缀：zh 直接拼接（无空格）、en 自带前导空格；自定义名一律用空格分隔；
  // 空串 custom（用户填写 name()）→ 只显示值、不带任何后缀。
  const suffix = (value: string, z: string, e: string): string => {
    if (custom === '') return value
    return custom !== undefined ? value + ' ' + custom : value + (zh ? z : e)
  }
  switch (key) {
    case 'duration': {
      if (duration === undefined) return null
      const d = formatDuration(duration)
      if (custom === '') return d
      if (custom !== undefined) return d + ' ' + custom
      return running ? (zh ? '已工作 ' + d : 'Working ' + d) : d
    }
    case 'toolCalls':
      return metrics !== undefined && metrics.toolCalls !== undefined && metrics.toolCalls > 0
        ? suffix(String(metrics.toolCalls), '次工具调用', ' tool calls')
        : null
    case 'modelCalls':
      return metrics !== undefined && metrics.modelCalls !== undefined && metrics.modelCalls > 0
        ? suffix(String(metrics.modelCalls), '次模型调用', ' model calls')
        : null
    case 'inputTokens':
      return metrics !== undefined && metrics.inputTokens !== undefined && metrics.inputTokens > 0
        ? suffix(formatTokensShort(metrics.inputTokens), '输入', ' in')
        : null
    case 'contextDelta': {
      if (metrics === undefined || typeof metrics.contextDelta !== 'number' || metrics.contextDelta === 0) return null
      const v = metrics.contextDelta
      const text = (v > 0 ? '+' : '-') + formatTokensShort(Math.abs(v))
      // 带符号的增量统一用空格分隔（+1.2K 新增上下文），避免「+1.2K新增上下文」拥挤。
      if (custom === '') return text
      return text + ' ' + (custom !== undefined ? custom : (zh ? '新增上下文' : 'new context'))
    }
    case 'outputTokens':
      return metrics !== undefined && metrics.outputTokens !== undefined && metrics.outputTokens > 0
        ? suffix(formatTokensShort(metrics.outputTokens), '输出', ' out')
        : null
    case 'reasoningTokens':
      return metrics !== undefined && metrics.reasoningTokens !== undefined && metrics.reasoningTokens > 0
        ? suffix(formatTokensShort(metrics.reasoningTokens), '推理', ' rsn')
        : null
    case 'cacheReadTokens':
      // 缓存命中的输入 token 数量（从缓存读取、未重新计费的输入）。
      return metrics !== undefined && metrics.cacheReadTokens !== undefined && metrics.cacheReadTokens > 0
        ? suffix(formatTokensShort(metrics.cacheReadTokens), '缓存命中', ' cache hit')
        : null
    case 'cacheWriteTokens':
      // 缓存写入 token 数量（本回合新写入缓存、下回合可命中）。
      return metrics !== undefined && metrics.cacheWriteTokens !== undefined && metrics.cacheWriteTokens > 0
        ? suffix(formatTokensShort(metrics.cacheWriteTokens), '缓存写入', ' cache write')
        : null
    case 'cacheHitRate': {
      const pct = cacheHitRatePct(metrics)
      if (pct === null) return null
      if (custom === '') return pct + '%'
      if (custom !== undefined) return pct + '% ' + custom
      return formatCacheHitRate(metrics)
    }
    case 'timeToFirstToken': {
      if (metrics === undefined || metrics.timeToFirstToken === undefined || metrics.timeToFirstToken <= 0) return null
      const v = ttftValue(metrics.timeToFirstToken)
      if (custom === '') return v
      if (custom !== undefined) return v + ' ' + custom
      return formatTimeToFirstToken(metrics.timeToFirstToken)
    }
    case 'tokensPerSecond': {
      if (metrics === undefined || metrics.tokensPerSecond === undefined || metrics.tokensPerSecond <= 0) return null
      const v = formatTokensPerSecond(metrics.tokensPerSecond)
      if (custom === '') return v
      return custom !== undefined ? v + ' ' + custom : v + ' tok/s'
    }
    default:
      return null
  }
}

/** 缓存命中率 = 缓存命中 token / 总输入 token。
 * 总输入 = 未缓存输入 + 缓存命中 + 缓存写入（与显示的「输入」字段同源）。
 * 无任何缓存读写活动时隐藏（避免无缓存回合显示 0% 噪音）。 */
function cacheHitRatePct(metrics?: TurnMetrics): string | null {
  if (metrics === undefined) return null
  const input = metrics.inputTokens
  if (typeof input !== 'number' || input <= 0) return null
  const cacheRead = typeof metrics.cacheReadTokens === 'number' ? metrics.cacheReadTokens : 0
  const cacheWrite = typeof metrics.cacheWriteTokens === 'number' ? metrics.cacheWriteTokens : 0
  if (cacheRead === 0 && cacheWrite === 0) return null
  const pct = (cacheRead / input) * 100
  return pct >= 99.95 ? '100' : pct < 10 ? pct.toFixed(1) : String(Math.round(pct))
}

function formatCacheHitRate(metrics?: TurnMetrics): string | null {
  const pct = cacheHitRatePct(metrics)
  return pct === null ? null : pct + '%' + (getLocale() === 'zh' ? '缓存命中率' : ' cache hit rate')
}

/** 首 token 用时（毫秒 → 紧凑秒值，如 2.3秒 / 2.3s）。 */
function ttftValue(ms: number): string {
  const secs = ms >= 10000 ? Math.round(ms / 1000) : Math.round(ms / 100) / 10
  return getLocale() === 'zh' ? secs + '秒' : secs + 's'
}

/** 首 token 用时（毫秒 → 紧凑秒）。 */
function formatTimeToFirstToken(ms: number): string {
  return getLocale() === 'zh' ? '首token ' + ttftValue(ms) : 'ttft ' + ttftValue(ms)
}

/** 格式化 tokens 为可读短格式（如 1234 → "1.2K"）。 */
function formatTokensShort(count: number): string {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M'
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K'
  return String(count)
}

/** 检查 metrics 是否包含任何 token 数据（用于判定是否需要重试提取）。 */
function hasTokenMetrics(metrics: TurnMetrics): boolean {
  return metrics.inputTokens !== undefined
    || metrics.outputTokens !== undefined
    || metrics.reasoningTokens !== undefined
    || metrics.cacheReadTokens !== undefined
    || metrics.cacheWriteTokens !== undefined
}

/** 创建 "已处理 {时长}" 行元素（右侧小箭头，点击行为由控制器绑定）。 */
function createProcessedRowElement(duration?: number, metrics?: TurnMetrics, fields?: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'dshcf-processed'
  btn.setAttribute('aria-expanded', 'false')
  const text = document.createElement('span')
  const summary = buildMetricsSummary(duration, metrics, fields)
  text.textContent = summary
  const chevron = createChevronIcon('dshcf-processed-chevron')
  btn.append(text, chevron)
  btn.title = '展开工作过程'
  btn.setAttribute('aria-label', summary + ' - 点击展开/收起工作过程')
  return btn
}

/** 创建回合进行中的实时摘要行（非交互，带运行呼吸点）。 */
function createProcessingRowElement(): HTMLDivElement {
  const div = document.createElement('div')
  div.className = 'dshcf-processing'
  div.setAttribute('role', 'status')
  const dot = document.createElement('span')
  dot.className = 'dshcf-live-dot'
  const text = document.createElement('span')
  text.className = 'dshcf-processing-text'
  div.append(dot, text)
  return div
}

/** 毫秒 → 中文紧凑时长（素材 Codex 对齐：14秒 / 2分05秒 / 15分）。
 * 整分钟（秒为 0）省略秒位：15分00秒 → 15分；整小时 → X小时。 */
/** tok/s 紧凑显示：保留 0 位小数（四舍五入取整）。
 * rc.1 的 turn-tail.data.tokensPerSecond 是原始浮点（如 34.8775521404277），
 * 直接拼接会带长尾。 */
function formatTokensPerSecond(value: number): string {
  return String(Math.round(value))
}

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
 * 把其中的文本节点 "Deep diving..." 替换为自定义状态提示词，流光
 * 特效在 CSS 上（dsh-turn-status-shimmer），不受影响。React 重渲染会
 * 恢复原文，pass() 每轮自愈。
 * @param statusText - 完整替换文案；调用方已排除空值。
 */
function replaceTurnStatus(flow: HTMLElement, originals: Map<Text, { original: string; written: string }>, statusText: string): void {
  const statuses = flow.matches('[role="status"]')
    ? [flow, ...flow.querySelectorAll<HTMLElement>('[role="status"]')]
    : [...flow.querySelectorAll<HTMLElement>('[role="status"]')]
  for (const status of statuses) {
    for (const node of status.childNodes) {
      if (node instanceof Text && node.data.includes('Deep diving')) {
        let record = originals.get(node)
        if (record === undefined) {
          record = { original: node.data, written: '' }
          originals.set(node, record)
        }
        // 宿主在插件写入后更新过该节点（当前文本 ≠ 上次写入值，且仍含
        // Deep diving）时，以宿主最新文本为新还原基线——否则 stop() 会把
        // 节点还原成更旧的首见原文，覆盖宿主更新（评审实证：宿主把状态
        // 行改成 'Deep diving fast...' 后会被还原成首见的 'Deep diving...'）。
        if (node.data !== record.written) record.original = node.data
        // 同时吃掉原生三段点号，避免用户填入 "Deep sleeping..." 时
        // 与原文尾部 "..." 叠成双省略号。
        const next = node.data.replace(/Deep diving[.…]*/, statusText)
        // 写入守卫：值不变不赋值。否则每轮 pass 的赋值会产生
        // characterData mutation，在 characterData 观察下自激循环。
        if (node.data !== next) {
          node.data = next
          record.written = next
        }
      }
    }
  }
}

/** 只恢复仍保留插件改写文案的节点，避免覆盖宿主之后的状态更新。 */
function restoreTurnStatus(originals: Map<Text, { original: string; written: string }>): void {
  for (const [node, record] of originals) {
    // 仅当节点文本仍是插件写入后的值（written）才还原为宿主原文：
    // 若 React 已把状态行替换成新文案（≠ written），说明宿主有更新的
    // 状态要展示，插件不得覆盖。
    if (node.isConnected && node.data === record.written && node.data !== record.original) node.data = record.original
  }
  originals.clear()
}

function removeStyle(): void {
  document.getElementById(STYLE_ID)?.remove()
}
