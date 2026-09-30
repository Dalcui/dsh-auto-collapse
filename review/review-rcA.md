# 代码审查报告 · 问题⑤ 根因A（「最后一组恒展开」改为流粒度）

- 审查对象：未提交工作区改动（`src/fold.ts` +253 / `test/fold-retry.test.mjs` +264）
- 审查基线：`src/fold.ts` SHA256 `8296B087…E3D8789A`（与工作区逐字节一致，审查全程未改动仓库）
- 审查方式：静态阅读 + 独立探针（系统临时目录）+ 变异测试（mutmut 式：改源码→重建→跑测试→比对）
- **结论：不批准合入。** 发现 1 个严重缺陷（根因A 在真机主路径下不生效，且引入回归）、1 个中等问题（B(i)/B(ii) 口径不一致）、1 个测试鉴别力问题。

---

## A. 机制复核 —— 成立（一处措辞需精确化）

**`groupPartitionOf` 确实按段独立**（`src/fold.ts:1803-1824`）：入参是单个 `SegmentSnapshot`，只读 `snapshot.groups`（该段自己的组，由 `buildSegments` 的 `range.filter(isOfficialGroup)` 收集，`src/fold.ts:4319`）。段与段之间无任何共享状态。✓

**「无段新旧门控」属实**：改前 `if (partition.last !== null) this.driveGroups([partition.last], true)` 位于 per-segment 循环体内，对每个非 passive 段无条件执行，无任何段序判定。✓

**措辞精确化**：`partition.last` 不是持久化状态，而是**每 pass 从 DOM 重算**的（`groups.filter(isConnected)` + `drivable` 谓词，1804/1809-1813）。所以严格说不是「永久成立」，而是「**只要该组仍是其所在段的最后一个可驱动组**就成立」。steering 切段后该条件持续满足，故用户描述的等价结论成立，根因A 的定性正确。✓

---

## B. 覆盖集一致性 —— **本轮最严重的问题在此**（结论：B(i) 与 B(ii) 都不一致）

### B-1【严重·阻断】`covered` 的收起驱动被 `if (chip === null) continue` 吞掉 —— 根因A 在真机主路径下**完全不生效**

代码路径（`src/fold.ts:1442-1451`）：

```ts
if (!shouldChip) { this.dropSegmentChip(state); continue }   // covered 空 → 从不驱动
const chip = this.ensureSegmentChip(state, flow)
if (chip === null) continue                                   // ← chip 建不出就退出
this.driveGroups(covered, state.groupsExpanded)               // ← covered 的驱动在这里
```

而 `ensureSegmentChip`（`1709-1715`）内部**重新**调用 `coveredGroupsOf(snapshot)` → `groupPartitionOf().covered`（**不含 last**），并在 `covered.length === 0` 时 `dropSegmentChip + return null`。

**冲突点**：历史段**只有一个可驱动组**时（真机极常见——一个段里往往只有一两个工具组）：
- 循环里的 `covered` = `[...[], last]`，长度 **1** ⇒ `shouldChip = true` ⇒ 进入分支
- `ensureSegmentChip` 内部算出的 covered = **[]** ⇒ `dropSegmentChip` + `return null` ⇒ `continue`
- ⇒ `driveGroups(covered, state.groupsExpanded)` **一次都不执行**

结果：该历史段的最后一组**既不被收起、也不被展开、完全不受驱动**，保持上一次 pass 的展开态。**这正是「恒展开」的症状本身**，只是成因从「每 pass 被驱动展开」变成了「驱动被整体跳过」。

同类触发条件还有：无 `turn-process` 宿主（normal 形态）时 `segmentChipHost` 返回 null（1825-1842）⇒ `chip === null` ⇒ 同样跳过。

**实测证据（探针，时序推进 fixture：g1 先作为唯一段的 last 被展开 → steering 切出段1）**：

| 阶段 | 无 chip 宿主（normal） | 有 turn-process 宿主（compact） |
|---|---|---|
| 阶段1 唯一段（g1 为 last） | `0=true` | `0=true` |
| 阶段2 steering 后（多 pass 稳态） | `0=true 1=true` | `0=true 1=true` |
| 判定 | **★未修复★** | **★未修复★** |

两组并排展开（g1=true 且 g2=true），与 `ISSUE_ROOTCAUSE_2026_09_30.md` 描述的原始症状**逐字相同**。

**为什么新测试没抓到**：新测试夹具（`test/fold-retry.test.mjs:476-495`）是**一次性写入**的——user → g1 → steering → g2 → 正文 全部先建好再 `register()`。此时 g1 是**从未被展开过的全新元素**，它的 `aria-expanded` 初始就是 `false`（`makeGroup` 的 `open: false`，第 23-34 行），断言 `g1 === 'false'` **天然通过**，与"是否被收回"无关。我独立复刻该夹具，得到 `0=false 1=true`（与测试一致）。

**⇒ 新测试的鉴别力来自「从未展开」，而非「被收回」；它没有覆盖真实用户路径**（用户先看到 g1 展开，插话后才应收回）。

### B-2【中等】chip 声称的折叠数 ≠ 实际驱动数（B(i) 与 B(ii) 都不一致）

历史段有 **≥2 个可驱动组** + chip 宿主可建出时，两处 `covered` 口径**同 pass 内不一致**：

| 位置 | 口径 | 实测 |
|---|---|---|
| 循环 `covered`（1394-1396） | `[gA, gB]` = 2 个 | `driveGroups` 实际驱动 **2** 个 |
| `ensureSegmentChip` 内部（1711） | `[gA]` = 1 个 | chip 文案 **「已折叠 1 个工具组」** |

**实测证据（P2 探针）**：

```
阶段1 唯一段（gA 覆盖 / gB last）: 0=false 1=true | chips: (none)
阶段2 steering 后                : 0=false 1=false 2=true | chips: "已折叠 1 个工具组read ×1" aria=false
阶段3 点开 chip 后               : 0=true  1=true  2=true | chips: "已折叠 1 个工具组read ×1" aria=true
```

- **B(i)**：chip 声称折叠 1 个，实际驱动 2 个（gA+gB 都被收起）⇒ **chip 谎报折叠数**。
- **B(ii)**：点开 chip 后 **gB 也被展开**（`1=true`），而 chip 只声称代表 1 个组 ⇒ **展开态的驱动范围同样大于 chip 声称范围**。

这直接违反 `groupPartitionOf` 自己的 R7 明文承诺（`src/fold.ts:1794-1796`）：「covered 与 driveGroups 用**同一个** drivable 谓词，covered.length 与实际被驱动组数恒等」「chip 计数绝不谎报」。

**B(ii) 是本轮新引入的**：改前历史段的 `last` 归 `last`（1402 单独驱动展开）、chip 只代表 `covered`，两者**不重叠**，故 R7 成立。本轮把 `last` 并入 `covered` 后，驱动集合变大了，但 chip 的计数/代表集合（`coveredGroupsOf`）仍是旧口径 —— **R7 的不变量被打破**。

> 修正建议（二选一，需与实现方确认语义）：
> 1. 让 `ensureSegmentChip` 接收循环算出的 `covered`（改签名，单一来源）；
> 2. 或让 `coveredGroupsOf` 接受「是否最新段」参数，内部统一走同一合并逻辑。
> 无论哪种，chip 的计数与代表集合必须与 `driveGroups` 的目标集合**逐元素相同**。

---

## C. 既有断言漂移（实际跑测）

`node test/run-all.mjs` ⇒ **32 个测试文件全部通过，0 失败**。未发现既有断言漂移。✓

原因：既有涉及历史段最后一组的断言（`fold-017-safety` K/L 场景、`fold-chip-drive`、`fold-behavior` 等）全部使用**单段** fixture ⇒ `latestDrivableSegment = 0 = segmentIndex` ⇒ `isLatestSegment = true` ⇒ 行为与改前逐字相同。

---

## D. 边界

| 边界 | 结论 |
|---|---|
| **只有一个段** | `latestDrivableSegment = 0`，`isLatestSegment` 恒 `true` ⇒ `covered` 取 `partition.covered`、`last` 走 1402 ⇒ **与改前逐字一致**。✓ 无回归。（B-1 的 `chip === null` 跳过在单段下不影响 `last` 的展示，因为 1402 独立于 chip 分支。） |
| **`latestDrivableSegment = -1`（全 passive）** | 循环内 `isLatestSegment` 恒 false；但 passive 段在 1382 已 `continue`，合并逻辑根本不作用于它们 ⇒ 整循环无实质动作，与改前一致。✓ |
| **段数组顺序** | `buildSegments` 按 `flowItems(flow)`（`flow.children` 保序）顺序 `append` + `snapshots.push`（`src/fold.ts:4386`）⇒ 稳定等于 DOM 顺序。自后向前扫描取第一个满足条件者，语义正确。✓ |
| **直播段（无 state）× 历史段** | 直播段走 1412-1440 分支（`driveGroups(covered, false)`），历史段走 chip 分支；两者 covered 口径不同属**有意设计**（直播段无 chip 入口）。若直播段恰是 `latestDrivableSegment`，历史段全部按"历史"处理，符合"只在最新段兑现"的承诺。✓ 但见 E 的note。 |
| **尾部空段/纯 passive 段** | 1373-1378 自后向前跳过 passive 与 `last === null` 的段，避免"尾部无组可展导致整条流无组展开"。设计合理。✓ |

---

## E. 与 P1（根因B）的关系 —— 仍正确，无对冲

P1 的 `this.driveGroups(covered, false)` 在直播段分支（`src/fold.ts:1438`）。关心的是它与 1402 的 `driveGroups([last], true)` 是否同 pass 对冲：

- 直播段 `state === undefined` ⇒ 取 `covered = isLatestSegment || last === null ? partition.covered : […]`（1394）。直播段通常是最后一个非 passive 段 ⇒ `isLatestSegment = true` ⇒ `covered = partition.covered`，**不含 `last`**。
- 1402 的目标集 = `{last}`，1438 的目标集 = `covered`，二者**互斥不重叠** ⇒ 无同元素反向驱动。✓
- `driveGroups` 自带 G1（`userOwnedGroups`）与 inert 防护（2238-2239），用户手动开过的组不会被强收。✓

**结论：P1 在新 covered 口径下仍正确。** 唯一需留意：若历史段（非 latest）的 `covered` 含 `last`，其驱动只发生在 chip 分支（1451），与直播段分支互不影响。

---

## F. 性能

**调用次数**：`groupPartitionOf` 现在每段最多被调用 3 次（求 latest 1 次 + 循环内 1 次 + `ensureSegmentChip` 内 1 次）。

实测（6 段 × 8 组 = 48 组的稳态 fixture，插桩计数）：

```
2 pass 内 groupPartitionOf 调用次数 = 26  → 约 13 次/pass
```

即 O(段数) 而非 O(段数²)，绝对量很小。每次成本 = `filter(isConnected)` + 自后向前找 drivable（`closest('[hidden]')` + `groupCollapsibleMode`）。

**bench 对比**（`bench/fold-bench.mjs`，各跑多次）：
- 改后：稳态 89.8 / 91.1 / 102.6 ms/帧；结构批次 121.3 / 123.3 / 129.4 ms/帧
- 波动幅度（±13%）大于可能的真实差异，**无法从 bench 分辨出统计显著的开销**。

**结论：未见可观开销**，不需为性能阻塞合入。可选优化：求 `latestDrivableSegment` 时把 `partition` 缓存下来供循环复用，可省掉每段 1 次重复计算。

---

## G. 测试鉴别力（变异测试）

改 `src/fold.ts` → `node build.mjs` → `node test/fold-retry.test.mjs`：

| 变异 | 结果 | 含义 |
|---|---|---|
| **M1** 去掉 `isLatestSegment` 门控（1402 恢复 `if (partition.last !== null)`） | **FAIL** 1 条（`根因A：…g1=true`） | ✓ 有鉴别力（与实施方自测一致） |
| **M2** `covered` 恢复为 `partition.covered`（撤掉 1394-1396 的合并） | **PASS / 0 失败** | ✗ **合并逻辑未被任何断言覆盖** |
| **M3** `isLatestSegment = segmentIndex === 0` | FAIL 2 条 | ✓ |
| **M4** `latestDrivableSegment = segments.length - 1`（恒取末段） | **PASS / 0 失败** | ✗ **"自后向前找第一个可驱动段"的语义未被覆盖** |

**M2 + M4 说明：新测试只锁定了 1402 的门控，没有锁定本轮两处核心改动的另外两处**（covered 合并、段选取口径）。这也解释了为什么 B-1 的严重缺陷能带着"全绿"通过。

---

## H. 可用的候选修复（已实测）

把 `driveGroups(covered, …)` 移到 `if (chip === null) continue` **之前**（保证"驱动是纯函数目标态、不依赖 chip 是否建出"）：

```ts
      const chip = this.ensureSegmentChip(state, flow)
      // ★ 驱动官方组到各自的目标态（两者都是纯函数，互不冲突）。
      this.driveGroups(covered, state.groupsExpanded)
      // 驱动必须先于 chip 建出失败的提前退出——否则 covered 的收起意图
      // 在「无 chip 宿主 / covered 口径判空」时被整个跳过。
      if (chip === null) continue
      const chipExpandedNow = chip.getAttribute('aria-expanded') === 'true'
```

**实测效果**：P1 症状消除（`0=false 1=true`，★已修复★）；`node test/run-all.mjs` 仍 **32 个文件全部通过**。

⚠️ 该修复**不解决** B-2（chip 计数与驱动范围不一致），后者需单独统一口径。
⚠️ 该修复把 `driveGroups` 提前后，需确认它不再依赖 `ensureSegmentChip` 建 chip 的副作用（当前实现中 `driveGroups` 只读 `groupInert`/`userOwnedGroups` 与 DOM 属性，无此依赖）。

---

## I. 结论

**不批准合入。**

### 必须修（阻断）
1. **根因A 在真机主路径下不生效**：`ensureSegmentChip` 内部用旧口径 `coveredGroupsOf` 判空并 `return null`，导致循环算出的 `covered`（含 last）的驱动被 `continue` 整体跳过。历史段只有一个组、或无 `turn-process` 宿主时，该组**完全不受驱动**，保持展开态 —— 症状与修复前逐字相同（实测 `g1=true 且 g2=true`）。且相对改前是**回归**（改前 `last` 至少会被 1402 驱动展开，现在连展开都不保证了）。

### 应当修
2. **B(i)/B(ii) 口径不一致**：chip 声称折叠 1 个、实际驱动 2 个；chip 展开时多展 1 个。违反 `groupPartitionOf` 的 R7 明文承诺。需让 `ensureSegmentChip` 与循环共用同一个 `covered`。
3. **测试缺口**：新测试未覆盖「先展开、后 steering 收回」的真实时序路径（M2/M4 变异存活即证）。应补时序推进型 fixture，并对 M2/M4 两类变异加锁。

### 可不修（记录）
4. 性能无实质回归（约 13 次/pass 的 O(段数) 调用），bench 差异在噪声内。
5. 单段行为与改前逐字一致；`latestDrivableSegment = -1`、段序稳定性、与 P1 的互斥关系均无问题。

---

## 附：审查过程的可复现性

- 全部探针写入 `%TEMP%\dshcf-review\`，未在仓库内新增/删除任何文件。
- 审查期间对 `src/fold.ts` 做过插桩与候选修复实验，结束前已从基线副本逐字节恢复并重新 `node build.mjs`：
  - `src/fold.ts` SHA256 = `8296B0879606FDB2D346C3D09B0FF8F354D4F0A057E0D5E288F1E755E3D8789A`（与审查开始前一致）
  - `git status --porcelain` = ` M lib/client.js` / ` M src/fold.ts` / ` M test/fold-retry.test.mjs` / `?? ISSUE_ROOTCAUSE_2026_09_30.md` / `?? review/`
  - `git diff --stat` = `lib/client.js 89 | src/fold.ts 253 | test/fold-retry.test.mjs 264`（与审查开始前逐字一致）
