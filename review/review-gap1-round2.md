# P3 缺口① 修复·第二轮复审（全量改动集）

- 审查对象（未提交的工作区改动，全量而非增量）：`src/fold.ts`、`test/fold-retry.test.mjs`、`lib/client.js`（build 产物）
- 审查基线（审查开始 == 审查结束，逐字节一致）：
  - `src/fold.ts` = `DE60AFFF9293B0E85C9992CFDB79E424007343173405C3C755B212ED42A940F5`
  - `lib/client.js` = `AA68646F49B23540740ABCDBAB3AFA5289E54A36E6C363C94F54EEF677ECFDEF`
  - `test/fold-retry.test.mjs` = `1BFD06E56E06AB64B6D51F09B62366974161FB2ADC7AD8B0AA96B667CC798E56`
- 方法：源码逐行推演 + 用 `test/fake-dom.mjs` 驱动真实 bundle 的**插桩探针**（在 bundle 文本上注入 pass 相位标记 / `hideElement`/`restoreElement` 调用栈 / 逐元素 `style.display` 写代理），探针脚本写在 `%TEMP%\dsh-review-gap1-r2\`，**未写入仓库**；另做回滚鉴别力实验与全量回归。
- 约束遵守：未启动次级 subagent，未调用 memory/skill_manage，未 git commit/push/checkout/reset；所有回滚实验结束后已用备份还原并重跑 `node build.mjs`，三文件 SHA256 与开始时一致，`git status --porcelain` 仍只有这三个已改动文件。

---

## 0. 结论摘要

| 项 | 判定 |
|---|---|
| F-1/F-B（同 pass 对冲） | **未修好（新缺陷 R2-1，功能级）** |
| F-A（restoreUnusedDisplays 位置） | **已修好**，新位置正确；实测旧位置每 pass 双写、新位置零写 |
| F-3（行号 + 删过程性文字） | **半修**：删「早期草稿」已完成；新行号 4106/4131/4167 **三个全错**（R2-2） |
| F-5（用例加座位 + 两条新断言） | **已修好**，前置断言有效、方向互补；但对 F-1 **无鉴别力** |
| F-6（makeGroup 桩语义） | 已改，但**形似而神不同**（R2-3，当前无行为差异） |
| D 全量回归 | **32/32 全绿**（exit 0） |

**批准状态：不批准直接合入。** 只需一处功能性改动（R2-1 一行）+ 一处注释行号纠正（R2-2）即可放行；R2-3/R2-4 为可选质量项。

---

## 1. 逐条独立验证

### 1.1 F-1/F-B：**未修好** —— 新缺陷 R2-1

新增守卫：

```ts
const liveStatusOwned = segmentChipState === undefined && !nativeManaged.has(segment.key)
if (!chipOwnsStatus && !liveStatusOwned) { /* 段级中间循环：对 statusRows 无条件 restore */ }
```

**关键事实（源码推演 + 探针实测一致）**：`nativeManaged`（fold.ts:1040-1049）只要求 `segmentMetricsKeys(segment).turn ∈ nativeTurns`，**不含任何"已闭合"条件**；而 `nativeTurns` 由 DOM 上存在的 `button[data-turn-process]` 收集（fold.ts:1029-1039）。官方把 `data-chat-turn` 写在**每个 flow 节点**上（已核对真机 bundle `dsh-client-ui-chat/lib/client.js:1757-1766`：`div.flowItem` 同时带 `data-chat-anchor-key / data-chat-flow-kind / data-chat-turn`），而 `segmentMetricsKeys` 的候选含 boundary / finalStep / block.host / block.rows / middleSteps——因此**只要本回合已有 turn-process 行，运行中段几乎必然被判定为 nativeManaged**。

于是 `liveStatusOwned` 在**整个直播段**恒为 false，F-1 要消除的对冲原样保留。

探针实测（守卫输入）：

```
[guard] seg=segment:user:u1 rows=2 hasState=false nativeManaged=true liveOwned=false chipOwns=false collapse=false
```

写序实测（在 bundle 上记录 `hideElement`/`restoreElement` 调用栈 + display 写代理，直播稳态）：

```
phase: 中间循环前
  restoreElement(r1) 栈: FoldController.restoreElement <= FoldController.pass <anonymous>:2113   ← 段级中间循环的 else 分支
phase: convergeLiveStatusRows
  hideElement(r1)    栈: FoldController.hideElement <= FoldController.convergeLiveStatusRows <anonymous>:2514 <= pass:2143
  r1.style.display <- ""
  r1.style.display <- "none"
```

即**每 pass 一次 `none → "" → none` 往返双写**，与第一轮 F-1 报告的现象完全相同（该探针同时记录到一次 pass 内 `hidden` 与 `restore` 两个相反意图）。真实危害不变：在途收起动画会被 `restoreElement` 的 `cancelPendingSync`（fold.ts:2933）截断——正是 1274-1291 注释点名要避免的情况。

**最小修法（本审查已实测）**：把合取项换成同族的 **passive** 判据即可——`liveStatusOwned = segmentChipState === undefined && !nativePassiveSegments.has(segment.key)`。三种候选实测对比：

| 变量 | 直播期（nativeManaged 夹具）每 pass display 写 | 全量回归 |
|---|---|---|
| 现状 `!nativeManaged` | **2 次**（`""`→`none`，双写） | 32/32 |
| `!nativePassiveSegments`（建议） | **0 次** | 32/32 |
| 去掉合取项、仅 `segmentChipState === undefined` | **0 次** | 32/32 |

`nativePassiveSegments` 分支已在 1338 行 `continue`、1350 行 `driveGroups` 也已跳过它，因此该分支内不再需要"交给收敛"的语义；而 live 段（passive 排除后）无论是否 nativeManaged 都由收敛独占处置，与"单一来源"目标一致。**两种修法全量回归均 32/32 全绿**，没有测试能区分它们（见 1.4）。

### 1.2 F-A：**已修好**，新位置正确

A/B 实测（同一夹具、同一 bundle，仅改调用点位置；逐个元素 `style.display` 写代理，闭合段 chip=1）：

| 位置 | 闭合段稳态每 pass display 写 |
|---|---|
| **新位置（1414，chip 循环之后）** | **0 次**（终态 r1=r2=r3=`none`） |
| 旧位置（chip 循环之前） | **6 次/pass**：`r1/r2/r3 ← ""` 各一次，随后 `r1/r2/r3 ← "none"` 各一次 |

旧位置逐字复现了 1410-1413 注释描述的「恢复→再隐藏」往返双写；新位置归零。**移动方向正确，目的达成。**

完整影响面见第 2 节——结论是**没有任何登记因移动而被漏恢复**。

### 1.3 F-3：**行号仍未修对**（R2-2）

工作区实际行内容（`node` 逐行读取）：

| 引用 | 指向的实际内容 | 应为 |
|---|---|---|
| `fold.ts:4106` | `* 通常为空串——插件要防的是**后者被写脏**。`（isNativeProtected 的文档注释） | **4122** `const items = flowItems(flow)` |
| `fold.ts:4131` | `let turn = 0` | **4147** `const range = items.slice(contentStart, end)` |
| `fold.ts:4167` | `return hasBody(el)` | **4183** `const statusRows = range.filter(el => isStatusRow(el) && !inBlockStatus.has(el))` |

也就是说：本轮把第一轮的「4121/4061 不存在」换成了「4106/4131/4167 存在但不是所指」——**缺陷形态从"悬空引用"变成了"指错引用"，可复核性更差**。更严重的是 139,1793 行「**4167 的定义域是块内补集**」——4167 是 `return hasBody(el)`，该论断所依赖的真值是 4182-4183（`inBlockStatus` / `statusRows = range.filter(...)`），引用错误使得这条论证无法被复核。

已完成的正确项：`早期草稿` 过程性文字已删除 ✓；`range.filter（4121）` 这个错误引用已消失 ✓；`fold.ts:4106/4131/4167` 改写为三段式（4106 曾被第一轮判定为正确）但落点全错。

**同批新增注释里的其余工作区行号同样已漂移**（它们在 2592612 写出时正确，其后 src/fold.ts 又被改动 +73/−11，全部后移）：

| 注释中的引用 | 现指向 | 应为 |
|---|---|---|
| `shouldChip（上方 1349）` | 注释「单组段永远停在收起态…」 | **1341** `const shouldChip = covered.length > 0` |
| `P3（下方 1382）` | P3 根因描述注释行 | **1395** P3 的 `for (const status of segment.statusRows)` |
| `见 1377-1378`（P3 安全前提） | P3 症状描述 | **1390-1391** 真正的安全前提（「不带原生 hidden、不属于 [data-step-process]*」） |
| `fold.ts:1130-1131` | ✅ 正确（`!closed && !terminated continue` / `running \|\| !hasWork continue`） | — |

**建议**：行号引用在本仓库已达失效频率（首审 F-3 + 本轮 + 同批 4 处），继续用绝对行号只会持续产生此类缺陷。建议改为**语句锚点**（如 `buildSegments 的 const statusRows = range.filter(...)`），或至少同时给出语句片段。

### 1.4 F-5：**已修好**，且鉴别力已实测

- **前置断言有效**：新夹具已含 `turn-process` 座位，实测 `chip=1`（对照：无座位时 `chip=0`），因此末段 P3 断言不再是「一级折叠冒充 P3」的假绿。
- **回滚鉴别力实验**（真实改 `src/fold.ts` → `node build.mjs` → `node test/fold-retry.test.mjs`）：

| 回滚目标 | 结果 |
|---|---|
| **缺口① 分支**（把 `convergeLiveStatusRows(...)` 从 `state === undefined` 分支删掉，还原为 `continue`） | **4 条 FAIL**：第 1/2 条重试行未被收敛隐藏、原最新一条不让位、更早的不回流 ⇒ 用例对缺口① 有真实鉴别力 ✓ |
| **F-1**（把 `if (!chipOwnsStatus && !liveStatusOwned)` 还原为 `if (!chipOwnsStatus)`） | **[ALL PASS]** ⇒ 用例**测不到 F-1**（与 R2-1 互证：F-1 修复在此夹具下根本不生效） |
- **回滚 F-A 位置** | `node test/run-all.mjs` 仍 **32/32 全绿** ⇒ F-A 的位置移动**无任何测试覆盖**（行为正确但缺回归网）。
- 新增两条断言（chip 展开后收敛行必须恢复可见 / 再次收起幂等）**方向正确且实测成立**：展开后 r1-r4 全 `""`、再收起回 `none`，补齐了首审判定的「只覆盖隐藏方向」缺口 ✓。

### 1.5 F-6：已改，但**形似而神不同**（R2-3）

新桩在 `click` 处理器**末尾**派发 `beforematch`；`fold-017-safety` 的 `bindOfficialReveal`（fold-017-safety.test.mjs:153-166）则是**两个独立监听器、互不触发**。探针实测（构造同语义桩、模拟 driveGroupOnce 的**收起方向** click）：

```
fold-017 语义：收起 click 后 aria=false，beforematch 触发次数=0  ⇒ 收起保持
fold-retry 新桩：收起 click 后 aria=true，beforematch 触发次数=1  ⇒ 收起被 reveal 反向撤销（顺序相关）
```

**当前无行为差异**，原因是巧合：库层 `syncProcessedRow`/`syncNativeDisclosure` 用真 DOM `setAttribute('aria-expanded','false')` 改属性而不触发内联监听器，随后到达的 `beforematch` 又把桩的 `aria` 写回 `true`，最终值恰好与 fold-017 一致。但一旦该文件新增「驱动收起」类断言（正是 F-5 建议的方向），新桩会**静默地把收起撤销掉**。建议：click 只翻转（同 fold-017），需要 `beforematch` 的用例显式 `body.dispatchEvent(new Event('beforematch'))`。

---

## 2. A. F-A 位置移动的完整影响（重点项）

### 2.1 全部 `desiredHidden` 登记点及其相对位置

```ts
1245  const desiredHidden = new Set()          // 每 pass 新建
1247-1259 ① for(blocks) reconcileBlock(...)   // 登记：2291-2294（levelCollapsed 隐藏侧）
                                             //       2416/2424/2436（二级 chip 收起侧）
                                             //       2439 syncMergedThink → 2654
1261-1304 ② 段级一级循环  middleSteps 1268 / statusRows 1295（1297 登记）
1267-1270 ③ segment.middleSteps（1268 登记）
1306-1324 ④ "无可见工作"清理循环（1320 suppressBlock / 1321-1323 retainDisplayControl 登记）
──────────────── 旧位置：restoreUnusedDisplays（HEAD 1302） ────────────────
1336-1399 ⑤ 段级 chip 循环（1360 convergeLiveStatusRows 登记；1397 P3 登记）
──────────────── 新位置：restoreUnusedDisplays（工作区 1414） ────────────────
1417-1423 ⑥ 段消失 chip 清理  1425-1440 runningSince/动画清理  1441-1446 turn-status
```

### 2.2 逐项判定：有没有登记「晚于」清理而被漏恢复

| 登记点 | 旧位置时 | 新位置时 | 结论 |
|---|---|---|---|
| ① reconcileBlock（1258 调用） | 早于 | 早于 | 两者都在其后，**无变化** |
| ② 段级一级循环（1268 middleSteps / 1297 statusRows） | 晚于 | **早于** | 唯一受影响面，见 2.3 |
| ④ 清理循环 retainDisplayControl（1320-1323） | 晚于 | **早于** | 见 2.4（不构成缺陷） |
| ⑤ chip 循环（1360 收敛 / 1397 P3） | 晚于 | 早于 | **正是本次归位的目的**：登记对本 pass 生效，双写归零（1.2 实测） |

**没有任何元素"本应被恢复、却因登记顺序变化而保留在 display:none"。** 全部登记点中，唯一从"晚于"变为"早于"的是 ②④，逐项论证如下。

### 2.3 受影响面 ②：段级状态行（collapse=true 的段）

新位置下，若某段在 1258 被登记隐藏（`collapse=true` ⇒ 1297 `hideElement(status, desiredHidden)`）而在 1336-1399 未再登记，则该登记对本 pass 的收尾清理不可见——该元素本 pass 确实被隐藏了（`el.style.display='none'` 已写、`controlledDisplay` 已加），**显示结果正确**；不清账的唯一后果是"未写回 original"，而这本就不是收尾清理的职责。逐分支核对：

- **正常闭合段**（`state !== undefined`）：`state.expanded=false` ⇒ `collapse=true`。chip 循环两条路径都会 re-register：
  - `covered.length > 0`：1367 `ensureSegmentChip` → 1397 `hideElement(status, desiredHidden, …)` ⇒ 已登记；
  - `covered.length === 0`（单组段）：1363 `!shouldChip` → 1364 `dropSegmentChip(state)` + `continue` ⇒ 未 re-register。但 1368 之前的 1350 `driveGroups([partition.last], true)` 与 1363 的 `dropSegmentChip` 都不恢复这些行，1441-1446 也不碰它们 ⇒ **无"恢复"动作**，不存在漏恢复。该段唯一的出口是**下个 pass 的一级展开**（那时 `collapse=false`，1295 分支走 `restoreElement`）——与旧位置行为完全相同。
  - `ensureSegmentChip` 返回 null（1368）：无恢复动作，同上。
- **passive 段**（`nativePassiveSegments`）：`collapse = state !== undefined && !state.expanded && !nativeManaged`；passive 段基本落在 nativeManaged 内 ⇒ `collapse=false` ⇒ 1295 分支走 `restoreElement`（不登记），且 1305 的 `reconcileBlock` 早已跳过（nativeCollapsed/nativePassive 分支全量 restore）⇒ 无隐藏、无漏恢复。
- **无 state 的直播段**：`collapse=false` ⇒ 走 restore，不登记。

⇒ ② **无漏恢复**。

### 2.4 受影响面 ④：清理循环（1320-1323）

该循环只在"段**无可见工作**"时触发（1313-1314 两道 continue 之前）。若走到这里，`retainDisplayControl` 只对**已在 controlledDisplay**（即插件已隐藏）的元素登记；块/段有可见工作时该循环根本不执行。理论上存在"React 重挂导致元素可见但账本仍有残留"的极小窗口：旧位置会把它恢复，新位置保留 `display:none`。但该窗口需要"整段工作全不可见 + 某行被 React 重挂为可见"两个条件同时成立，而此时隐藏本就是期望态 ⇒ **不构成缺陷**。

### 2.5 与紧随其后的清理顺序

新位置（1414）之后依次是：段消失 chip 清理（1417-1423）→ `runningSince/liveTurnStarts/completedOnce/turnStatusTexts/pendingAnims` 清理（1425-1440）→ turn-status 文本替换（1441-1446）。这些**都不写 display**（`dropSegmentChip` 只 `chip.remove()` + 清 `groupsExpanded`；`pendingAnims` 清理只删断连条目），因此 `restoreUnusedDisplays` 的最终意图不会被后续步骤推翻。**顺序合理。**

唯一值得记录的耦合：若将来把 `restoreUnusedDisplays` 移到 1446 之后，仍等价；但**不要**放回 1306-1324 之前（即旧位置），否则 ⑤ 的登记再次对本 pass 不可见。

---

## 3. B. liveStatusOwned 的遗漏风险（三种情况逐一给代码路径）

(i) **未闭合但 terminated（异常终止）**：state **已建出**。fold.ts:1130 `if (!snapshot.closed && !snapshot.terminated) continue` ⇒ `terminated=true` 通过；1131 `if (snapshot.running || !snapshot.hasWork) continue` ⇒ 无 running 行且有工作通过 ⇒ 1134-1140 建 state。于是 `segmentChipState !== undefined` ⇒ `liveStatusOwned=false`，由 **1295 中间循环**接管（`collapse = !state.expanded && !nativeManaged`）。**这是正确语义**（该段走"闭合"折叠路径，不该由直播收敛处置）。实测（turn-error、无 turn-tail）：`processedRow=1, chip=0, r1="none", e1="none"`，无卡死、无遗漏。✅

(ii) **nativeManaged 但未闭合**：**R2-1 的命中口**。`segmentChipState === undefined` 为真，但 `!nativeManaged.has(...)` 为假 ⇒ `liveStatusOwned=false` ⇒ 中间循环 `collapse=false` ⇒ 对全部 `statusRows` 无条件 `restoreElement`；随后 1360 `convergeLiveStatusRows` 又 `hideElement` 非末条。**同一 pass 内两个相反意图**，单一来源被破坏（1.1 实测栈与写序）。❌

(iii) **段闭合当 pass（state 刚建出）**：该 pass 内 `segmentChipState` 已非 undefined ⇒ `liveStatusOwned=false`、`convergeLiveStatusRows` 不再调用；处置权立即由 1295 中间循环 + 1395-1398 P3 段级循环接管。此时 `chipOwnsStatus` 在 chip 建出后为真（`state.chip !== null && !state.groupsExpanded`）⇒ 中间循环被抑制 ⇒ 只有 P3 写 hide，**无双写、无交接真空**。也没有"待办"状态残留（`convergeLiveStatusRows` 是无状态纯函数）。✅

---

## 4. C. 直播段被收敛的行在段闭合瞬间是否可见翻转

分两类：

1. **chip 可建出**（`segmentChipHost` 命中，即本用例夹具）：收敛 pass 终态 = 非末条 `none` / 末条 `""`；闭合 pass 终态 = 全 `none`。末条 `"" → none` = 唯一真实翻转，**语义正确**（收进折叠），且方向单调、不回流。✅
2. **chip 建不出**（`covered.length > 0` 但 `segmentChipHost` 返回 null，例如无 `turn-process` 座位且组前无 turn-process seat）：1368 `if (chip === null) continue` 会**跳过 1395-1398 的 hide**，而 1295 分支（`chipOwnsStatus` 此时为 false，因 `state.chip === null`）已把末条 `restoreElement` 回可见 ⇒ **直播期收敛在闭合瞬间被整体撤销**，末条重新露出，其余保持隐藏。终态不卡死，但存在"末条先被收敛隐藏、再恢复可见"的一次翻转（跨 pass）。

此外，即使不发生上述撤销，**每 pass 仍有一次 `""→none` 的往返**（R2-1）：两次意图写在同一个同步 pass 内，中间无渲染帧 ⇒ **肉眼观测不到**（与第一轮判定一致），但它是 F-1 注释明确要消除的往返双写，且会经 `cancelPendingSync` 截断在途收起动画（真实危害，非纯计数问题）。

---

## 5. D. 全量回归

```
node test/run-all.mjs   →   [run-all] 32 个测试文件全部通过   (exit 0)
```

- 在工作区当前基线（三文件哈希见文首）上实跑，**32/32 全绿**。
- 回滚实验期间亦各跑一次全量：回滚 F-A 位置 → 仍 32/32 全绿（说明该移动无测试覆盖）；最小修法变体 → 仍 32/32 全绿。
- 结束后已还原并重建，`git status --porcelain` 只有 `lib/client.js` / `src/fold.ts` / `test/fold-retry.test.mjs` 三个已修改文件，未新增/删除仓库文件（`review/`、`ISSUE_ROOTCAUSE_2026_09_30.md` 为原本就存在的未跟踪项）。

---

## 6. E. 遗留问题

- **F-2【低·策略，未解决】**：收敛保留"DOM 最后一条"，不区分 kind。同一段末条是 `model-retry` 时，更早的 `turn-error`（终态失败）/ `turn-max-tokens`（输出上限）会被隐藏。任务书的修复方向 2 特意要求"错误场景保留末条以免遮住唯一错误线索"，直播段同类考虑仍未体现。属策略决策，可在真机确认后调整（如"至少保留最后一条终态行"）。
- **F-4【中·需真机验证，未解决】**：缺口① 的可观测收益窗口 ≈「回合行被展开（alwaysOpen / 用户点开）+ 节点未重挂」——因为官方收起态由 `processHidden + useSearchableHidden`（`hidden="until-found"`）自行藏掉重试行，插件对块外状态行写的是 `style.display`，而节点重挂会重置插件隐藏、收敛必须逐帧重做。**在真机确认前不建议把缺口① 标成"已修完"。** 本审查未做真机验证（超出本会话范围）。
- **新增观察（非本批范围）**：缺口② —— `nativePassiveSegments` 段在 1338 `continue`，完全无收敛。实测（`turn-process` aria-expanded=true 且 disabled，即 verbose/aborted/插话回合）`r1=r2=r3=""`，重试行全裸露。这符合 §5.10「插件完全不介入」的设计，但按 `ISSUE_ROOTCAUSE` 问题② 的缺口清单，它仍是用户症状窗口之一，建议下一批处理。

---

## 7. 缺陷清单（按严重度）

### R2-1【高·功能】F-1 未修复：`liveStatusOwned` 用了过宽的 `nativeManaged` 判据

- 位置：`src/fold.ts:1294`。
- 现象：`nativeManaged` 只表示"本回合有官方 turn-process 行"，不含"已闭合"；官方在每个 flow 节点写 `data-chat-turn`（真机 bundle 1757-1766），而 `segmentMetricsKeys` 的候选含 boundary/finalStep/block.host/block.rows ⇒ **运行中段普遍被判为 nativeManaged** ⇒ `liveStatusOwned` 恒 false ⇒ 守卫整体失效 ⇒ 直播段仍被 1295 中间循环无条件 restore、随后被 1360 收敛 hide，**每 pass `none → "" → none` 双写**（实测栈 `pass:2113` = 中间循环 else 分支），在途收起动画仍会被 `cancelPendingSync` 截断。
- 修法（已实测，二选一，均 32/32 全绿、写序归零）：
  1. `const liveStatusOwned = segmentChipState === undefined && !nativePassiveSegments.has(segment.key)`（最小改动，保留"原生受管段不归收敛"的直觉）；
  2. `const liveStatusOwned = segmentChipState === undefined`（直接对齐 `collapse` 的 state 前提；passive 段在 1338 已被跳过，不受影响）。
- 补充：应同时把 1294 上方注释里「nativeManaged 段排除正确」的表述改掉——注释现在写的理由（"原生段由官方接管"）与 nativeManaged 的真实语义不符。

### R2-2【中·注释可复核性】F-3 未修对：新行号全错，且带入了新的错误论证

- `fold.ts:1792`：`见 fold.ts:4106/4131/4167` → 实际 4106 是 isNativeProtected 文档注释、4131 是 `let turn = 0`、4167 是 `return hasBody(el)`；真值为 **4122 / 4147 / 4183**。
- `fold.ts:1793`：`4167 的定义域是块内补集` → 真值 **4182-4183**（`inBlockStatus` / `statusRows`），引用错误使该论断无法复核。
- 同批新增注释的 1349 / 1382 / 1377-1378 亦已漂移（真值 1341 / 1395 / 1390-1391）；其中"P3 安全前提见 1377-1378"现在指向 P3 的**症状描述**，是本批里影响最大的一处（安全论证指向错误）。
- 建议：全面改用语句锚点（`buildSegments 的 const statusRows = range.filter(...)` 等），或至少"行号 + 语句片段"并列，避免下次改动再次整体位移。

### R2-3【低·测试】F-6 桩"形似而神不同"

- 新桩把 `beforematch` 派发放进 `click` 处理器；`fold-017-safety` / `fold-chip-drive` 是独立监听器。实测差异：收起方向 click 在 `fold-017` 语义下保持收起（reveals=0），在新桩下被 reveal 反向撤销（reveals=1、aria 回 true）。
- 当前无行为差异（库层用 `setAttribute` 改 aria、不触发内联监听器），但一旦新增"驱动收起"断言即会失效。建议与 fold-017 对齐，需要 beforematch 的用例显式派发。

### R2-4【低·流程】审查期间源码仍在变动

- 首审基线为 `+26/−4`（`git diff --numstat -- src/fold.ts` 现为 **+73/−11**），且首审判定正确的 4106 在本轮已位移到 isNativeProtected 注释区。本轮"审查开始 == 结束"的哈希只覆盖本窗口，**两份审查的行号引用不可互相印证**——这也是建议弃用绝对行号的实际理由。

---

## 8. 放行建议

| 优先级 | 事项 |
|---|---|
| **合入前必须** | R2-1（一行，二选一修法）——否则 F-1 名义上修了、实际未生效 |
| **合入前建议** | R2-2（行号 → 语句锚点）——注释是本仓库的主要可复核手段 |
| 可选 | R2-3（桩对齐 fold-017）；F-5 的新用例可再补一条"chip 建不出时闭合不撤销收敛"的断言 |
| 另行决策 | F-2（终态行保留策略）、F-4（真机验证缺口① 收益窗口）、缺口②（passive 段收敛） |

**批准状态**：修掉 R2-1 + R2-2 后即可合入；F-A、F-5 本批已合格，F-6/R2-4 不阻塞。
