# 问题①（tokensPerSecond / ttft 恒为空）代码审查报告

审查员：独立代码审查 subagent（session 012b5e7e）
日期：2026-10-01
审查对象：E:\Git\dsh-auto-collapse 工作区未提交改动（HEAD = 2592612）
环境实证：dsh 0.2.0-rc.2 / @deepseek-ai/dsh-client-ui-chat 0.2.0-rc.2（实测 node require 取版本，非推断）

---

## 0. 结论摘要

**批准合入（有条件）**。ttft 自算主链路与官方 \`assistantStepReading\` + \`deriveStats\` 口径一致、经差分 fuzz 与变异测试交叉验证，可发布；**未发现阻断级缺陷（P1）**。发现 2 处口径偏差（P2）+ 1 处新建关键代码零测试覆盖（P3），建议合入前修掉 P3-1 与 P2-1。

实测回归：**node test/run-all.mjs = 32/32 全绿**；\`npm run typecheck\` exit 0；\`node build.mjs\` 四道守卫（host/client d.ts 导出面、node --check ×2）全过。

> **⚠️ 范围提示（影响本次审查的解读）**：工作区实际改动**远大于**任务书描述的「问题① 三处文件」——
> \`git diff --numstat\` = lib/client.js 114/32、**src/fold.ts 265/51**、src/turn-metrics.ts 45/8、
> test/fold-017-safety 2/2、**test/fold-retry.test.mjs 360/0（新文件）**、test/metrics-unit 45/6。
> src/fold.ts 的大改属于**问题②/⑤**（P3 缺口①、根因 A/B、D-1/F-1 修正），已超出「问题①」范围。
> 本报告对问题① 相关部分做穷尽审查；fold.ts 的大改**未做穷尽审查**（它需要自己的审查轮次）。

---

## 1. 审查方法（可复核）

1. **逐条对读官方 bundle**：\`dsh-client-ui-chat/lib/client.js\`（assistantStepReading / deriveStats / StatsPills 展示端 / tailData / finalNode 构造）、\`dsh-session-stats/lib/index.js\`（真正驱动 UI 的 \`sessionStats\` 投影，\`deriveStats\` 只是 fallback，见 CHAT:6911-6922 注释）、\`dsh-client-ui-conversation\` 的 records.d.ts 契约。
2. **独立复刻官方口径做差分 fuzz**：在临时目录按官方语义重写 \`usageOutputTokens\` / \`assistantStepReading\` / \`deriveStats\`，与插件 \`computeTurnMetrics\` 对跑 **6000 例**随机（生产真实形态：timing 三字段恒存在、值为数值或 null）。
3. **变异测试**：对新增代码注入 6 个语义变异体，看现有断言能否杀死。
4. 全部探针写在系统临时目录；源码在实验后按 SHA256 逐字节还原（见 §7）。

---

## 2. A. 口径一致性逐条核对

官方原文（chat 0.2.0-rc.2）：

\`\`\`js
// CHAT:6873-6890
function usageOutputTokens(usage) {
  if (typeof usage !== "object" || usage === null) return null;
  const value = usage.outputTokens;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function assistantStepReading(node) {          // node = AssistantMessageNode（= finalNode）
  const timing = node.timing;
  return {
    ttftMs:  timing !== void 0 && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
    decodeMs: timing !== void 0 && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
    outputTokens: usageOutputTokens(node.usage)
  };
}
// CHAT:6923-6961 deriveStats
if (reading.ttftMs !== null) { ttftMs += reading.ttftMs; ttftSteps += 1; }
if (reading.decodeMs !== null && reading.outputTokens !== null) { decodeMs += reading.decodeMs; decodeTokens += reading.outputTokens; }
// CHAT:7004 / 7057-7058 展示端
tps = stats.decodeMs > 0 ? decodeTokens / (stats.decodeMs / 1e3) : null
ttft 显示 = stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : （整块不渲染）
\`\`\`

| # | 官方语义 | 插件实现（src/turn-metrics.ts） | 判定 |
|---|---|---|---|
| i | ttftMs 为 null（timing 缺失 / 两时刻任一为 null）⇒ **该步完全不累计**（不加 ms、不加 steps） | 361-368：要求 \`typeof stepStartTime === 'number' && isFinite\` 且 \`firstToken !== undefined\`，否则整步跳过 | ✅ 一致 |
| ii | ttft 展示 = 累加值 / **计入步数**（平均） | 432-435：\`liveTtftSteps > 0 ? liveTtftMs / liveTtftSteps : undefined\` | ✅ 一致（实测两步 100/300 ⇒ 200） |
| iii | \`Math.max(0, first − start)\` 钳零 | 366：\`Math.max(0, firstToken - stepStartForTtft)\` | ✅ 一致（实测 first<start ⇒ 0） |
| iv | decodeMs 要求 \`firstTokenTime !== null\`，且 \`Math.max(0, …)\` | 346-352：要求 firstToken 存在且 \`completed > firstToken\`（**严格大于**，见 P2-2） | ⚠️ 分母有偏差 |
| v | \`decodeMs !== null && outputTokens !== null\` **才**累计（两步都非空） | 346-355：同一 if 内同时要求两者，一致 | ✅ 一致 |
| vi | outputTokens 非负有限数才有效（\`>= 0\`） | 349：\`typeof stepOut === 'number' && isFinite(stepOut) && stepOut >= 0\` | ✅ 一致 |
| vii | 展示端 \`tps = decodeTokens/(decodeMs/1e3)\`，比值 | 425-427：\`liveOutputTokens / (liveDecodeMs / 1e3)\` | ✅ 一致 |
| viii | 官方对 **interrupted** 步：无 \`node.timing\` 就整体 null 不累计；有 timing 则照常累计 | 插件只按「是否 settle 且 timing 形态完整」判定，不额外看 interrupted 标志 | ✅ 一致 |
| ix | 官方**无 attempt 聚合**：重试不新建 assistant-step（CHAT:7592 \`llm/retry → resetForRetry\`，仅重置 blocks 并**保留 firstTokenTime**，不重置计时）⇒ 一次 step 一条 reading | 插件按 step 节点累计（model-retry 节点另计 retryCalls，不参与 tps/ttft） | ✅ 一致 |
| x | 官方读 \`node.timing\` / \`node.usage\`（= finalNode 自身字段） | 315：\`n.data.finalNode?.timing ?? n.data.timing ?? n.timing\`；329：读 \`n.data.usage\` | ⚠️ 见 P2-1 |

**结论**：ttft 主链路（i/ii/iii）与 tps 主体（vii/viii/ix）**确实是官方口径**，不是「看起来像」。

### ⚠️ 一个必须澄清的前提：官方「权威值」的口径与插件并不同源

任务书称「官方 \`deriveStats(nodes)\` 对**每个 assistant 节点**累加」。实测该表述需要修正：

- 驱动真机的**不是** \`deriveStats\`。CHAT:7135-7136：\`const projected = useProjection("sessionStats"); const stats = projected ?? deriveStats(settledNodes)\`。\`deriveStats\` 是 CHAT:6911-6922 注释里明写的「FALLBACK for assemblies without the sessionStats projection」。
- 真机权威是 \`dsh-session-stats/lib/index.js:107-126\` 的事件流投影，它对 **\`assistant/message\`** 累加：\`firstToken = open.firstTokenTime ?? assistantStreamFirstTokenTime(event.data.stream)\` —— 即**即便 live-chunk 不在窗口内，也能从 message 的 stream 把首 token 时间捞回来**。
- \`deriveStats\` 的输入是 \`useChat(s => s.legacy.nodes)\`（CHAT:7132），而 legacy 只收 \`data.finalNode\`（CHAT:8580），**不是** step 包装节点。

对插件的直接后果：**插件永远达不到官方口径**（插件只读 DOM 快照的 finalNode.timing，拿不到 stream），只能做到「\`deriveStats\` 同口径」。这在分页/压缩后的历史回合表现为**漏值**（插件无值、官方有值），而不是假值——可接受，但应在代码注释里写明，避免后人误以为已完全对齐。

---

## 3. 缺陷清单（按严重度）

### P2-1 — ttft 自算的 gating 比官方更严：usage 形态的 settled 步会整步丢掉 ttft

**位置**：src/turn-metrics.ts:329 \`if (n.data.usage === null || typeof n.data.usage !== 'object') return\`，位于 356-368 的 ttft 累计**之前**。

**官方行为**：\`deriveStats\` 对每个 assistant 节点**独立**取 reading —— \`ttftMs\` 只看 timing，\`outputTokens\` 只看 \`node.usage\`。usage 缺失只影响 decodeTokens/decodeMs，**不影响 ttftMs 与 ttftSteps**。

**插件行为**：\`data.usage\` 缺失时在 329 行提前 return，ttft 一并丢弃。

**实证**（定向探针）：
\`\`\`
[A: settled 步有 timing、无 usage] + [B: settled 步 timing+usage]
官方口径 ttft 平均 = (400+100)/2 = 250
插件实际          = 100      ← 少了无 usage 那一步，平均值被拉低/丢失
\`\`\`
差分 fuzz 中这是 ttft 不匹配的主体（6000 例中 785 例，绝大多数由该结构触发）。

**性质**：**漏值 + 数值偏低**（不是假高值）。同时它使「全回合都没有带 usage 的步」时 ttft 整块消失，而此时官方是有值的。
**建议**：把 ttft 累计移到 usage 早退之前，或把 usage 读取改为 \`n.data.usage ?? n.data.finalNode?.usage\` 兜底。

### P2-2 — tps 分母在「0 毫秒步」上与官方不同源（严格大于 vs 钳零）

**位置**：src/turn-metrics.ts:350-352 \`&& completed > firstToken\`（注释自陈目的是「避免除零」）。

**官方**：\`decodeMs = Math.max(0, completed − firstToken)\` **不跳过**；\`decodeMs === 0\` 的步其 outputTokens **照常计入分子**，只把 0 加进分母。

**插件**：整步排除（分子分母都不加）。

**实证**：
\`\`\`
[step1 completed==firstToken, 300 tok] + [step2 decodeMs=500ms, 100 tok]
官方 tps = (300+100)/0.5s = 800
插件 tps = 100/0.5s       = 200
\`\`\`
差分 fuzz：tps 的 601 例不匹配**全部**属于这一类（含「decodeMs<=0 步」者 601 / 非零时长步 0 —— 即除该点外 tps 与官方逐位一致）。

**性质**：插件值**低于**官方（不必担心虚高），但存在两个次生风险：
1. 真机时间戳若为秒级精度（0.2.0 的 records 已把旧「单调时钟 ms」改标为 \`/** Unix epoch ms from the source session event */\`），「秒内完成」的极短步会真实出现 ⇒ 与官方数值系统性偏离；
2. 与官方「decodeMs > 0 才显示 tps」的守卫不同源，未来若有人对齐守卫会引入新的不一致。

**建议**：改 \`completed >= firstToken\`，用「本分组累计 liveDecodeMs > 0」承担除零守卫（与官方 \`decodeMs > 0\` 同构）；或在注释中显式声明这是**有意的偏离**并给出理由（当前注释给出的理由是「避免除零」，而除零实际由 425 行守卫承担，理由与实现不符）。

### P3-1 — 新增的 turnAcc ttft 合并（573-578）**零测试覆盖**，且**变异存活**

变异测试：\`turnAcc.liveTtftMs += g.liveTtftMs\` → \`+= 0\`（等价于「多分组回合整回合条目不合并 ttft」）⇒ **全套 32 个测试文件 + 新增 3 条 ttft 断言全部照常通过**。

实证后果（同一夹具，未变异 vs 变异）：
\`\`\`
未变异：seg0.ttft=100  seg1.ttft=300  whole(TURN_SCOPE_SEG).ttft=200   ← 正确（官方整回合平均）
变异后：                                whole(TURN_SCOPE_SEG).ttft=0     ← 必被显示守卫拒显（<=0 ⇒ null）
\`\`\`
即：**该 4 行是整回合 ttft 的承重墙，但没有一条断言保护它**。新增的 3 条 ttft 断言（metrics-unit:485-498）全部跑在**单段**夹具（\`computeTurnMetrics(42, ['t1','t2'], …)\` 无 steering），走的是 \`allSegs.length === 1\` 的复用分支，根本进不到 573-578。
**建议**：在既有的多分组夹具（metrics-unit:265 那组，已有 steering 切段）补一条 \`scope.timeToFirstToken === <两段平均>\` 断言即可。

### P3-2 — 兜底 billed.ttftMs 与自算口径**不同源**，可产出比自算更差的显示值（非阻断）

自算 ttft = 逐 settled 步平均（与官方展示端一致）；而 \`turn-tail.data.ttftMs\`（rc.1 字段，2.0 已删）按 ISSUE 报告是「deriveTurnMetrics 计算的**回合内首步**时延」。两者在「有自算值」时自算优先（正确），但在 **0 个 settle 步带 timing** 的回合，兜底会把「首步时延」当作整回合 ttft 显示。

**实测该窗口在 rc.2 下的真实范围**：
- \`turnTailTtft\` 取值处（turn-metrics.ts:517）要求 \`n.data.ttftMs\` 为有限正数；rc.2 的 \`tailData()\`（实测 CHAT:10414-10436）返回 \`{turn, seq, time, closing, branchUnavailable, tokenUsage?}\` —— **确无 ttftMs**，故 **rc.2 上该兜底是死代码**（对 rc.1 仍有效，保留合理）。
- 更常见的是**文本兜底**：fold.ts:3503-3505 从渲染文本解析「首token X秒」，门控仅 \`coversTurn\`。同一段落里 turn-tail 的官方输出**确实是整回合值**，故文本兜底同样正确；只有当文本来自「单步过程行」时才会是单步值（既有的、非本次引入的旧不确定性）。
**判定**：B（自算优先是否可接受）**可接受**。rc.2 上没有「官方权威值更准但被自算覆盖」的场景——billed 字段根本不存在；反方向（rc.1）**恰好是本次改动要修的问题**：rc.1 的 \`ttftMs\` 是首步值，而官方展示端是平均，旧实现的「billed 优先」在 rc.1 上就已经没有对齐官方。只有在「首步时延 > 平均值」时，rc.1 的 billed 更接近官方吗？不是——官方口径就是平均，自算才是对的。**仅需补充文档说明**。

### P3-3 — 新增注释自相矛盾（可信度问题）

src/turn-metrics.ts:418-424 注释写：
> 「反转后：新版走自算（口径与官方 deriveStats 一致），**旧版若有权威值仍优先生效**。」

但代码（425-428）现在是**自算恒优先**，旧版权威值只在**没有任何 settled 步**时兜底，并不「优先生效」。测试也把这条旧语义显式改掉了（\`withTail.tokensPerSecond === 100\`，注释「自算速率优先于 turn-tail 权威值」）。注释与代码/测试三方矛盾，会误导后续维护者。**建议改写为**：「自算优先；billed 仅在无任何可自算步时兜底（rc.1 兼容）」。

### P4-1 — tokenUsage 的「跨 attempt 求和」提示已过时（仅文档）

- src/turn-metrics.ts:379-381 与 293-295 仍写「turn-tail 的 tokenUsage 是跨 attempt 求和的回合级总量」；但 0.2.0-rc.2 的 \`tokenUsage\` 来自 \`deriveTurnTokenUsage(context.matches…)\`（CHAT:10427），**只收 turn/start..turn/end 的事件**，\`llm/retry\` 不进结果 ⇒ 它是**单次尝试（回合最终 attempt）**的量，不是跨 attempt 求和。
- 该过时注释还造成**局部自相矛盾**：\`effectiveCoveredOf\`/chip 那侧（fold.ts）同批改动的注释写的是「tokenUsage 是**单次尝试**的量」，两处对同一字段给出相反描述。
**性质**：纯文档缺陷。本次新增的 tps/ttft 计算**不读 tokenUsage**（tps 只读 \`acc.liveOutputTokens\`/\`liveDecodeMs\`；ttft 只读 timing），故不影响数值正确性。与 ISSUE 报告 §问题① 第 2 条「tokenUsage 仍在/跨 attempt 聚合」的残留表述一致，属同源历史遗留。

---

## 4. B / C / D / E 逐项回答

### B. 自算优先是否正确 —— **正确，可接受**
理由见 P3-2：rc.2 上 billed 字段不存在（实测 tailData 无该字段），不存在「官方权威值更准却被自算覆盖」；rc.1 上「官方展示端=平均」这一事实意味着自算才是与官方一致的口径，旧的 billed 优先反而偏离。方向判断成立。**唯一需要修的是注释（P3-3）**。

### C. tokenUsage 口径冲突 —— **新实现不产生假值**
任务书提示「turn-tail 的 tokenUsage 是跨 attempt 求和，自算 tps 用单 attempt per-step output，分子不同源」。逐条核实：
- 自算 tps 的**分子与分母同源**：都取自同一步 \`finalNode\` 的 \`timing\` 与 \`usage\`（343-355），与 \`billed\` 参量**零耦合**（425-427 只读 \`acc.*\`）。因此不存在「分子来自 tokenUsage、分母来自自算」的混源。
- 对账口径（input/output/cacheRead…，389-417）仍走 billed→per-step 回退，**未在本轮改动中被触碰**。
- 重试场景：DSH 不新建 assistant-step（\`llm/retry\` 只 resetForRetry，且**保留 firstTokenTime**），插件按 step 节点取 finalNode，与官方 \`deriveStats\` 逐节点取 reading 同构 ⇒ 无重复计入、无跨 attempt 混合。
**结论**：重试场景下**没有假值**。P2-2（0ms 步）是唯一的数值偏离，且方向偏低。

### D. 多分组 / 插话回合 —— **整回合口径正确**
实证（两段夹具：seg0 一步 ttft=100、seg1 一步 ttft=300）：

| 作用域 | ttft | tps | 官方对应物 |
|---|---|---|---|
| seg 0 | 100 | 100 | （官方无段级概念） |
| seg 1 | 300 | 500 | （官方无段级概念） |
| TURN_SCOPE_SEG | **200** | 233.33 | 官方整回合 = Σttft/Σsteps = 200 ✓ |

1. **整回合条目 = 该回合全部 settled 步的 ttft 平均** ✓ —— 与官方 \`deriveStats\`/sessionStats 的整回合口径一致（用户在上一次审查里点名的漏洞已按预期修好）。
2. **段级语义**：\`segOf\` 对分组内每个节点取值相同 → 分组与「steering 切分的节点区间」重合（steering 节点本身会把区间切开）；因此「段内所有步平均」在数值上恰好等于「段内 per-step 平均」，与官方「整回合平均」是同一算子在子区间上的限制，语义可解释。实测表中 seg0=100 / seg1=300 已证实不存在跨段漏水。
3. **不变式**：\`avg(seg_i)\` 是 \`avg(whole)\` 的固定点意义上的加权平均（权重=各段步数），无重复计入、无跨段混合。

### E. 边界矩阵（全部实测）

| 边界 | 期望（官方口径） | 实测结果 | 判定 |
|---|---|---|---|
| 0 个 settled 步（全用 billed） | billed 兜底 | \`billedOnly.tokensPerSecond === 42.5\`（metrics-unit:477 实测通过） | ✅ |
| firstTokenTime = null | 该步不计入、步数不加 | 平均只由有效步决定（300，而非 (100+300)/2） | ✅ |
| stepStartTime = null | 该步不计入 | 同上（ttft 一致） | ✅ |
| timing 整体缺失 | ttft=null、decodeMs=null | \`timeToFirstToken === undefined\` | ✅ |
| completedTime <= firstTokenTime | 官方：decodeMs=0 仍累计 | 插件：整步排除（**P2-2 偏离**） | ⚠️ |
| 全零时长步 | 官方 decodeMs=0 ⇒ 不显示 tps | 插件 \`liveDecodeMs>0\` 守卫 ⇒ undefined + 展示守卫拒显 | ✅ |
| interrupted 步（有 timing+usage） | 与 settled 同样计入 | ttft=250、tps=120、modelCalls 不计（同既有语义） | ✅ |
| interrupted 合成 finalNode（无 timing） | 不计入 | 通过 \`typeof stepTiming === 'object'\` 挡下 | ✅ |
| liveOutputTokens = 0 | 比值为 0 | tps=0 → fold.ts:5563 \`<= 0\` 守卫拒显 | ✅ |
| firstToken < stepStart | \`Math.max(0,..)\` | 0 | ✅ |
| stepStartTime 为非数（字符串等） | 且条件为假 ⇒ null | \`typeof === 'number' && isFinite\` 挡下 | ✅ |

---

## 5. F. 回归（实际运行，非推断）

| 项目 | 命令 | 结果 |
|---|---|---|
| 全量测试 | \`node test/run-all.mjs\` | **32 个测试文件全部通过**（exit 0） |
| 类型检查 | \`npm run typecheck\` | **exit 0**，无输出 |
| 构建 + 四守卫 | \`node build.mjs\` | host/client d.ts 导出面 ok、\`node --check\` ×2 ok |
| 产物一致性 | \`git hash-object lib/client.js lib/index.js\` | \`f236c5a7…\` / \`3d154924…\`，与本次审查开始前**逐字节相同**（审查未污染产物） |

---

## 6. G. 测试质量

**结论：4 处桩改写是新语义的真实反映，不是「为了通过而放宽断言」；鉴别力总体良好，但有 1 处关键缺口（P3-1）与 3 处不足。**

鉴别力证据（变异测试，6 个变异体；用 Node 逐字节改写源码后跑 metrics-unit）：

| 变异体 | 结果 |
|---|---|
| M1 \`liveTtftSteps += 1\` → \`+= 0\`（步数不自增） | **杀死 ✓** 2 条失败（平均被算成累加值） |
| M2 \`turnAcc.liveTtftMs += g.liveTtftMs\` → \`+= 0\` | **存活 ✗** ← P3-1，见下 |
| M3 tps 退回 billed 优先 | **杀死 ✓** 3 条失败 |
| M4 ttft 不取平均（用累加值） | **杀死 ✓** 1 条失败（400 ≠ 200） |
| M5 ttft 去掉 stepStartTime 校验 | 锚点未命中（该条件跨行，见下注） |
| M6 ttft 去掉 \`Math.max(0, …)\` | **存活 ✗** —— 现有夹具中 firstTokenTime 恒 > stepStartTime，钳零分支无覆盖 |
| \`turnAcc.liveTtftSteps += g.liveTtftSteps\` → 恒 0 | **杀死 ✓** 1 条（whole.ttft 变 0） |

**逐条评价改写后的桩**：
1. **metrics-unit:279**（\`seg0.timeToFirstToken === 500\`）——这条**鉴别力弱**：\`seg0\` 用的是**未带 stepStartTime** 的旧夹具（48-49 行 \`finalNode: {}\`），自算必然为空，于是走 billed 兜底。它证明的是「兜底还活着」，不是「自算对」。测试标签已改为「无 stepStartTime 时回退 billed 500 且只归属首分组」，**标签诚实**，可接受；但同一断言在旧标签下也成立，属**未真正反映新语义的一条**（只是语义恰好仍成立）。
2. **metrics-unit:280**（\`100\` 而非 42）——真断言，M3 杀死 ✓。
3. **metrics-unit:284**（\`110\`）——真断言，M3 杀死 ✓。
4. **metrics-unit:466**（\`100\` 而非 42.5）——真断言 ✓。
5. 新增 3 条 ttft 断言（485-498）：平均/null 不计入两条有效（M1/M4 杀死）；**billed 兜底那条（477）**有效；但三条**全在单段夹具**上，这正是 **P3-1 缺口**的成因。
6. **「空集真」检查**：\`seg1.timeToFirstToken === undefined\`（279）在**任何**实现下都易为真（seg1 无状态行、无 billed），属弱断言；\`noFirst.tokensPerSecond === undefined\`（456）同理（「不产出」类断言天然弱）。二者**并非本轮新引入**，但会稀释「ttft 正确性」的信号，建议未来对「undefined 断言」配一条同夹具的正向对照（本文件在多数分组已这么做，仅这两处欠缺）。

**缺失的覆盖（建议补测）**：
- (a) 多分组回合的 **TURN_SCOPE_SEG ttft = 各段平均**（P3-1，最重要）；
- (b) \`Math.max(0, …)\` 钳零分支（firstTokenTime < stepStartTime）；
- (c) settled 步**无 usage** 时的 ttft（P2-1，用于固化修复后的语义）。

> 注：M5 未命中是**测试方法局限**（我按单行锚点替换，该条件跨两行），非「变异存活」；P2-1 已由定向探针独立证实存在该路径，无需依赖此项。

---

## 7. 硬性约束遵守与恢复自查

- 未启动任何次级 subagent；未调用 memory / skill_manage；未执行任何 git 写操作（全程只读 \`git status/diff/hash-object/rev-parse\`）。
- **临时改源码做变异实验 6 次 + 定向实验 1 次，结束前已逐字节还原**：
  - 实验前备份 → 审查结束时 \`src/turn-metrics.ts\` SHA256 = \`54B500BD1E5270203788AF55CB1EE332A20787F2245656307C8651A193B74941\`，与备份**完全一致**；
  - \`git diff --numstat -- src/turn-metrics.ts\` 回到 **45 insertions / 8 deletions**（与审查开始时相同）；
  - 已重新 \`node build.mjs\`，\`lib/client.js\` / \`lib/index.js\` 的 \`git hash-object\` 与审查前**逐字节相同**（\`f236c5a7…\` / \`3d154924…\`）。
  - ⚠️ 中途一次用 PowerShell \`Get-Content -Raw\`/文本替换往返曾造成编码损坏（非 UTF-8 往返），已**立即从备份还原**并改用 Node 逐字节改写；上述 hash 证据即还原后核验。
- 探针全部写在 \`%TEMP%\dshcf-review1\`；仓库内**仅新增本文件**（\`review/review-issue1.md\`），未新增/删除其他仓库文件。
- 未提交、未推送。

---

## 8. 合入建议

**批准合入**；建议在合入前按优先级处理：

| 优先级 | 项 | 工作量 |
|---|---|---|
| 应修 | **P3-1** 补「多分组整回合 ttft = 各段平均」断言（唯一零覆盖的承重代码） | ~5 行 |
| 应修 | **P3-3** 修正 418-424 注释（「旧版权威值仍优先生效」与代码相反） | ~3 行 |
| 建议修 | **P2-1** 让无 usage 的 settled 步也能贡献 ttft（与官方 \`deriveStats\` 对齐；当前会丢值且偏低） | ~5 行 |
| 建议修 | **P2-2** 明确 0 毫秒步的处理：要么与官方一致（\`>=\`，靠 \`liveDecodeMs > 0\` 守卫除零），要么在注释里声明为有意偏离并给出真实理由 | ~3 行 |
| 建议 | **P4-1** 更新 tokenUsage「跨 attempt 求和」的过时注释（与 fold.ts 同批注释自相矛盾） | ~4 行 |
| 建议 | 补 §6 的 (b)(c) 两项缺失覆盖 | ~10 行 |
| — | **fold.ts 的 265 行大改（问题②/⑤）建议单独走一轮审查**——它引入了新的段级/直播段驱动路径与 \`controlledDisplay\` 账本交互，与本报告范围不重叠 | 独立审查 |

## 9. 仍需真机验证（静态无法定论）

1. 真机 **interrupted 回合**的最终数值（本报告用构造夹具验证，未做真机比对）。
2. 真机 \`AssistantTiming\` 时间戳**精度**（秒级 or 毫秒级）——决定 P2-2 的现实影响面。
3. 分页/长会话历史回合中插件 ttft 的**缺失比例**（对应 §2 前提说明的「漏值」窗口）。
4. \`value.timeToFirstToken\` 的展示是否与官方 \`stats.dialog.ttft\` 在真机同页可比（建议取一个多步回合做并排比对）。
