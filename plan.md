# dsh-auto-collapse 需求与修复方案

> 状态：已确认，实施中。本次 8 项需求/问题修复的实施方案，核对 DSH 0.1.1-rc.2 客户端数据模型后编写。
> 决策：需求1=A（首轮 baseline 0）、需求3=保持官方一致不修改、需求4=A（仅二级 chip）。
> 审查策略：各部分首次代码审查用 nova/deepseek-v4-flash，往后用 nova/glm-5.2。

## 0. 已核实的关键事实（决定方案正确性）

阅读 `@deepseek-ai/dsh-client-ui-conversation` / `dsh-client-runtime` 0.1.1-rc.2 类型与 bundle 后确认：

1. **会话快照已含可复现的统计源**：
   - `ConversationSnapshot.turnTimings: ReadonlyMap<number, {startTime, endTime?}>` —— 每回合起止时间，记录级、可复现、跨重启一致。
   - `chat.nodes`（ChatNodeStore）+ `chat.order`：每个节点带 `location.turn.turn`、`kind`、`data`。
   - assistant-step 的 `data.finalNode.timing = {stepStartTime, firstTokenTime, completedTime}`、`data.usage`（含 inputTokens/cacheRead/cacheWrite/output/reasoning）。
   - `sessionId` 可从 `useSession(s => s.sessionId)` 取得。
2. **turn-tail 元素稳定携带回合号**：`TurnTailNodeView` 渲染 `data-turn-tail={turn}`（同步、稳定、非注入器异步 effect 产物）。现在 injector 写的 `data-dshcf-turn` 依赖 React effect，存在异步窗口/可能缺失。
3. **官方 tokensPerSecond 已是"该轮聚合吞吐"**：`deriveTurnMetrics` = ΣoutputTokens / ΣdecodeMs（只统计同时有 timing 与 usage 的 step），本就是"该轮模型调用的加权平均"，不是"最后一次调用"。
4. **steering 是稳定 chat node kind**：`data-chat-flow-kind="steering"`（`SteeringMessageNode`），代码里按 steering 切段是正确假设。
5. **客户端模型**：每个 chat node 渲染成 `div.flowItem[data-chat-anchor-key][data-chat-flow-key][data-chat-flow-kind]`；其子层才是具体内容（think 用 `[data-variant="think"]`，工具卡用 `[data-chat-call-id]`）。

## 1. 方案总原则

1. **统计尽量从会话记录复现，不依赖实时 DOM 结果**：耗时用 `turnTimings`；token/调用数/吞吐用 `chat.nodes` 逐 turn 累加（injector 已做）；DOM 文本解析仅作兜底。
2. **turn 归属优先用稳定数据源**：`data-turn-tail`（turn 号）优先，injector 的 `data-dshcf-turn` 作运行期/兜底。
3. **metrics 按 session 隔离**：跨会话（含 main↔subagent）的 `metricsByTurn` 仅按 turn 编号会串扰，改为按 `sessionId:turn` 隔离。

---

## 2. 逐项方案

### 需求 1：首轮 contextDelta

**现状**：`contextDelta = 本回合末模型输入 − 上一回合末模型输入`；首轮无上一回合 → 不显示（返回 undefined）。

**问题**：用户方案"减去本轮第一次模型调用输入"会漏掉第一次调用自身的输入 token，不完整。

**方案（已确认 A）**：统一公式 `contextDelta(turn) = lastModelInput(turn) − baseline`：
- `turn > 1` 且能取到上一回合末输入时：baseline = 上一回合末输入（现状）。
- `turn === 1`（真正首轮）：baseline = 0，即 `contextDelta = 本回合末输入`（首轮建立的全部上下文）。
- `turn > 1` 但上一回合末输入缺失（窗口分页截断等）：保持 undefined（不臆造基线）。

实现：`src/turn-metrics.ts` 的 `readPreviousTurnLastInput` 改为返回判别结果（找到/未找到/首轮），并在 `computeTurnMetrics` 内直接算好 `contextDelta`，让 fold.ts 与注入值走同一逻辑。`test/metrics-unit.test.mjs` 同步更新（首轮断言从 `undefined` 改为 `=== lastModelInput`）。

### 需求 2：默认显示字段

默认摘要字段串改为：

```
duration,modelCalls(次模型),toolCalls(次工具),inputTokens(输入),cacheReadTokens(命中),cacheHitRate(命中率),outputTokens(输出),contextDelta(上下文)
```

改动点（统一默认值，避免多处漂移）：
- `src/locales.ts`：新增 `DEFAULT_SUMMARY_FIELDS_STRING` 常量，`SUMMARY_FIELDS` 补上 `contextDelta`。
- `src/index.ts`、`src/settings.ts`（`summaryFieldsProvider` 与设置卡 placeholder/defaultFields）都从 locales 引用该常量。

### 需求 3：tokensPerSecond —— 不改（保持官方一致）

**结论（已确认）**：现有取值即官方 `deriveTurnMetrics` 的"该轮聚合吞吐"（Σ输出 tokens / Σ解码时长），语义正确，保持现状**不修改**。

### 需求 4：仅相邻 2+ 条才折叠（二级 chip 级）

**范围（已确认 A）**：二级折叠 chip。单个非正文条目（单条工具调用 / 单段思考 / 单条上下文注入）不再生成 chip，保留原生行展示；当相邻 ≥2 个条目合并成块（`rows.length + statusRows.length >= 2`）时才生成 chip 折叠。

实现：`findBlocks` 末尾对 `blocks` 过滤出"可折叠块"（行数 ≥2），单行块不进 `blocks`（自然无 chip、无二级折叠）。一级"已处理 N秒"回合行与指标摘要**保留**（它折叠的是整轮工作流并承载指标，不是"折叠一条内容"）——此项若你希望连一级也对单条抑制，确认后再调整。

### 需求 5：插话统计摆脱实时结果、按会话记录复现

根因（多处叠加）：
1. **耗时依赖实时**：`state.duration` 来自 `parseTurnDuration`（DOM 文本）+ `runningSince`（本地计时），插话/重启下不可靠。
2. **turn 归属脆弱**：`segmentTurnNumber` 只读 injector 异步写的 `data-dshcf-turn`，插话窗口内可能缺失 → 回退文本解析取错回合。
3. **metrics 跨会话串扰**：`metricsByTurn` 仅按 turn 编号，main↔subagent 同号回合互相覆盖/复用。

方案：
- **耗时改记录级**：`computeTurnMetrics` 额外发布 `turnStartTime`/`turnEndTime`/`durationMs`（来自 `turnTimings`）。完成态 `state.duration = metrics.durationMs` 优先，仅兜底 `parseTurnDuration`/`runningSince`。
- **turn 归属**：`segmentTurnNumber` 优先读 `data-turn-tail`（boundary 的 `[data-turn-tail]`），再回退 `data-dshcf-turn`。
- **metrics 按 session 隔离**：injector 从 `useSession(s => s.sessionId)` 取 sessionId，`publishTurnMetrics(sessionId, turn, m)`；存储键 `sessionId:turn`；读接口加 sessionId 参数。injector 同时在 shadow host 写 `data-dshcf-session`；fold.ts 从同源读 sessionId 再取数。

### 需求 6：内容叠进"正在思考"

**定位方向**（需落地用例实证）：
- `findBlocks` 把相邻 think+tool 合并进同一块，块标题按运行态取舍；若 think 行 `data-state` 滞留 running，或 think/tool 行被 `data-variant` 误分类，会出现工具/正文被装进"正在思考"chip。
- `thinkRowsIn`/行分类需收紧（排除工具卡/command 行）；`splitThinkByBody` 的正文边界判定需复核。

做法：补回归 fixture（think 紧邻 tool / think 后接正文 / tool 后接 think），先复现再定点修复；同时排查同类（context 被装进工具 chip、正文装进工具 chip 等）。

### 需求 7：subagent 里"运行了命令"漏收"已重试模型请求"

根因：`findBlocks` 对 statusRow 只在 `run` 已是 work 块时才吸收进 `run.statusRows`；当 model-retry 行出现在工具组**上一行**（run 尚未建立）时为 null 被漏掉 → 只随一级折叠、不随二级 chip 折叠。

方案：引入 `pendingStatusRows` 暂存；遇 statusRow 且无 work 块时先暂存，之后首个 work 块建立时吸收进 `statusRows`；遇 user/steering/turn-tail/context/正文边界则清空（视为真正块外）。这样"上一行"的 retry 也随"运行了命令"chip 一起折叠。

### 需求 8：subagent↔主会话切换，进行中回合计时归零

根因：`switchFlow` 清空 `runningSince`，切回时重新 `Date.now()` 起算，实时"已工作 X秒"从 0 开始。

方案：实时计时改用记录级起点 —— `buildLiveSummary` 用注入器发布的 `turnStartTime`（`turnTimings.get(turn).startTime`）计算 `Date.now() − turnStartTime`；拿不到时回退 `runningSince`。切换 flow 不再影响计时起点。

---

## 3. 文件与改动点

- `src/turn-metrics.ts`：sessionId 隔离存储；`computeTurnMetrics` 增 turnStartTime/turnEndTime/durationMs/tokensPerSecond/contextDelta；`readTurnMetrics(sessionId, turn)`、`readPreviousTurnLastInput(sessionId, turn)`；shadow host 写 `data-dshcf-session`。
- `src/fold.ts`：`segmentTurnNumber` 优先 `data-turn-tail`；`extractTurnMetrics` 读 sessionId + durationMs/tokensPerSecond/contextDelta；pass() 的 duration 取 `metrics.durationMs`；`buildLiveSummary` 用 turnStartTime；findBlocks 单行块过滤（需求4）+ pendingStatusRows（需求7）+ think 分类收紧（需求6）。
- `src/locales.ts`、`src/settings.ts`、`src/index.ts`：默认字段统一（需求2）+ contextDelta 入 SUMMARY_FIELDS。
- `test/metrics-unit.test.mjs`：更新首轮 contextDelta、sessionId 隔离、tokensPerSecond 复算、turnStartTime 断言。
- `test/fold-*.test.mjs`（新增/增补）：需求4 单条不折、需求6 边界、需求7 retry 上一行吸收、需求8 计时不归零、需求5 插话两轮各自统计。
- `behavior-spec.md`、`README.md`：同步默认字段与行为描述。

## 4. 验证与部署

- `npm run check`（tsc + 构建 + 全量回归）全绿。
- `npm run deploy` 部署本机 DSH profile，硬刷新后人工验证：首轮 contextDelta、默认字段、单条不折、插话两轮统计、subagent↔主切换计时、retry 随 chip 折叠。

## 5. 决策结果（已确认）

1. **需求1**：采用 A——首轮 contextDelta = 本回合末输入（基线 0）。
2. **需求3**：保持官方 `deriveTurnMetrics` 一致，**不修改** tokensPerSecond。
3. **需求4**：采用 A——仅二级 chip 级抑制单条（一级"已处理"行保留）。

实施顺序：需求2/4 → 需求1/5/8（记录化重构）→ 需求7 → 需求6，每批 subagent 审查（首审 deepseek-v4-flash，复审 glm-5.2）。