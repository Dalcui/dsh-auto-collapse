# 问题①（tps/ttft）第二轮独立复核报告

审查员：独立代码审查 subagent（session 349c4272-47e4-47f1-9864-af66bdfb4480）
日期：2026-10-01
审查对象：`E:\Git\dsh-auto-collapse` 工作区未提交改动（HEAD = 2592612），本轮聚焦「P2-1 / P2-2 / P3-3 / P4-1 修复 + 新补测试」的独立验证
环境实证：`@deepseek-ai/dsh-client-ui-chat` **0.2.0-rc.2**（node require 取版本，非推断）

---

## 0. 结论摘要

**批准合入。** 本轮四项修复**全部真实生效**，且经变异测试与差分 fuzz 交叉验证：
P2-1 已真正修好（无 usage 的 settled 步 ttft 计入，且**未**破坏「ttft 仅限 settled 步」）；
P2-2 三项子条款（0ms 计入 / `firstTokenTime===null` 不计入 / `outputTokens` 缺失不计入）逐条实测与官方同源；
P3-1 的变异已被新用例**杀死**（首轮存活）；P3-3 / P4-1 注释已按实改写。

**未发现阻断级（P1）缺陷，未发现由本次改动引入的新数值缺陷。** 差分 fuzz 在 4 组随机种子 × 8000 例（共 32000 例，采用生产真实形状：`finalNode` 缺失 ⇔ `status='running'`）下，ttft 与 tps **零不匹配**。

遗留 **1 项 P2 级缺陷 + 4 项 P3/P4 级**。其中 **P2-A（P4-1 修复方向搞反、把正确注释改成了错误注释）是本轮新引入的**，但它只影响注释与文档、**不影响任何数值**（tps/ttft 的计算路径完全不读 tokenUsage）。

实测回归：**`node test/run-all.mjs` = 32/32 全绿**；`npm run typecheck` exit 0；`node build.mjs` 四道守卫全过。

---

## 1. 审查方法与取证（可复核）

1. **逐字对读官方 bundle**：`dsh-client-ui-chat/lib/client.js`（`assistantStepReading` 6883-6890 / `deriveStats` 6923-6961 / `StatsPills` 展示守卫 7004、7013、7057-7058 / `projectAssistant` 7596-7617 / `legacyContribution` 8546-8584 / `deriveTurnTokenUsage` 10277-10391 / `aggregateAttempts` 10236-10264 / `tailData` 10414-10436）、`dsh-session-stats/lib/index.js`（真机权威投影 85-126）、`dsh-agent-loop/lib/index.js`（1096-1123，`llm/retry-started` 的耐久化）。
2. **官方语义复刻 + 差分 fuzz**：在临时目录按官方源码逐字复刻 `usageOutputTokens` / `assistantStepReading` / `deriveStats`，与插件 `computeTurnMetrics` 对跑 32000 例。
3. **变异测试（14 个变异体）**：Node 逐字节改写源码 → 跑 metrics-unit → 还原；**每个变异体先经 esbuild 语法校验**（避免把「写坏源码导致崩溃」误判为 KILLED），存活变异体再跑定向行为探针区分「NOOP 存活」与「真存活」。
4. **定向探针**：构造夹具逐条验证 A/B/C/D 四问与 E 注释口径。
5. 全部探针写在 `%TEMP%\dshcf-review2`；源码实验后 SHA256 逐字节还原（见 §6）。

---

## 2. A. P2-1 是否真修好 —— **是，且未引入新问题**

### A.1 无 usage 的 settled 步确实计入 ttft（首轮实测 100）

| 夹具 | 官方口径 | 插件实测 | 判定 |
|---|---|---|---|
| p1（settled、无 usage、ttft=400ms）+ p2（settled、有 usage、ttft=100ms） | (400+100)/2 = **250** | **250** | ✅ 修好（首轮为 100） |
| 整回合只有**一步且无 usage**（ttft=250ms） | 250 | **250** | ✅ 修好（首轮整块为 undefined） |

「整回合唯一步无 usage」这一档首轮**连值都没有**，现已与官方一致——修复价值不止于拉低平均。

### A.2 移动后**没有**引入「非 settled 步也计入 ttft」

| status | finalNode | ttft 实测 | 期望 |
|---|---|---|---|
| `settled` | 有 | 400 | 计入 ✅ |
| `interrupted` | 有 | 400 | 计入 ✅ |
| `running` | 有（非法形状） | undefined | 不计入 ✅ |
| `aborted` | 有（非法形状） | undefined | 不计入 ✅ |
| `undefined`（旧版节点） | 有 | undefined | 不计入 ✅ |
| `running` | 无 | undefined | 不计入 ✅ |

**ttft 仍严格限定 settled。** 另注：`status` 缺失（旧版 DSH）的节点**不计 ttft 但计 modelCalls**（走 `!== 'interrupted'` 兼容分支）——这是既有语义、非本轮引入，且这类节点必然无 finalNode，生产不可达。

### A.3 声明上移的行为等价性（回答 D）

`stepStatus` / `settled` 由「usage 早退之后」上移到「ttft 之前」：
- 二者是 `const`，**无变量遮蔽**（函数内 `settled` / `stepStatus` 各仅一处声明，全局 grep 确认）；
- 移动**跳过**了 `if (n.data.usage === null || typeof n.data.usage !== 'object') return` —— 该 early return 是**唯一**的提前退出点，无 `try` 包裹、无副作用，声明上移完全等价；
- 早退**之后**对 `settled` 的那几处使用（decode 累计）行为未变：`completed >= firstToken` 的三条子条件独立，与声明位置无关；
- 实测：decode 分支的所有既有断言与 tps 数值逐位未变（原 110/100/42.5 兜底等断言全部照常通过）。

---

## 3. B. P2-2 是否真与官方同源 —— **是，三项条款逐条实测**

官方原文（CHAT:6873-6890 / 6923-6949，逐字核对）：

```js
function usageOutputTokens(usage) {
  if (typeof usage !== "object" || usage === null) return null;
  const value = usage.outputTokens;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function assistantStepReading(node) {
  const timing = node.timing;
  return {
    ttftMs:  timing !== void 0 && timing.stepStartTime !== null && timing.firstTokenTime !== null
             ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
    decodeMs: timing !== void 0 && timing.firstTokenTime !== null
             ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
    outputTokens: usageOutputTokens(node.usage)
  };
}
// deriveStats：if (reading.decodeMs !== null && reading.outputTokens !== null) { decodeMs += ...; decodeTokens += ...; }
```

| # | 条款 | 夹具 | 期望 | 插件实测 | 判定 |
|---|---|---|---|---|---|
| i | **0 毫秒步计入**（`completed === firstToken` ⇒ decodeMs=0，分子照计） | z0（999tok，decode 0ms）+ z1（100tok，1s） | (999+100)/1.0s = **1099** | **1099** | ✅ 与官方同源（首版为 100） |
| ii | `firstTokenTime === null` ⇒ 该步**不**计入 | a（500tok，first=null）+ b（100tok，2s） | 100/2s = **50**? → 官方只计 b：100/2s = **50** | **50** | ✅ |
| iii | `outputTokens` 缺失 ⇒ 该步**不**计入 | a（无 outputTokens，1s）+ b（100tok，2s） | 100/2s = **50** | **50** | ✅ |
| iii-b | `outputTokens` 为负（非法）⇒ 不计入 | a（-5tok，1s）+ b（100tok，2s） | **50** | **50** | ✅（与官方 `value >= 0` 一致） |

**与官方守卫的同构性**：官方 `decodeMs > 0 ? decodeTokens/(decodeMs/1e3) : null`（CHAT:7004 / 7058 / 7139）↔ 插件 `acc.liveDecodeMs > 0 ? …: undefined`（turn-metrics.ts:448）。**逐字同构**，含「仅一个零时长步时不显示」（实测 `undefined`✅）。`completed >= firstToken` 的钳零与官方 `Math.max(0, …)` 在 `completedTime >= firstTokenTime` 生产不变量下逐位一致。

> 一处口径陈述需修正（非数值缺陷）：新注释（turn-metrics.ts:366-371）写「除零由下游既有守卫承担」。准确说法是——**整个比值的守卫**由下游 `liveDecodeMs > 0` 承担（官方亦然）；若单看「`completed - firstToken` 是否为 0」这一项，官方确实**没有**针对性守卫，是钳零而非排除。当前表述不会导致误改（未声称官方有该守卫），仅不够精确。

---

## 4. C. P3-1 的覆盖是否真的有效 —— **有效，变异已被杀死**

变异体（用 Node 逐字节改写，跑 `test/metrics-unit.test.mjs`，结束后还原）：

| # | 变异体 | 结果 | 失败断言 |
|---|---|---|---|
| M2a | `turnAcc.liveTtftMs += g.liveTtftMs` → `+= 0`（**首轮存活**） | **KILLED** ✅ | `P3-1 多分组整回合 ttft = 各段合并后平均…` (0) |
| M2b | `turnAcc.liveTtftSteps += g.liveTtftSteps` → `+= 0` | **KILLED** ✅ | 同上 |
| M2c | 删掉两行合并（完全不合并） | **KILLED** ✅ | 同上 |
| Mclamp | `Math.max(0, firstToken - stepStartForTtft)` → 原差值 | **KILLED** ✅ | `钳零…平均 = (0+400)/2 = 200` (-50) |
| Mnull | 去掉 `firstToken !== undefined` 校验 | **KILLED** ✅ | `ttft：firstTokenTime=null 的步不计入…` (null) |
| Mstart | 去掉 `stepStartTime` 数值校验 | **KILLED** ✅ | `首 token 时延：无 stepStartTime 时回退 billed 500…` (null) |
| Mavg | ttft 不取平均（用累加值） | **KILLED** ✅ | 4 条 |
| Msteps | `liveTtftSteps += 1` → `+= 0` | **KILLED** ✅ | 5 条 |
| MP2-2reg | `completed >= firstToken` → `completed > firstToken`（还原首版） | **KILLED** ✅ | `零时长步与官方同源…1099` (100) |
| MP2-1exact | 把 ttft 重新门控在 `usage` 存在之上（**精确等价首版「ttft 在 usage 早退之后」**） | **KILLED** ✅ | `P2-1 无 usage 的 settled 步也计入 ttft…` (100) |
| MtpsBilled | tps 兜底反转（billed 恒优先） | **KILLED** ✅ | 3 条 |
| Mnofallback | 删除 ttft 的 billed 兜底 | **KILLED** ✅ | 1 条 |
| Msettled | 去掉 ttft 的 settled 门控 | **SURVIVED** ⚠️ | 无（见 P3-B） |
| Mbilled | ttft 兜底反转（billed 恒优先） | SURVIVED-**NOOP** | 无（定向探针确认**行为未变**，即该行删除与插入等价 ⇒ 非真存活） |

**结论**：首轮存活的 M2a 现已杀死，新增三条覆盖（多分组 ttft 合并 / 钳零 / 无 usage 步）**各自都有鉴别力**，且三条断言分别对应本轮三个修复点，**不是为通过而放宽的空断言**。

---

## 5. D/E/F/G 逐项

### D. 声明上移副作用 —— **无**（见 §2.3）

### E. 通读 turn-metrics.ts 全部 tps/ttft/usage 注释：**发现 1 处新的、方向性错误的注释（P2-A）**

| 位置 | 注释原文 | 与代码/官方对照 | 判定 |
|---|---|---|---|
| :295-297 | 「与 tokenUsage 只统计**成功完成**调用的 input/output 口径对齐……**不再**按 attempt 求和」 | `deriveTurnTokenUsage` **确实**跨 attempt 求和（实测：1 次失败+1 次成功 ⇒ `uncachedInputTokens=1000/outputTokens=82` = 两次之和；2+1 ⇒ 1300/112；无重试 ⇒ 900/77 单次） | ❌ **错**（新引入） |
| :13-14 | 「tokenUsage（uncachedInputTokens 等，**含重试**的全回合聚合）」 | 与官方一致 | ✅ 对（但与本轮 P4-1 新注释互相矛盾） |
| :430-447 | 自算无条件优先；billed 仅兜底；口径澄清段 | 与代码（:448-458）逐条一致；与测试（`withTail===100`）一致 | ✅ 三方一致（P3-3 已修好） |
| :331-335 | 「必须在 ttft 累计之前声明」 | 与代码顺序一致 | ✅ |
| :338-344 | 「usage 缺失的 settled 步仍应贡献 ttft」 | 与代码一致 | ✅ |
| :366-371 | P2-2 钳零说明 | 与官方逐条一致（仅 §3 末注的措辞可更精确） | ✅ |
| :596-601 | turnAcc ttft 合并说明 | 与代码一致 | ✅ |
| :263-266 | liveTtftMs/Steps 字段注释（官方逐 step 累加取平均） | 与官方 `deriveStats` + `stats.dialog.ttft`（`ttftMs/ttftSteps`，CHAT:7057）一致 | ✅ |
| :452-457 | 「官方是逐 step 累加后取平均」 | 与官方一致 | ✅ |
| :443-447 | 权威源是 sessionStats 事件投影 | 与 `dsh-session-stats/lib/index.js:107-126` 一致（且能经 `assistantStreamFirstTokenTime(event.data.stream)` 捞回首 token 时间） | ✅ |
| :539-541 | 「rc.1 首 token 时延权威字段」 | rc.2 `tailData()` 确无 `ttftMs`/`tokensPerSecond`（10428-10435 全文核对）；且全 DSH 包内**无任何代码写入 `ttftMs`** ⇒ 该兜底在 rc.2 上为死路径，保留作为 rc.1 兼容合理 | ✅ |
| :43 | `timeToFirstToken` 字段注释「来自 turn-tail.data.ttftMs，rc.1 权威字段」 | **已过时**：现自算优先，billed 仅兜底 | ⚠️ P4 级 |

### F. 回归（实际运行，非推断）

| 项目 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `node test/run-all.mjs` | **32 个测试文件全部通过**（exit 0） |
| 类型检查 | `npm run typecheck` | **exit 0**，无输出 |
| 构建 + 四守卫 | `node build.mjs` | host/client d.ts 导出面 ok、`node --check` ×2 ok |
| 产物一致性 | 复算 SHA256 | `lib/client.js` = `1CEAA133…`、`lib/index.js` = `D385D568…`，与审查开始时**逐字节相同**（`build.mjs` 输出确定、无时间戳） |

### G. 其他不宜合入的问题

**（已撤销）原 P2-B「新增测试文件缺末尾换行」不成立** —— 经复核，`HEAD:test/metrics-unit.test.mjs` **同样**无末尾 LF（两边都为 `process.exitCode = failures === 0 ? 0 : 1` 且无换行；`git diff` 的 `\ No newline at end of file` 只是上下文行标记）。该现象**先于本轮存在**，非本轮引入，不计入本轮缺陷。

**P3-A — read-only（read-only）`billed` 死路径与注释不符**
`billed.tokensPerSecond`（:451）在 rc.2 上恒 `undefined`（`tailData()` 无该字段），属 rc.1 兼容死代码；`billed.timeToFirstToken`（:458）**在任何 DSH 版本上都不可能被赋值**（`n.data.ttftMs` 无写入方，全包 grep 确认）。二者无害，但注释称其为「rc.1 权威字段」，建议在注释里写明「当前版本已无生产方，纯兼容位」。

**P3-B — turnAcc 的 ttft 合并测试门控未被覆盖**
变异 `Msettled`（去掉 ttft 的 settled 门控）**存活**：现有夹具中「带 `stepStartTime` 的 settled 步」在 `status` 缺失时**不**进入最终节点（`finalNode === undefined` 被 :312 早退拦截），因此 :345 的 `settled &&` 是**多余门控**——删掉它，全部 32 个测试仍绿，且**任意形状合法的夹具下行为也不变**。
**但这不代表可删**：官方对节点的 settled 性判定发生在**上游**（`legacyContribution` 对 `status==='running'` 的 step 返回空 nodes 列表，running 节点**根本不进**折叠窗口）；插件直接读 `n.data`，若宿主某版本改为「running 也带 finalNode」，该门控就是唯一防线。**建议保留**（它是安全网），如需覆盖可补一条「running + finalNode 的夹具 ⇒ ttft undefined」的断言（约 5 行）。

**P3-C — 旧 `ttftMs` 兜底只归属首分组**
:636 `timeToFirstToken: index === 0 ? turnTailTtft : undefined`。若首分组**没有**自算值、而后分组有，则首分组会取 billed（首个 attempt 的值）——在 rc.2 上 billed 恒 undefined 故不可达，仅属理论边角。**不影响合入**。

---

## 6. 硬性约束遵守与恢复自查

- 未启动任何次级 subagent；未调用 memory / skill_manage；未执行任何 git 写操作（全程只读 `git status/diff/numstat`）。
- **临时改源码做变异实验 14 次**（分 4 批：mutate.mjs / mutate2.mjs / mutate3.mjs / mutate4.mjs），全部用 **Node 逐字节改写 + 逐字节还原**（不用 PowerShell 文本往返，避免编码损坏）：
  - 实验前备份 → 每批结束校验 `src/turn-metrics.ts` SHA256 = `B02C3E3415E19A3958416D09B82172658DCCFCA76ACEE08410EB7D324921A887`，**与备份逐字节一致**（4 批全部 BYTE-IDENTICAL）；
  - `git diff --numstat -- src/turn-metrics.ts` 恒为 **79 insertions / 19 deletions**（与审查开始时相同）；
  - 已重新 `node build.mjs`，`lib/client.js` / `lib/index.js` SHA256 与审查前**逐字节相同**；
  - 还原后重跑 `node test/run-all.mjs` = **32/32 全绿**、`npm run typecheck` exit 0、`node build.mjs` 四守卫全过。
- 探针全部写在 `%TEMP%\dshcf-review2`；仓库内**仅新增本文件**（`review/review-issue1-round2.md`），未新增/删除其他仓库文件。
- 未提交、未推送。

---

## 7. 缺陷清单（按严重度）

| 级别 | 编号 | 问题 | 影响 | 建议 |
|---|---|---|---|---|
| **P2** | P2-A | **P4-1 修复方向搞反**：turn-metrics.ts:295-297 新注释称 `deriveTurnTokenUsage`「不再按 attempt 求和」，实测**恰恰相反**——官方对该 retry 链**求和**（1 次失败+1 次成功 ⇒ input 1000/output 82 = 两次之和）。文件头 :13-14 的「含重试的全回合聚合」才是对的，两处注释现互相矛盾 | **仅注释/文档**，不进入任何计算路径（tps/ttft 不读 tokenUsage） | 改回：「tokenUsage 是**跨 attempt 求和**的回合级总量（`aggregateAttempts` 累加各 attempt）；任一 attempt 缺桶时该桶整体 undefined」 |
| ~~P2~~ | ~~P2-B~~ | ~~测试文件无末尾换行~~ —— **已撤销**：HEAD 版本同样无 LF，属既有状态、非本轮引入 | — | 可选清理（与问题① 无关） |
| **P3** | P3-A | `billed.ttftMs` 兜底在当前 DSH 版本**无任何生产方**（全包 grep 无写入 `ttftMs` 的代码），注释仍称「rc.1 权威字段」 | 死路径 + 注释误导 | 注释写明兼容位性质 |
| **P3** | P3-B | turnAcc ttft 的 `settled` 门控无测试覆盖（变异 Msettled 存活）；该门控在当前形状下为**多余但应保留的安全网** | 测试盲区 | 补一条「running + finalNode ⇒ ttft undefined」断言（~5 行） |
| **P4** | P3-C | 旧 `ttftMs` 兜底只归属首分组（:636） | rc.2 不可达 | 低优先，可在注释注明 |
| **P4** | — | `TurnMetricsData.timeToFirstToken` 字段注释（:43）仍写「来自 turn-tail.data.ttftMs，rc.1 权威字段」 | 与自算优先的实现不符 | 更新为「自算逐 step 平均优先，billed 仅兜底」 |
| **P4** | — | `behavior-spec.md:157/159`、`bench/_old-turn-metrics.mjs.ts.txt`、`test/metrics-unit.test.mjs:169/220` 仍写「tokenUsage 跨 attempt 求和」 | 这些其实是**对的**；但 :169/:220 的注释与 P2-A 的改动方向相反，需一并对齐口径 | 与 P2-A 同批修正 |

---

## 8. 合入建议

**批准合入。** 本轮四项修复经独立验证全部生效，无阻断缺陷：

| 项 | 判定 | 证据 |
|---|---|---|
| P2-1 ttft 移到 usage 早退之前 | ✅ **真修好** | 无 usage 步 ttft=250（首轮 100）；「唯一步无 usage」整块从 undefined 恢复到 250 |
| P2-1 未引入「非 settled 计入」 | ✅ **无新问题** | running/aborted/无 status 六档实测全部 undefined |
| P2-2 `>=` 与官方同源 | ✅ **真同源** | 0ms 计入（1099）/ null 不计入（50）/ 缺 outputTokens 不计入（50）/ 负值不计入（50） |
| P3-3 注释矛盾 | ✅ **已修** | 注释/代码/测试（withTail===100）三方一致 |
| P3-1 覆盖 | ✅ **有效** | 变异 `+= 0` 与「删两行」均 KILLED |
| P4-1 注释 | ❌ **改反了** | 见 P2-A；不影响数值（唯一合入前应修项） |

合入前建议（按优先级）：
1. **P2-A**：把 :295-297 改回「跨 attempt 求和」（**唯一方向性错误**，虽不影响运行值但会误导后人删掉正确的文件头注释）。
2. **P3-A / P3-B / P4**：注释口径统一 + 补 1 条 running 门控断言。

> 说明：本报告只复核「问题①（tps/ttft 自算）」。工作区同时含 `src/fold.ts` 265 行大改（问题②/⑤），**不在本轮范围**，仍建议单独走一轮审查。
