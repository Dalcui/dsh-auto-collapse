# 代码审查报告 · 问题⑤ 根因A —— 第二轮复核

- 审查对象：未提交工作区改动 `lib/client.js` +118 / `src/fold.ts` +299 / `test/fold-retry.test.mjs` +305
- 审查基线（全程未改动仓库）：
  - `src/fold.ts` SHA256 `F19363DBF3BE68570795EF4202112B9905E5CED489BA1A1DD792A5421056FC89`
  - `lib/client.js` SHA256 `D975D2E4AC0902A71EF5760CCB2916A28E3B31A3F48E01D4CFBD31C07C4BF4A3`
  - `test/fold-retry.test.mjs` SHA256 `BB53F7DCD80BC877915DF4A2AED1873A566323559A37BD293996826089E86918`
- 审查方式：静态阅读 + 独立探针（`%TEMP%\dshcf-rcA-r2\`，11 个场景）+ 真机产物 A/B + 11 组变异测试 + 交叉运行（新测试 × 旧产物）
- **结论：批准合入。第一轮的两项缺陷（阻断级根因A、R7 谎报）经独立实测确认已修复，未发现新的实质缺陷。**

---

## 0. 方法学：A/B 基线的可信度（先立此前提）

第一轮遗留风险是「探针夹具与真机时序不符」。本轮先解决**对照物本身是否可信**：

| 产物 | 构造方式 | SHA256 |
|---|---|---|
| `client-pre.js`（改前） | 用**仓库自身 esbuild + tsconfig**（`absWorkingDir` = 临时镜像，复刻 build.mjs 全部参数）编译 `git show HEAD:src/fold.ts` | `4B135930…EB2153` |
| `client-head.js` | `git show HEAD:lib/client.js`（字节保真：用 `cmd /c` 重定向，避开 PowerShell 的 UTF-8 重编码） | `4B135930…EB2153` |
| `client-pristine.js`（改后） | 同一构建管线编译工作区 `src/` | `D975D2E4…4BF4A3` |
| 仓库 `lib/client.js` | 已构建产物 | `D975D2E4…4BF4A3` |

**改前产物与 `git show HEAD:lib/client.js` 逐字节相同，改后产物与仓库 `lib/client.js` 逐字节相同。**
⇒ 下述 A/B 对照的就是真机实际加载的两个 bundle，不是「近似复现」。所有变异/构建只在临时镜像内进行，仓库目录零写入。

---

## A. 阻断缺陷是否真修好 —— **是**

### A-1 时序推进夹具（先只有段0、后插 steering）

夹具：`user → 组gA → 正文` 先建好并 `register()`（此时 gA 是唯一段的 last，被驱动展开）；**断言之后**再插入 `steering → 组gB → 正文`，再 `register()` × 2 pass。

| 产物 | 宿主形态 | 阶段1（仅段0） | 阶段2（steering 后） | 结论 |
|---|---|---|---|---|
| **改后** | 无 turn-process 宿主（normal） | `gA=true` | `gA=false, gB=true` | ✓ 已修 |
| **改后** | 有 turn-process 宿主（compact） | `gA=true` | `gA=false, gB=true` + chip「已折叠 1 个工具组」 | ✓ 已修 |
| **改前** | 无宿主 | `gA=true` | `gA=true, gB=true` | ✗ 第一轮症状复现 |
| **改前** | 有宿主 | `gA=true` | `gA=true, gB=true` | ✗ 第一轮症状复现 |

**「无宿主与有宿主两种形态都是 g1=true g2=true」在改前产物上逐字复现，在改后产物上两种形态都已消除。** 这正是第一轮判定的阻断路径（历史段仅 1 组 ⇒ 有效覆盖集长度 1 但 chip 建不出 ⇒ 驱动被 `continue` 吞掉）。

### A-2 交叉运行：新测试是否真能锁住该缺陷

把**新测试文件**分别跑在旧产物与新产物上（`test/` 全量镜像 + 指定 `lib/client.js`）：

| 产物 | `fold-retry.test.mjs` | 关键 FAIL |
|---|---|---|
| 改前 `client-pre.js` | **exit 1，12 FAIL** | `根因A：插话后历史段（段0）的最后一组被收回 (g1=true)`、`阻断缺陷：历史段仅 1 组且 chip 建不出时仍须被驱动收起 (gA=true)` |
| 改后 | **ALL PASS，exit 0** | — |

⇒ 新测试不是「天然通过」的真空断言，它确实咬住了这条路径。

### A-3 变异验证

`MUT-B-drive-after-chip`（把 `this.driveGroups(covered, state.groupsExpanded)` 移回 `const chip = …` 之后，即第一轮的原始顺序）

- 用 `git diff --no-index` 确认变异源与工作区的差异**正是那 3 行的重排**；
- 结果：**FAIL 2 条** —— `根因A：…被收回 (g1=true)`、`阻断缺陷：历史段仅 1 组且 chip 建不出时仍须被驱动收起 (gA=true)`。
- 与第一轮报告的「该顺序即缺陷」完全一致。

**A 项结论：阻断缺陷已真实修复，且新测试对它有鉴别力。**

---

## B. R7 一致性是否真达成 —— **是（chip 计数/代表集合与驱动集合逐元素同源）**

### B-1 同源性（静态）

`src/fold.ts:1394` 的 `const covered = effectiveCoveredOf(partition, isLatestSegment)` 是**唯一**产出点：

- `1454` `this.driveGroups(covered, state.groupsExpanded)` ← 同一个数组对象
- `1455` `this.ensureSegmentChip(state, flow, covered)` ← 同一个数组对象（签名已改为收 `covered` 形参，内部**不再**调用 `coveredGroupsOf`）
- chip 文案 `1772`（`'已折叠 ' + String(covered.length) + ' 个工具组'`）与摘要 `summarizeGroups(covered)` 也都取自该数组

⇒ 字面意义上的单一真源，不存在第二处口径。签名强制：`grep` 确认 `ensureSegmentChip` 仅 `1455` 一处调用，且必须传 `covered`。

### B-2 「历史段有 2 个组」夹具实测（夹具中历史段实为 3 组）

夹具：`user + turn-process宿主 → g1(read) g2(code) g3(write) → 正文`，先 register；再插 `steering → g4(exec) → 运行中正文`。

| 阶段 | aria 序列 (g1,g2,g3,g4) | chip 文案 | 一致性 |
|---|---|---|---|
| 直播期（仅 1 段） | `false,false,true` | 无 chip | — |
| 段1 出现后（历史段=段0） | `false,false,false,true` | `已折叠 3 个工具组` / `read ×1 · code ×1 · write ×1` | ✓ 3 = 3 |
| 点开 chip | `true,true,true,true` | `aria=true`，文案不变 | ✓ 展开范围 = 代表范围 |
| 再收起 chip | `false,false,false,true` | `aria=false` | ✓ |
| 再跑 2 pass（稳态幂等） | `false,false,false,true` | 不变 | ✓ 无震荡 |

**第一轮实测的 `0=false 1=false 2=true` +「已折叠 1 个」谎报已消失**；本轮为 `0=false 1=false 2=false 3=true` +「已折叠 3 个」，N 与实际被驱动组数逐元素相等。

### B-3 覆盖集含 outerHidden / 非折叠模式组时的口径一致

| 场景 | 夹具 | aria 序列 | chip | 判定 |
|---|---|---|---|---|
| 历史段中间组带原生 `hidden`（S6） | 历史段 4 组，`gs[1]` 加 `hidden="until-found"` | `false,false,false,false,true` | `已折叠 3 个` / `a0 ×1 · a2 ×1 · a3 ×1` | ✓ 被排除的组既不计数、不进摘要，也不被驱动 |
| 历史段含 `data-group-expanded-mode`（S5） | 历史段 3 组，中间组非折叠模式 | `false,false,false,true` | `已折叠 2 个` / `read ×1 · write ×1` | ✓ 同上 |

### B-4 变异：R7 真源被破坏时无测试捕获（**测试缺口，非产品缺陷**）

`MUT-G-chip-old-predicate`：把 `1455` 改回旧口径 `this.ensureSegmentChip(state, flow, partition.covered)`（即第一轮的谎报成因）。独立探针立刻复现第一轮症状：

```
MUT-G  [S3 stage2] exp=false,false,false,true  chip=aria=false title="已折叠 2 个工具组" summary="read ×1 · code ×1"
正确    [S3 stage2] exp=false,false,false,true  chip=aria=false title="已折叠 3 个工具组" summary="read ×1 · code ×1 · write ×1"
```

（3 个组被驱动收起，chip 却声称 2 个 —— 谎报复现。）

**但 `node test/run-all.mjs` 32/32 全绿，无任何断言捕获。** 即「本轮修复的第二个问题」目前只靠代码结构（把 `covered` 作为形参传入）保证，没有回归网。见 G-1。

---

## C. 单段行为是否与改前完全一致 —— **是（严格一致）**

单段时 `latestDrivableSegment = 0`、`segmentIndex = 0` ⇒ `isLatestSegment ≡ true` ⇒ `effectiveCoveredOf` 走 `return partition.covered` 分支，与改前逐字等价。

实测（A/B 全场景 diff，仅列单段项）：

| 场景 | 改前 | 改后 | 判定 |
|---|---|---|---|
| S1 单段：live（2 组，未闭合） | `false,true` / chip=none | `false,true` / chip=none | 逐字节相同 |
| S1：加 turn-tail 闭合 | `false,true` / `已折叠 1 个` `read ×1` | 同左 | 逐字节相同 |
| S1：点开 chip | `true,true` / aria=true | 同左 | 逐字节相同 |
| S1：再收起 chip | `false,true` / aria=false | 同左 | 逐字节相同 |
| S1：**摘掉 turn-process 宿主** | `false,true` / chip=none | 同左 | 逐字节相同 |
| S8 单段 + 宿主 + 2 条重试行，稳态 4 pass | r1.display=none, r2.display='', `已折叠 1 个` | 同左 | 逐字节相同 |
| S10 全 passive（原生行恒展开+disabled） | `true,true` / r1='' / chip=none / processed=0 | 同左 | 逐字节相同 |

**A/B 全量 diff 的差异项 100% 集中在「多段」与「无 state 直播段」两类场景，且都是有意的行为变更**（见 S2–S6、S9 表）。单段无任何差异。

---

## D. 驱动提前的副作用 —— **未发现异常**

1. **「covered 为空但仍被驱动」不可能发生。**
   - 进入 chip 分支的前提是 `shouldChip = covered.length > 0`，此时 covered 必非空；
   - `ensureSegmentChip` 只在**宿主缺失**时返回 null，而它返回 null 时只调 `dropSegmentChip(state)`（移除旧 chip DOM，**不动** `covered`）⇒ 循环里那份 `covered` 仍然有效，驱动合法。
   - `dropSegmentChip` 全仓仅两处调用（`1441` 无覆盖集分支、`1732` 空集分支），两者都在 `driveGroups` 之后。**不存在「段被 dropSegmentChip 后仍被驱动」的异常。**
2. **shouldChip 分支与驱动的关系仍正确**：驱动位于分支内、chip 创建之前；无覆盖集时 `dropSegmentChip + continue`（不驱动，正确——没有组需要收起）；直播段分支同样先驱动后收敛。
3. **chip 展开态仍取 `state.groupsExpanded`**（`1454`）。实测 S3 stage3/4：chip 展开 ⇒ 历史段 3 组全 true；chip 收起 ⇒ 全 false。变异 `MUT-H`（目标态硬编码为 false）被 `fold-chip-drive.test.mjs` 捕获 ⇒ 展开态语义有测试守护。
4. 未观察到额外的 display 写往返：S8 稳态 4 pass 在改后产物上 r1/r2 的 display 写次数为 **0**（改前为 16/16）。

---

## E. 边界

| 边界 | 改前 | 改后 | 判定 |
|---|---|---|---|
| `latestDrivableSegment = -1`（全 passive，原生行 aria=true + disabled） | `true,true` / r1.display='' / chip=none / 无一级行 | 逐字节相同 | ✓ 插件确实完全不介入，§5.10 门控未被新代码穿透 |
| 尾段无组（第二段纯正文，无官方组） | `g1=true` / chip=none | 相同 | ✓ 自后向前回退到段0，保持「最近的工作可见」；且「只驱动不建 chip」符合解耦设计 |
| covered 含 outerHidden 组 | 见 B-3 | 见 B-3 | ✓ chip 计数/摘要/驱动三者都排除它 |
| 非折叠模式组（`data-group-expanded-mode`） | 见 B-3 | 见 B-3 | ✓ 同上 |
| 两个**已闭合**回合（历史段有 state） | `gA=true, gB=true` | `gA=false, gB=true` | ✓ 根因A 的收益不止于直播窗口 |
| 段序稳定性 | — | `buildSegments` 按 `flowItems(flow)` 保序 push，自后向前扫描取第一个满足者；实测 5 段夹具序列稳定 | ✓ |

---

## F. 全量回归（实际运行）

| 命令 | 结果 |
|---|---|
| `node test/run-all.mjs` | **32 个测试文件全部通过**，exit 0 |
| `node build.mjs` | `host d.ts export guard: ok` / `client d.ts export guard: ok` / `host half syntax check: ok` / `client bundle syntax check: ok`，exit 0；重跑后 `lib/client.js` 哈希不变（`D975D2E4…`）⇒ 构建确定性 |
| `npx tsc --noEmit` | 通过，exit 0 |

---

## G. 测试质量（变异测试，共 11 组）

构建方式：临时镜像 `src/` + 改一处 + 用仓库 esbuild 打包，再在镜像内跑**全量**测试文件（镜像同时产出 `lib/index.js`，避免纯宿主用例假失败）。

| 变异 | 内容 | fold-retry | 其他 | 判定 |
|---|---|---|---|---|
| M0 baseline | 无 | pass | 全绿 | 基线可信 |
| MUT-A | `effectiveCoveredOf` 历史分支恒返回 `partition.covered` | **FAIL 2**（g1=true / gA=true） | — | ✓ 有鉴别力 |
| **MUT-B** | **`driveGroups` 移回 `ensureSegmentChip` 之后（第一轮的阻断顺序）** | **FAIL 2**（g1=true / gA=true） | — | ✓ **本轮核心修复被锁住** |
| MUT-C | 去掉 `isLatestSegment` 门控（改回对每段驱动 last） | pass | 全绿 | ✗ **存活**（见 G-3） |
| MUT-D | `latestDrivableSegment` 恒取末段 | pass | 全绿 | ✗ **存活**（见 G-2） |
| MUT-E | `isLatestSegment = (segmentIndex === 0)` | **FAIL 3** | — | ✓ |
| **MUT-G** | **chip 改用旧口径 `partition.covered`（复现谎报）** | pass | 全绿 | ✗ **存活**（见 G-1） |
| MUT-H | chip 驱动目标态硬编码 false | pass | **fold-chip-drive FAIL** | ✓ |
| MUT-I | 驱动移到 chip 创建之后、null 检查之前 | pass | 全绿 | 等价变异（`ensureSegmentChip` 不改驱动相关状态），非缺口 |
| MUT-J | `restoreUnusedDisplays` 回退到段级循环之前 | **FAIL 3**（R3-3 稳态零写 first=3 now=11 / D-1 ×2） | — | ✓ |
| MUT-K | `liveStatusOwned` 守卫回退 | **FAIL 3**（同上） | — | ✓ |

### G-1【缺口·中】chip 与驱动的单一真源无回归网

`MUT-G` 存活。当前「不谎报」只由**代码结构**（`covered` 作形参传入）保证：任何人日后把 `ensureSegmentChip` 改回内部自算，32/32 仍全绿，而第一轮的谎报会原样回来。
**建议补一条断言**：历史段 ≥2 组时，chip 文案里的数字 === `aria-expanded==='false'` 的 covered 组数，且 === chip 展开后被置 true 的组数。

### G-2【缺口·轻中】`latestDrivableSegment` 的「自后向前找第一个可驱动段」语义未被锁定

`MUT-D`（恒取末段）存活。该语义的收益是「尾段无组/被 passive 时不让整条流一个组都不展开」。构造「段0 有组、尾段无组」的夹具即可杀（正确实现回退段0 并展开其 last；MUT-D 会让段0 的 last 收进 covered）。第一轮报告同样指出 M4 存活，**本轮仍未锁定**。

### G-3【缺口·轻】`isLatestSegment` 门控无行为级鉴别力，但存在真机风险

`MUT-C` 存活。原因：该门控的两条目标线被其它路径**遮蔽**——最新段的 last 会被 `driveGroups(covered=[])`（无 state）、`driveGroups([last], true)`（`1400`）、或 chip 分支的 `driveGroups(covered, true)` 展开。我在 6 种夹具（直播/闭合 × 有宿主/无宿主）下都得到与正确实现**完全相同**的 aria 序列。
唯一可观测量是**冗余 click 次数**：两个已闭合回合、无宿主的夹具（S11）下，正确实现 `gA` 被驱动 2 次，MUT-C 被驱动 **8 次**。
这不是纯性能问题：`driveGroups` 会跳过 `userOwnedGroups`（G1 用户手势接管），冗余驱动会**放大**组被标记接管的窗口，存在低概率的可用性风险。
⇒ 建议：(a) 保留门控（当前实现正确）；(b) 用「无宿主 + 两闭合回合 + 点击计数」夹具把它锁住，或至少在注释里写明「该门控当前为冗余保险，勿删」。

### G-4【缺口·轻】`coveredGroupsOf` 已成死代码

全仓（`src/`、`lib/`、`test/`、`bench/`）确认：`private coveredGroupsOf(snapshot, isLatestSegment)`（`1793`）**唯一引用点就是它自己的定义**，无任何调用。第一轮判定「`effectiveCoveredOf` 是单一真源」后，它已被完全取代。
同时 `test/fold-017-safety.test.mjs:36` 的变异清单仍写着「KILLED coveredGroupsOf 恒空（M14） → E0/K0/L1 抓到」——该变异对象已不存在，属注释漂移。
⇒ 建议删除该死方法并更新该注释；保留也无功能风险（不违反任何守卫）。

---

## H. 结论

**批准合入。**

第一轮的两项缺陷经独立实测确认已修复，且本轮未引入新的实质缺陷：

1. **阻断缺陷（根因A 在真机主路径不生效）已修**：时序推进夹具下，无宿主与有宿主两种形态的改前产物都复现 `gA=true, gB=true`，改后产物都是 `gA=false, gB=true`；新测试跑在旧产物上 12 FAIL、跑在新产物上 ALL PASS；`MUT-B`（恢复缺陷顺序）被 FAIL 捕获。
2. **R7 谎报已修**：`covered` 单一真源（`effectiveCoveredOf` → `1394` → `1454`/`1455`/`1772`/`1776`），实测「已折叠 3 个」与 3 个被驱动的组逐元素相等，含 outerHidden / 非折叠模式组时的排除口径也一致；第一轮的 `0=false 1=false 2=true` +「已折叠 1 个」不再出现。
3. **单段行为与改前逐字节一致**（`isLatestSegment ≡ true`，走 `return partition.covered`），未见回归。
4. **驱动提前无副作用**：`covered` 为空时根本进不了该分支；`dropSegmentChip` 与驱动不同集为空；chip 展开态仍正确取自 `state.groupsExpanded`。
5. **32/32 全绿 + build.mjs 全守卫通过 + tsc 通过**，构建确定性可复现。

### 仍需修（均不阻断合入）

| # | 级别 | 问题 | 建议 |
|---|---|---|---|
| 1 | 中 | `MUT-G` 存活：chip/驱动单一真源无回归网，谎报可无声回归 | 补「chip 文案数字 === 实际被驱动组数」断言 |
| 2 | 轻中 | `MUT-D` 存活：`latestDrivableSegment` 回退语义未被锁定（第一轮 M4 的同一缺口） | 补「尾段无组 ⇒ 回退段0 并展开其 last」夹具 |
| 3 | 轻 | `MUT-C` 存活：`isLatestSegment` 门控无行为鉴别力，但冗余驱动会放大 G1 接管窗口 | 保留门控；补点击计数夹具或加「冗余保险，勿删」注释 |
| 4 | 轻 | `coveredGroupsOf` 已是死代码；`fold-017-safety.test.mjs:36` 的 M14 注释漂移 | 删死方法 + 更新注释 |

---

## 附：审查过程可复现性与仓库完整性

- 全部探针、构建镜像、变异产物写入 `%TEMP%\dshcf-rcA-r2\`；**未在仓库内新增/删除任何文件**（唯一新增仓库文件为本报告）。
- 变异与 A/B 构建全部在临时镜像中进行（镜像内复制 `src/*.ts` + `tsconfig.json`，用仓库自己的 esbuild 打包），**审查期间从未修改 `src/fold.ts`**，因此无需恢复、无残余风险。
- 审查结束后的仓库状态（与审查开始时逐字节一致）：

```
git status --porcelain
 M lib/client.js
 M src/fold.ts
 M test/fold-retry.test.mjs
?? ISSUE_ROOTCAUSE_2026_09_30.md
?? review/

git diff --stat
 lib/client.js            | 118 +++++++++++++++---
 src/fold.ts              | 299 ++++++++++++++++++++++++++++++++++++++++------
 test/fold-retry.test.mjs | 305 +++++++++++++++++++++++++++++++++++++++++++++++
 3 files changed, 670 insertions(+), 52 deletions(-)
```

- 审查后重新执行 `node build.mjs`：全守卫通过，`lib/client.js` 哈希仍为 `D975D2E4AC0902A71EF5760CCB2916A28E3B31A3F48E01D4CFBD31C07C4BF4A3`（未产生漂移）。
