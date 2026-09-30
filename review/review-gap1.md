# P3 缺口①（直播段状态行收敛）修复的独立审查

- 审查对象：`src/fold.ts`（新增 `convergeLiveStatusRows`，调用点重排）、`test/fold-retry.test.mjs`（新增用例）、`lib/client.js`（build 产物）
- 审查基线（改动内容 SHA256，审查开始 == 审查结束）：
  - `src/fold.ts` = `23C7E64462D247A4AF1168381E2F672E48F90FE99512EBF6BFA660666BB62ECD`
  - `lib/client.js` = `C314FE9B95D0865774FD23D31D16DE2F8A9918A52AE9FD58B34D680A13DFF3F3`
  - `test/fold-retry.test.mjs` = `761D7575D7BDFE808AA986472D0B748E27B07F4055D0CCBF497AE8D033F4D822`
- 方法：源码逐行推演 + 用 `test/fake-dom.mjs` 驱动真实 bundle 的独立探针（写在 `%TEMP%\dsh-review-gap1\`，**未写入仓库**）+ 回滚鉴别力实验 + 全量回归。
- 所有实验后已 `node build.mjs` 重建，`git diff --stat` 仍只有 lib/client.js / src/fold.ts / test/fold-retry.test.mjs 三个文件，hash 与开始时一致。

---

## A. 正确性：新分支是否改变原有语义

**结论：没有遗漏任何原有逻辑；被删掉的 `if (state === undefined) continue` 是等价重排，不是删除语义。**

证据（改动前后对照，HEAD → 工作区）：

| 位置 | 改动前 | 改动后 |
|---|---|---|
| 1348 行后 | `if (!shouldChip) { if (state !== undefined) dropSegmentChip(state); continue }` | 新分支 `state === undefined → convergeLiveStatusRows + continue` |
| 原 1353 行 | `if (state === undefined) continue` | 删除（并入新分支） |
| 原 1350 行 | `state !== undefined` 卫语句 | 改为 `this.dropSegmentChip(state)`（死卫语句清理） |

逐项核对「state === undefined 时原本会执行什么」：

1. `driveGroups([partition.last], true)`（1348）在新分支**之前**执行，行为不变 ✓
2. `ensureSegmentChip` / `driveGroups(covered, …)` / chip aria、`dshcf-has-body` 切换 / P3 状态行处置 —— 全部要求 `state !== undefined`（`ensureSegmentChip` 形参即 `SegmentState`，1635 行还写 `state.groupsExpanded`）。这些在改动前后都不会对直播段执行 ⇒ **没有丢逻辑** ✓
3. `!shouldChip` 分支的卫语句删除是**等价变换**：该分支只可能在 `state !== undefined` 时到达（`state === undefined` 已在上方 continue）✓
4. `desiredHidden`：新分支通过 `hideElement(..., desiredHidden, ...)` 登记（同 P3 口径）✓；`desiredHidden` 每 pass 在 1245 新建，作用域一致。

**唯一真正新增的语义**是：直播段现在会对 `segment.statusRows` 做显示控制（隐藏非末条）。由此派生的跨路径冲突见 **F-1**（同一 pass 内被另一条路径先恢复再隐藏）。

---

## B. 顺序假设：`segment.statusRows` 是否真的已是 DOM 顺序

**结论：断言成立**（数组序 == flow 直接子级的 DOM 序），但注释里给出的**行号证据链是错的**。

证据链（`src/fold.ts`）：

1. `flowItems`（**4106** 调用 / **3898-3905** 定义）：`[...flow.children].filter(排除 .dshcf-processed/.dshcf-processing/.dshcf-flow-chip)` —— `children` 是 Document 序，`filter` 保序 ⇒ 数组序 = DOM 序 ✓
2. `const items = flowItems(flow)`（4106）→ `const range = items.slice(contentStart, end)`（4131，`items.slice` 保序）✓
3. `const inBlockStatus = new Set(...)`（4166）→ `const statusRows = range.filter(el => isStatusRow(el) && !inBlockStatus.has(el))`（**4167**）—— `range.filter` 保序 ⇒ statusRows 是 range 的有序子序列 ⇒ **DOM 顺序成立** ✓
4. 因此 `lastConnected`（数组里最后一个 `isConnected` 的元素）= DOM 里最后一条仍挂载的状态行，「最新一条」的取法正确（即便个别行已被 React 移除，取「最后一个仍在文档中的」也是正确语义）。

**缺陷 F-3（低）**：新注释（1781-1784）写「`range.filter` 产出（4121）」「`items` …（4061）」——两处都不对：
- 4167 才是 `statusRows = range.filter(...)`；4121 在 HEAD 里是注释行；
- 4106 才是 `const items = flowItems(flow)`；4061 实为 `try { button.click() }`。

仓库既有约定是引用**准确**（例：1298 行引用 `fold.ts:1384-1387`、1377-1378，均正确指向 P3 实现），这两处引用违反约定，会把后来者引到错误位置。建议改为 `4167` / `4106`（或去掉行号只留函数名，抗漂移）。另：1784 行「早期草稿曾建 flowOrderIndexOf 索引表，属多余复杂度」属过程性文字，与仓库「注释解释为什么」的风格不同，建议删除。

---

## C. restoreUnusedDisplays 账本：会不会「下一 pass 才生效」或抖动

**结论：不存在「隐藏登记赶不上清理」的问题，隐藏是稳态的；但存在每 pass 一次「恢复→再隐藏」双写（F-1）。**

事实链：

1. `restoreUnusedDisplays` 唯一调用点 `1302`，在段级 chip 循环（1334 起）**之前**；`desiredHidden` 每 pass 在 1245 新建。
2. 它只遍历 `controlledDisplay`（插件**确实写过 display** 的元素）。对本 pass 新出现的状态行：从未进过账本 ⇒ 不在集合 ⇒ 不会被它恢复。对上一轮就已被隐藏的行：其 `desiredHidden` 登记来自**同一个循环**（上一 pass 的 P3 或本新分支），同样晚于 1302 ⇒ 1302 只是「不处理」，不会误恢复。
3. 因此「hide 登记了但 restoreUnusedDisplays 已跑过 → 下一 pass 才生效」**不成立**；探针实测直播稳态下 display 保持 `none`，无下 pass 抖动。
4. 真正会恢复这批行的是**段级中间循环 1281-1290**（不是恢复性清理，而是对抗性的）：

```ts
const chipOwnsStatus = !collapse && segmentChipState !== undefined && segmentChipState.chip !== null && !segmentChipState.groupsExpanded
if (!chipOwnsStatus) { for (const status of segment.statusRows) { if (collapse) hide; else restore } }
```

直播段 `segmentChipState === undefined` ⇒ `chipOwnsStatus` 恒 false ⇒ `collapse` 又恒 false（1264 行同样以 state 为前提）⇒ **无条件 restoreElement 全部状态行**。这与新分支的收敛意图直接对冲（见 F-1）。

---

## D. 边界

| 边界 | 代码行为 | 实测 |
|---|---|---|
| `rows.length === 0` | `lastConnected = -1` → `return`，零写入 | ✓ |
| 全部 `isConnected === false` | 同上，直接 return，不会对已脱离文档的元素写 display | ✓ |
| 只有 1 条 | 走 `restoreElement`（**不是 hide**）——按要求正确 | 探针 S3：`r1.style.display === ''` ✓ |
| 隐藏后被 React 移除 | 数组里不再有它，`isConnected` 过滤天然兜住，无残留、无异常 | 探针 S5：r1 移除后 r2 仍可见 ✓ |
| 段切换 / 同 key 复活 | 收敛跟随最新 DOM：旧行隐藏、新行可见 | 探针 S4：摘掉 turn-tail 令段重开，旧行仍 `none`、新行 `''` ✓ |
| 插件 stop() | `restoreAllDisplays` 完整还原 | 探针 U1：stop 后三条全恢复 `''` ✓ |
| 末条正处「在途收起动画」时段重开 | 该次 pass 的 restore 被 `pending.target === 'visible' ? return` 之外的守卫放过（实测**未复现**末条卡隐藏） | 探针 v7：段重开 pass 后 r3 = `''` ✓（原推断的风险未成立） |

**没有任何路径会让行永久卡在 `display:none`。**

---

## E. 与 P3 的衔接

1. **意图一致**：直播期 = 「留末条」，闭合后 chip 收起 = 「全藏」，是同向的（不会闭合瞬间又被放出来）。探针 T1 实测：闭合 pass 内先一次 restore 再一次 hide，**终态一致**，无可见翻转。
2. **chip 展开**：P3 走 `restoreElement` ⇒ 直播期被收敛的行全部恢复可见。探针 T1：chip 展开后 r1/r2/r3 全 `''`；再收起又全 `none`（幂等）。**不会永久隐藏** ✓
3. **P3 不跑的段（covered 为空、单组段）**：末条以外的行由**一级中间循环 1287 的 `restoreElement` 恢复**（探针 S2：闭合后 r1/r2 都变回 `''`，无卡死）。但这也意味着：`ISSUE_ROOTCAUSE` 问题②场景里很常见的「单组段/全部组都进不了 chip」情况下，直播期的收敛在闭合瞬间被**整体撤销**、重试行再次平铺。这是缺口① 的功效边界，不是卡死缺陷。
4. **F-2（低，策略一致性）**：收敛保留的是「DOM 最后一条」，不区分 kind。若同一段里最后一条是 `model-retry`（常见），则更早的 `turn-error` / `turn-max-tokens`（终态失败、输出上限）会被隐藏。任务书引用的修复方向 2 特意要求「（错误场景）保留末条以免遮住唯一错误线索」，直播段的同类考虑没有体现。探针 T3 实测：`[turn-error, model-retry]` 直播段中 turn-error 被隐藏、重试行显示。

---

## F. 缺陷清单（按严重度）

### F-1【中】直播期收敛的行在同一 pass 内被「先恢复 → 后隐藏」双写

- 证据（在内存副本中于 `restoreUnusedDisplays` 前插入 pass 标记后实测，bundle 栈帧 `<anonymous>:2112` 位于该标记**之前** = 一级中间循环）：

```
── pass 内部标记(before-restoreUnusedDisplays) ──
r1 <- "none"            ← convergeLiveStatusRows（<anonymous>:2511）
r2 <- "none"
r1 <- ""                ← 一级中间循环 restoreElement（<anonymous>:2112）
r2 <- ""                    （即 fold.ts:1285-1290 的 for (const status of segment.statusRows)）
── pass 内部标记(before-restoreUnusedDisplays) ──
r1 <- "none"            ← 下一 pass 再次收敛
r2 <- "none"
```

- 机制：1280-1290 的 `chipOwnsStatus` 以 `segmentChipState !== undefined && chip !== null` 为前提，直播段恒不满足 ⇒ `!chipOwnsStatus` 恒真 ⇒ 每 pass 对所有 `segment.statusRows` 调 `restoreElement`；随后 chip 循环内新分支再 `hideElement`。终态每 pass 相同，因此**肉眼未见闪烁**，但：
  1. 每 pass 双倍 display 写：8 条状态行实测 **14 次/pass**；
  2. 若末条/中间行当时正处**在途收起动画**，`restoreElement` 会 `cancelPendingSync` 截断它——这正是开发者自己在 1274-1279 注释里点名要避免的危害，只是当时把范围限定在「有 chip 的段」，没算上直播段；
  3. 与 1296-1301 F5 注释声称的「restoreUnusedDisplays 放在循环后 → 只做一次收尾清理」的稳态零往返目标相冲突（该注释与实际位置本就不符，见下）。
- 修法（与 lead 的 F-B 一致）：1285 的循环对 `segmentChipState === undefined`（直播段）跳过，把处置权交给 `convergeLiveStatusRows`，避免同 pass 对冲。
- 附带：**F-A（既有缺陷，非本次引入）**——1296-1301 注释要求 `restoreUnusedDisplays` 放在 chip 循环**之后**，实际调用点在 1302（循环之前）。本次改动没有恶化它（新登记的行同样晚于 1302），但两份注释互相矛盾的状态建议一并修掉。

### F-4【中·需真机验证】本次改动的可观测收益存疑（设计层，非代码缺陷）

- `ISSUE_ROOTCAUSE_2026_09_30.md` 自述：`TURN_PROCESS_INDEPENDENT_KINDS`（CHAT:1518）**不含** model-retry ⇒ 原生回合行收起时重试行由官方 `processHidden` + `useSearchableHidden`（`hidden="until-found"`）藏掉，只有用户展开回合行后才可见。
- 由 B 节已核实的前提推出：插件对**块外**状态行（`model-retry` 等）写的是 `style.display`，而这类节点由 React 作为 flow 直接子级重挂；React **不会**清插件写的 `style.display`（组根教训 §4.2 B1）——意味着节点重挂会**重置**插件隐藏，收敛必须逐帧重做。
- 两条合起来 ⇒ 缺口① 的收益窗口 ≈「回合行被展开（alwaysOpen / 用户点开）+ 节点未重挂」。这决定这次改动值不值得留在代码里，也正是 `ISSUE_ROOTCAUSE` 验证清单 #2/#3/#4 要回答的问题。建议在真机确认前不要在文档里把缺口① 标成已修完。

### F-5【中·测试】新增用例末段断言的鉴别力不足（假绿）

- 用例末段断言「闭合后最新重试行交由 P3 处置（随段折叠隐藏）」，但夹具**没有 `turn-process` 座位**（`segmentChipHost` 按 `[data-turn-process]` 定位 → 返回 null → `ensureSegmentChip` 返回 null → P3 不跑）。此时隐藏它的是**一级折叠路径**（1264 `collapse = state !== undefined && !segment.expanded` → 1287 `hideElement`），与 P3 无关。
- 实测：给同一用例**只加**一个 `turn-process` 座位（其余逐字不动）→ `chip=1`，段级 chip 正常建出并驱动；不加 → `chip=0`（探针 v8 的 A/B 对照，A/B 全 PASS）。
- 后果：该断言无法区分「P3 未跑时的通用折叠」与「P3 的 chip 覆盖」，注释里「交 P3 接管」的说明与夹具事实不符。
- 建议：加 `turn-process` 座位作为主场景（真机 compact 形态），把当前单组段保留为对照场景，并补一条 **chip 展开 → 直播期被收敛的行必须全部恢复可见** 的断言（现用例只覆盖「隐藏」方向，不覆盖「恢复」方向）。

### F-6【低·测试】末段断言的失败信息与事实不符

用例 16-18 行的注释声称夹具「与 fold-017-safety 的 makeGroup 同构」，但 fold-017 的 `makeGroup` 额外绑定了官方 `bindOfficialReveal`（body 上的 `beforematch`）；新用例的桩只绑 `btn.click`。当前无行为差异（`ensureSegmentChip` 返回 null，`driveGroups` 一次都不会调），但一旦按 F-5 补上 `turn-process` 座位使 chip 存活，`driveGroups` 的展开通道就会依赖 `beforematch`，届时该桩会与 fold-chip-drive / fold-017 的夹具产生分叉（D1 之类「走 beforematch 而非 click」的锁在该文件里会失效）。建议直接复用 `bindOfficialReveal` 语义。

---

## G. 回归与鉴别力实测

| 项 | 结果 |
|---|---|
| `node test/run-all.mjs`（改动后） | **32 个测试文件全部通过**，exit 0 |
| 回滚鉴别力：把 `if (state === undefined)` 分支改回 `if (state === undefined) continue` → `node build.mjs` → `node test/fold-retry.test.mjs` | **4 条 FAIL**（第 1、2 条重试行未被隐藏；原最新一条不让位；更早的不回流），末段两条仍 PASS ⇒ 用例对直播期行为**有鉴别力** |
| 恢复：改回 + `node build.mjs` | 守卫全过（host/client d.ts export guard、`node --check` 双产物）；`src/fold.ts` 与 `lib/client.js` 的 SHA256 与审查开始时**逐字节一致** |
| `git status --porcelain` / `git diff --stat` | 仍只有 3 个已改动文件（+158/−4），未新增/删除仓库文件（`review/` 为原本就存在的未跟踪目录） |

---

## H. 结论

- **代码正确性：通过。** 新分支是等价重排（未丢 `driveGroups`/chip/账本逻辑），DOM 顺序假设**成立**，边界（0 条 / 全断连 / 1 条 / React 移除 / 段复活 / stop）全部安全，不存在永久 `display:none`，与 P3、与 chip 展开/收起语义一致。
- **是否批准：有条件批准。** 必须修的点只有一处（F-1：直播段与一级中间循环同 pass 对冲），其余为测试与注释质量项。
- **必须修（合入前）**：F-1（在 1285 的 `if (!chipOwnsStatus)` 循环里对 `segmentChipState === undefined` 跳过，或把 `restoreUnusedDisplays` 位置与 F-A 一并归位）。
- **强烈建议同批修**：F-5（用例加 `turn-process` 座位 + 补「chip 展开必须恢复」断言）、F-3（行号 4167 / 4106、删「早期草稿」）、F-6（夹具与 fold-017 对齐）。
- **需真机确认后再定去留**：F-4（缺口① 的实际收益窗口）与 F-2（终态行被隐藏是否符合预期）。
