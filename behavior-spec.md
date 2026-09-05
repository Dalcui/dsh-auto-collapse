# dsh-auto-collapse 行为规范（Behavior Spec）

> 状态：2026-08-26 更新版（默认字段扩展、单条不折叠、统计记录级复现、model-retry 块前吸收、contextDelta 首轮基线0）。本文件是需求与行为的唯一权威来源；实现与 handoff 以本文件为准。
>
> 2026 第二轮增补（R1-R6）：chip 以块顶 `head` 为锚（块前状态行也折叠在 chip 下、不跳动）；正文之间不同类别系统信息跨类别合并折叠、chip 标注类别×数量；进行中 running 块强制展开；指标分隔符改间隔点；工具名按数量降序；PTC 子工具名解析+强制折叠。

## 一、总目标

把 DSH Web 聊天工作流改造成接近 VSCode Codex 深色主题的折叠体验：
**界面只保留模型说的话**（最终输出文本），工作流程（思考、工具、过程正文）折叠为摘要行。
插件不得修改消息内容，只控制工作流程、工具行、思考行和过程正文的显示状态。

**核心原则：整个执行过程能分层级、量化地展示。** 模型正文之外的一切系统信息（思考 / 工具调用 / 上下文注入 / 重试等状态行）都按「类别 × 数量」折叠成可展开的行，进行中最新的活动保持可见。

对照基准：`codex-ui-reference.md`（VSCode Codex 扩展 UI 解剖结论）。

## 二、等级结构（以此为准）

- **一级**：回合完成后的 `已处理 X秒` / `已处理 X分Y秒` 行。只有回合完成才产生，**工作中不显示一级**。
- **二级**：折叠行 chip（`正在运行 {命令}` / `运行了命令` / `编辑了文件` / `已思考` / `上下文注入`）。**工作中显示的就是二级**。
- **三级**：展开二级后露出的原生行（原生思考行 / 命令卡）。单条命令结果的展开由 DSH 原生 disclosure 管理，插件不干预。
- **正文**：带中文输出的消息文本。每次模型输出都是一条正文消息；中间过程 step 是中间正文（完成态折叠，只留最终输出）；回合最终输出永远显示。

## 三、模型工作时的行为（按等级）

### 二级（工作中可见）
- 每个工具组 / 思考块折叠为一行 chip：
  - 工具组：`[终端图标] 正在运行 {命令}`（显示当前正在执行的命令）
  - 思考块：**进行中的思考由原生 ReasoningRow 单独承载**（原生行显示「正在思考」+ 实时思考内容）；chip 不再镜像「正在思考」标题与实时思考内容，只显示已完成折叠部分的类别标题 + 计数（有折叠工具 → `运行了命令`/`编辑了文件`，否则 → `已思考`）。
- **进行中保持最新内容可见（R3）**：回合进行中（未闭合）时，含 running 行的二级块**保持收起**（`aria-expanded=false`），但 **running 行在 chip 外可见**——已完成行逐条折叠进 chip、running 行留在 chip 外实时可见。chip 摘要在 running 命令之外追加已完成项的计数（如「正在运行 · Bash ×2 · Get-Content a.txt」）。这样 running→ok→running 切换时不会整块反复折叠/展开，而是逐条将已完成的纳入折叠。回合闭合后全部回到默认收起。
- **进行中轮次尾行保留（R9，可配置）**：运行中轮次里，最后 `keepLastRows` 个**系统提示行**（思考 / 工具 / 上下文等非模型输出内容）始终保留完整显示、不收入折叠——默认 **3** 个；该设置可在插件配置卡片「进行中保留行数」自定义。**0 表示不保留任何系统行（含正在 running 的行，全部折叠）**；`>0` 时 running 行按 R3 保留可见、另保留最后 N 个系统尾行。这些保留行不计入 chip 的已完成计数。回合闭合后全部回到默认收起。
- **轮次折叠保留最后 N 条正文（可配置 `keepLastBodySteps`，默认 1）**：每个轮次折叠（一级收起）时，该轮最后 N 条**正文文本消息**不收入轮次折叠、保留显示；设置可在插件配置卡片「轮次折叠保留正文条数」自定义。默认 1 = 只保留最终正文（历史行为）；填 0 = 除最后一个轮次外，其余轮次的全部正文（含最终正文）都折叠进轮次行，**最后一个轮次始终至少保留 1 条正文**（含最后一条正文的段才计为「最后轮次」，尾部空 user 段不算）。轮次行点击展开后仍可查看被折叠的正文。
- **running 时摘要跟随滚动**：内容流式更新时视口贴住文本右端（新内容向左流动），`text-overflow: clip`；非 running 复位开头。
- 运行中带平滑呼吸动画（Pulse）；`prefers-reduced-motion: reduce` 下停止动画。
- 相邻工具组合并为一个 chip；正文是硬边界（不跨正文合并）。**正文之间不同类别的系统信息跨类别合并折叠**（think + 工具 + 上下文注入 + 状态行合成一个 chip），chip 标注各自类别×数量。
- **进行中的纯思考在工具行后单独立块（R7）**：工具行（已完成）后紧接的「正在思考」元素是新一轮推理（随后会产出新的工具调用），不再并入上方工具块——否则进行中的思考会把上方已完成工具块的 chip 标题带成「正在思考」并两行同时逐帧刷新。已完成态仍按 R2 跨类别合并（tool→think 不拆块）。
- chip 以块顶 `head`（host ∪ containers ∪ statusRows 中 DOM 最靠前者）为锚，块前状态行（model-retry 等）也折叠在 chip 之下，折叠/展开时 chip 位置稳定不跳动（R1）。
- 点击展开：显示该组全部命令行（**不自动展开每条命令的运行结果**）；再点收起。
- 二级收起/展开**不得改变**单条命令原有的 open 状态（三级由原生管理）。

### 实时摘要行 + 一级（工作中）
- 模型工作时**没有可点击的一级折叠行**，只在回合工作流最顶端显示一条**实时摘要行**：`已工作 X秒 | 工具调用 / tokens…`，带运行呼吸点、非交互（`role=status`），耗时每秒走表。对齐 dsh-turn-fold 的 running summary，只实时统计、不可整段收起。
- 各块的二级 chip 照常显示，且**在回合进行中即可折叠/展开**（对齐 dsh-turn-fold 的 activity group）。
- 回合完成（边界出现且所有工具 done）后：实时摘要行消失，生成可点击的一级行，收起整个工作流程。

### 三级（工作中即存在）
- 单条命令卡由 DSH 原生渲染（含流式结果输出）。
- 点击原生单条命令行展开/收起运行结果——原生 disclosure，插件不干预。

## 四、完成态行为（按等级）

### 一级（回合完成后）
- 默认收起：只显示一行 `已处理/耗时 X秒`（或 `X分Y秒`），以及模型最终正文。
- 点击一级摘要行 → 按原始顺序展开上下文、思考、工具组、过程正文和最终正文。
- **异常终止也生成一级行**：回合被手动停止、或异常中断却**没有正常的 turn-tail 边界**时（段内出现 `data-state=stopped/aborted` 的工具行、或终态失败 `turn-error` / 输出上限 `turn-max-tokens` 状态行），视同闭合，仍生成一级行折叠工作过程；停止态摘要末尾追加「已停止」标签。`model-retry`（重试链，非终态）不触发此判定；判定仅在无 running 行时生效，避免流式进行中误折叠。
- **无 think/tool 的纯文本回合不生成一级行**（当前产品语义；曾尝试改为生成不可展开行，因真实页面展开态行为异常已回退，待重新设计）。
- **回合级状态行随段折叠**：DSH 原生重试链（`model-retry`，"已重试模型请求…"）、终态失败（`turn-error`）、达到输出上限（`turn-max-tokens`）等状态装饰行都是 flow 直接子级、携带文本但非 assistant-step。**块内状态行**（落在某工具组之间、或紧邻工具组**上一行**）归入该二级块，随 chip 二级折叠/展开（chip 收起时折叠、展开时恢复），不再把"运行了命令"组视觉拆成多段；**块外状态行**（被正文/user/steering/turn-tail/context 隔开的）随一级折叠隐藏、展开恢复——工作中（未闭合）无一级折叠故块外状态行保持可见。一级摘要行锚定在所有状态行之前，不落到"已重试模型请求"行下方。
- 时长：优先取会话记录的 `turnTimings`（注入器发布的 `durationMs`，记录级、可复现、跨重启一致），回退 turn-tail / timeStart 解析，再回退本地运行行计时；格式 `X秒` / `X分Y秒`（整分省略秒位）。

### 二级（一级展开后）
- 一级展开后，相邻命令组 / 思考组各自折叠为一行 chip（`运行了命令` / `编辑了文件` / `已思考` / `上下文注入`）。混合块标题优先级：有工具 → `运行了命令`/`编辑了文件`；无工具有上下文 → `上下文注入`；其余（含思考）→ `已思考`。
- **跨类别合并（R2）**：正文之间相邻的不同类别系统信息（think + 工具 + 上下文注入 + 状态行）合成一个 chip，不再因类别不同各自单条而不折叠（如 `tool + context` 两条也折叠为一个 chip）。
- **仅相邻 ≥2 条非正文内容才折叠**：单条工具调用 / 单段思考 / 单条上下文注入不生成二级 chip，保留原生行展示（只折叠一条无意义）。
- **chip 收起态展示分层粒度计数**（对齐 dsh-turn-fold activityGroup）：`N 段思考 · 工具名 ×次数 · N 次上下文注入 · N 次重试`（如 `Bash ×2 · Read ×1`）；**工具名按数量降序排列**、并列保持首次出现顺序；有失败时追加浅红 `K 个失败`（独立 span，浅红色 `--dsw-alias-state-error-primary`）。**工具名优先读 `data-tool`，回退 `data-sample`**（bash 等 keyed toolview 的 bash-sample 样式没有 `data-tool`，标准模式下据此解析出 Bash，避免整块降级为 `Tool ×N`）；运行状态同样从 `data-tool`/`data-sample` root 的 `data-state` 读取，bash-sample 的 running 行因此不会误判为完成态被折叠。
- **PTC（run_code）子工具名展示（R6）**：PTC 模式下单个 `Code` 卡内编排多个工具调用、dsh 系统解析出 ≥1 个具体工具名时（`Code` 与子工具占 2+ 行），强制对其折叠；折叠行优先按解析出的子工具名 × 数量展示实际使用的工具情况（子工具同样兼容 `data-tool`/`data-sample`），未获取到系统解析的实际工具名时才用 `Code` 兜底。收起态末尾仍追加该折叠中**最后一次工具调用**的说明——不限 Code，任意工具的 summary（Code 的 description、Bash 的命令、Read/Grep 的路径等）都提取、后出现的覆盖先出现的（显示方式由设置 `codeDescription` 控制：`always` 内联常显 / `hover` 悬停浮现 / `never` 不显示，默认 `always`）；展开态摘要清空、不回显。
- 点击 chip 展开后只显示该组命令行，不自动展开每条命令结果；展开态计数摘要清空（三级原生行接管展示）。
- 二级收起/展开必须同时作用于该块的所有相邻命令容器（不能只展开第一组），并连同块内状态装饰行一起折叠。

### 三级（二级展开后）
- 点击原生单条命令行后才展开该命令的运行结果。
- 二级收起后再次展开，不得改变单条命令原有的 open 状态。

## 五、中间正文与最终输出

- 每个回合（按 user / steering 边界切分）内，最后一个有正文的消息 = 该段**最终输出**：默认（`keepLastBodySteps=1`）正文保留显示，其 think 行折叠。
- 其余有正文消息 = **中间正文**：整条折叠（完成态只留最终输出，Codex 对齐）。
- **可配置保留条数**：`keepLastBodySteps` 设为 N 时，每轮最后 N 条正文消息保留显示（N≥1 含最终输出）；**填 0 时除最后一个轮次外，所有正文（含最终正文）全部折叠进轮次行**，最后一个轮次始终至少保留 1 条（最终输出）。被折叠正文点击轮次行展开后恢复。
- 插话（steering）边界前的模型消息：该段的最终输出按上述保留规则处理（默认保留显示；keepLastBodySteps=0 且该段非最后含正文段时也折叠）。

## 六、插话（用户插入消息）机制

- **DSH 的插话是排队机制**：用户在工作中的模型插嘴时，消息进入队列，**模型处理完当前工作后才插入**（各家 harness 一致行为）。
- 因此不存在「模型输出到一半被插话打断」的工况——插话边界出现时，插话前的模型段必然已完整产出。
- 结构：`user → 模型段A（think+正文）→ steering（排队插入）→ 模型段B → turn-tail`
- 行为：段 A 的最终输出文本**保留显示**（A 是该段 finalStep，只认领不折叠）；段 B 同理。
- 多级插话（`A → steering1 → B → steering2 → C`）：每段最终输出各自保留。
- **指标按段切分（issue #1 修复）**：同一回合内被 steering 切分的各段各自显示自己的指标（工具调用/模型调用/token 用量/耗时），不再共享回合级聚合值。注入器（turn-metrics.ts）按 `sessionId:turn:segOrdinal` 隔离发布，segOrdinal 为段内序号（0=首轮段、1=首次插话后…）。段 B 的实时耗时从段起点（runningSince）算，不再用回合级 turnStartTime（含段 A 时间）。上下文增量 = 本段末输入 − 上一段末输入（跨段跨回合）。

## 七、已知边界与极端工况（推演结论）

- 分批渲染（历史会话）：消息乱序挂载时可能出现临时中间态（如某段 think 以 chip 短暂可见），**最终收敛正确**（各段 finalStep 显示、中间正文折叠）。
- 正文迟到（收尾时正文未渲染）：正文到达后自动恢复显示（已有测试覆盖）。
- 无 think/tool 段（纯正文）：一级行不可展开、正文直接显示（见第四节）。
- **待实测确认**：用户在模型工作中直接插话（非 subagent 消息）时，插话节点在 DSH 真实 DOM 中的 kind 是否为 `steering`（边界）。代码按 steering 处理；若实测为其他 kind，段 A 可能被当中间正文折叠，需按实测调整。

## 八、摘要栏指标（指标字段）

- **可配置字段**：设置 → 插件 → 插件配置的"摘要栏指标"用逗号分隔字段名控制显示哪些指标；未填写时按规范顺序渲染全部可用指标。默认：`duration,modelCalls(次模型),toolCalls(次工具),inputTokens(输入),cacheReadTokens(命中),cacheHitRate(命中率),outputTokens(输出),contextDelta(上下文)`。
- **自定义展示名**：字段名后可跟 `(自定义展示名)` 覆盖显示名（如 `inputTokens(输入上下文)`）；写空括号 `()`（如 `inputTokens()`）表示只显示值、不显示任何文字；未写括号则用默认展示名。按字段名去重、保留填写顺序。
- **字段清单**：`duration`（耗时）、`toolCalls`（工具调用）、`modelCalls`（模型调用）、`inputTokens`（输入）、`outputTokens`（输出）、`reasoningTokens`（推理）、`cacheReadTokens`（缓存命中）、`cacheWriteTokens`（缓存写入）、`cacheHitRate`（缓存命中率）、`timeToFirstToken`（首token用时）、`tokensPerSecond`（输出速度）、`contextDelta`（本轮新增上下文）。
- **inputTokens 语义（总输入，含缓存命中）**：优先取内置精确总量 `turn-tail.data.tokenUsage.totalTokens − outputTokens`（= prompt 总量，与 DSH 原生统计同源；缓存桶缺失时三桶求和会漏掉缓存命中部分——正是「显示的输入其实只是未命中缓存」的修复根因）；精确总量缺失时回退 未缓存输入 + cacheReadTokens + cacheWriteTokens 三桶求和。per-step usage 回退（旧版/无 tokenUsage）与 data-usage DOM 兜底同口径。**缓存/推理桶只在聚合值存在时覆盖 per-step 值**：内置 aggregateAttempts 在任一 attempt 缺桶时整体置 undefined，此时保留 per-step 累加值、不得清零（否则「输入含缓存命中、命中字段却消失」自相矛盾）。
- **contextDelta 语义**：= 本回合最后一次模型调用（finalStep）的输入 token 总量（含 cache read/write）− 上一回合最后一次模型调用的输入 token 总量；正值表示本轮新增的上下文长度，可为负。**首轮回合（turn 1）无上一回合，基线取 0，即 = 本回合末输入（该轮建立的完整上下文）**；turn > 1 但上一回合末输入缺失（窗口分页截断）时保持不显示、不臆造基线。数据由注入器按 sessionId+turn 精确归属。**注意**：末次输入取 `assistant-step.data.usage`（末次 attempt 的真实上下文规模，同 inputTokens 精确口径 totalTokens−outputTokens 优先），而非 `turn-tail.data.tokenUsage`——后者的 `uncachedInputTokens` 是跨所有 attempt 求和的 billed 总量，重试多时虚高，会导致「新增上下文」塌成负几百 K。
- **modelCalls 含重试**：DSH 重试不新建 assistant-step 节点，而是独立 `model-retry` 节点（`data.attempts` 为重试尝试数组）——只统计 `retryState === 'started'` 的已实际发起的重试（scheduled/cancelled 未产生模型调用），与 tokenUsage 跨 attempt 求和的 input/output 口径对齐。无 `data` 或 `finalNode` 缺失的 assistant-step 不计入（避免 partial usage 污染）。
- **timeToFirstToken 来源**：rc.1 直接读 `turn-tail.data.ttftMs`（毫秒，deriveTurnMetrics 计算）；旧版文本解析（「首token X秒」）仅作兜底，不覆盖精确值。
- **终止标签**：回合被停止/中断时摘要栏末尾追加「已停止」/「已中断」。
- **指标分隔符**（R4）：多个指标间用更宽更弱的间隔点 `  ·  ` 分隔（不再用 `|`），弱化分隔符、加大间隔。

## 九、其他约束（沿用）

- 设置项新增 **`codeDescription`**（`always` / `hover` / `never`，默认 `always`）：控制完成态二级折叠行末尾「最后一次工具调用说明」的显示方式——`always` 内联常显（历史行为）、`hover` 鼠标悬停 chip 时浮现、`never` 不显示；解决折叠行说明文字与正文密集、信息过载的问题。说明不再局限于 Code：任意工具的 summary（Code 的 description、Bash 的命令、Read/Grep 的路径等）都提取，后出现的工具覆盖先出现的。
- **一键展开/收起全部二级折叠**（修饰键方案，无新增 UI）：`Shift + 点击一级行` 展开该回合全部二级（再次 Shift+点击收起该回合全部二级）；`Ctrl/Cmd + Shift + E` 全局展开/收起所有一级 + 二级。
- 状态提示词（默认 `Deep sleeping...`）只允许在插件运行期间替代 `Deep diving`；设置为空时不替换；插件卸载时必须恢复宿主原文。
- 图标：二级工具块优先克隆原生 IconApiOutline14（3 path），克隆不可得时用同款硬编码 path 兜底（视觉一致）；完成态「编辑了文件」块优先克隆原生 IconEditOutline16（write/edit 工具行同款），同样以硬编码 path 兜底；思考块用原生 think 图标；无原生可克隆时兜底。
- 不得产生重复行、错位、残留空白、正文消失或内容截断。
- 中文文案、中文时长格式。

## 十、统计记录级复现与会话隔离（2026-08 新增）

- **指标按 `sessionId:turn:segOrdinal` 隔离**：main↔subagent 各会话 turn 号都从 1 起，仅按 turn 编号会跨会话串扰；插话（steering）切分同回合多段时仅按 turn 编号会导致段间共享同一聚合值（"完全相同"bug）。注入器按 `sessionId:turn:segOrdinal`（segOrdinal=段内序号，0=首轮段、1=首次插话后…）隔离发布，在 shadow host 同步写 `data-dshcf-session`/`data-dshcf-turn`/`data-dshcf-seg`，折叠层按会话+回合+段精确取数。
- **turn 归属优先 `data-turn-tail`**（turn-tail 原生属性，同步稳定、记录级），注入器的 `data-dshcf-turn` 仅作运行期/兜底。
- **实时计时用记录级起点** `turnStartTime`（来自 `turnTimings.get(turn).startTime`）：切换 main↔subagent 会话不会让进行中回合计时从 0 重新开始；本地 `runningSince` 仅作注入器未就绪时的兜底。插话后段（segOrdinal>0）的 turnStartTime 是回合级起点（含段 A 时间），故段 B 实时耗时回退 runningSince（段首次 running 的时间）。
- tokensPerSecond 保持 DSH 官方 `deriveTurnMetrics` 的"该轮聚合吞吐"语义；显示保留 0 位小数（四舍五入取整）。
