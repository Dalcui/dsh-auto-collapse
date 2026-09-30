# P1 收口审查 —— 整个未提交改动集（端到端复核）

- 审查对象（未提交工作区）：`src/fold.ts`、`test/fold-retry.test.mjs`、`lib/client.js`（构建产物）
- 审查基线（**开始 == 结束，逐字节一致**）：
  - `src/fold.ts` = `61A4EDADE46CDA2409549B53E75B150391C90ADD33A7F95386515EB334EA2878`
  - `lib/client.js` = `BF56DBABA68DD029174535838587C32B3B465B8894AB38A4E07A3BB88B032B8B`
  - `test/fold-retry.test.mjs` = `56525D240A2FD9054AB79552002528F12DB45877F8C938180116A246B5940ABD`
  - 规模：`src/fold.ts +180/−26`、`test/fold-retry.test.mjs +237`、`lib/client.js +63/−?`（git diff --stat：3 files, +454/−26）
  - `git status --porcelain` 与开始时一致（3 个已修改文件 + 原有未跟踪项 `ISSUE_ROOTCAUSE_2026_09_30.md`、`review/`）
- 方法：源码逐行推演 + **消融/回滚实验**（临时改 src → rebuild → 测试 → 逐字节还原）+ **独立探针**（`%TEMP%\p1-final-probe*.mjs`，全部在系统临时目录，未写入仓库）+ 官方 bundle 语句锚点复核
- 约束遵守：未启动次级 subagent；未调用 memory/skill_manage；未 git commit/push/checkout/reset（只用了 `git show HEAD:...` 读对象）；仓库唯一写入为本文件

---

## 0. 结论

| 项 | 判定 |
|---|---|
| **是否批准交付** | **批准（Approve）** —— 无功能性阻断项，全量 32/32 全绿，六项清单**逐项独立验证成立** |
| A 整体一致性 | 无冲突、无互相抵消；1/2/4 在同一段级循环内**严格互补**，5 在更早 pass 的开头，与 1 形成**成对约束**（拆开任一半即回到基线缺陷） |
| B 永久卡 `display:none` | **未发现可达路径**（穷举 6 类路径 + 探针实测；唯一"无插件入口"的窗口另有既有缺陷同源项，见 D-1） |
| C §4.2 只读保护面 | **零写**（审计已做过正对照灵敏度验证，结论非空集真）；无新增保护面写点 |
| D 性能 | 稳态**零写、零 click**；直播段每 pass 额外 `convergeLiveStatusRows` 1 次 ≈ 0.019ms（40 组 + 20 重试行夹具），每"新增一组"恰 1 次 click（用户收起本身必要），**无放大** |
| E 测试质量 | 4 场景断言**真实**；6 个消融实验**全部可复现**；旧 bundle 对照 10 FAIL ⇒ 无空集真 |
| F 全量回归 | `node test/run-all.mjs` → **32/32 通过，exit 0**（改动前后各跑一次）；`build.mjs` 四道守卫全部通过 |
| G 不宜交付问题 | 无阻断项；4 项残留（D-1 中低、D-2/D-3 低、D-4 信息），均**非本轮引入**或不影响本轮目标 |

---

## 1. 六项清单的独立验证（不采信描述，逐项实测）

| # | 声明 | 独立验证方式 | 结论 |
|---|---|---|---|
| 1 | 新增 `convergeLiveStatusRows`：直播段只留 DOM 顺序最后一条可见，终态行豁免 | 源码逐行 + bundle 定位（`lib/client.js:2507-2520`）+ 探针 | **成立**（范围限定见 D-1） |
| 2 | 直播段新增 `this.driveGroups(covered, false)` | 消融 V1：改 `void covered` → 仅该断言 FAIL（`g1=true`） | **成立** |
| 3 | F-A：`restoreUnusedDisplays` 从 chip 循环前移到后 | 忠实回滚 V6（把调用移回 `cleanupStaleChips` 之前）→ 3 条断言 FAIL + **全量 1 个文件失败** | **成立，且是承重的** |
| 4 | 守卫用 `!nativePassiveSegments` 而非 `!nativeManaged` | 反事实 V3：换回 `!nativeManaged` → `R3-3` FAIL（写次数 `first=3 now=11`） | **成立**（写次数是唯一可观测差异，测试抓到了） |
| 5 | D-1 两处：`cleanupLegacyResidue` 排除受控元素 + `hideElement` 保留账本登记 | 回滚 V4：删掉 `controlled.has(el)` 排除 → 2 条断言 FAIL（`r1=""`、写 1→2） | **成立，且两处必须成对**（见 §5.1） |
| 6 | 4 个新场景均实测鉴别力 | 5 个消融 + 旧 bundle 对照（10 FAIL，见 §6.3） | **成立** |

---

## 2. A. 整体一致性（1/2/4 同段级循环；5 在更早 pass）

### 2.1 单一来源与严格互补

`pass()` 内 `desiredHidden`（fold.ts:1255）是**每 pass 新建的 Set**，段级循环里每个元素至多有一个处置来源：

- 段级**中间**循环（fold.ts:1277-1321）：只处置 `segment.middleSteps` 与（未让权时）`segment.statusRows`；
- 段级**收敛**（fold.ts:1381-1404）：`state === undefined` 时处置 `statusRows`（`convergeLiveStatusRows`）并驱动 `covered`；
- 块级（reconcileBlock）：处置 `block.rows / containers / statusRows`；
- 收尾 `restoreUnusedDisplays(desiredHidden)`（fold.ts:1458）：清掉本 pass 未登记的受控元素。

**互补性证明（静态）**：`nativePassiveTurns ⊆ nativeTurns`（fold.ts:1043 无条件 add、1048 加 passive）⇒ `nativeManaged ⊇ nativePassiveSegments`；段级收敛循环开头 `if (nativePassiveSegments.has(segment.key)) continue`（fold.ts:1359）。
于是在 `state === undefined` 的定义域内：

- passive ⇒ 收敛循环被 skip（不处置），中间循环 `liveStatusOwned=false` ⇒ **处置**；
- 非 passive ⇒ `liveStatusOwned=true` ⇒ 中间循环**跳过**，收敛循环**处置**。

二者恰好穷尽、无交叠。**实测佐证**：V3（谓词换成 `!nativeManaged`）产生 8 次/pass 的 `none→""→none` 往返；现实现稳态 0 写（§4）。说明该"互补"不是纸面推演，而是可观测的承重结构。

### 2.2 五处是否互相抵消

- **1 vs 4**：同一循环的两侧（收敛 vs 中间），互补而非对冲（§2.1）。
- **2 vs 1**：`driveGroups(covered,false)` 与 `convergeLiveStatusRows` 目标域**不交**（组 vs 状态行），且 `partition.last`（fold.ts:1371，目标 true）与 `covered`（fold.ts:1401，目标 false）在 `groupPartitionOf` 里由同一次 `slice` 保证互斥（fold.ts:1784）。无同 pass 反向驱动。
- **5 vs 1**：方向一致——5 让 `cleanupLegacyResidue` 远离插件当前意图，1 的收敛意图得以存活；5 的另一半（`hideElement` 账本登记）让"元素在插件隐藏期间获得原生 hidden"时意图不丢。二者与 §2.3 的收尾组成**同一套账本契约**。
- **5 vs 3(F-A)**：5 的两半必成对。只加 `cleanupLegacyResidue` 的排除而删 `hideElement` 的登记 ⇒ 元素获得 hidden 时丢意图 ⇒ 收尾立刻写回 `original`（V4 实测 `r1: none→""`）；只留登记而删排除 ⇒ 同一元素被"清遗留→重隐藏"往返（V4 实测写 1→2）。**结论：这两半与本轮 D-1 场景是同一条链，缺一不可。**

### 2.3 F-A 为什么"归位后本 pass 才自洽"

`desiredHidden` 是 per-pass 的：若收尾在 chip 循环之前跑，则 P3 与 `convergeLiveStatusRows` 在**同一 pass 内稍后**才登记的意图对本 pass 无效 ⇒ 上一 pass 被隐藏的行先被 `restoreElement` 写回，再由 chip 循环写回 `none`（V6 实测 3 条断言失败 + 全量失败）。

---

## 3. B. 最坏路径：是否存在永久 `display:none` / 永久可见

### 3.1 永久隐藏（用户再也看不到）—— 逐路径穷举

| # | 路径 | 结论 | 证据 |
|---|---|---|---|
| 1 | 行仍是 DOM 后代、仍在同一段 | 由 `converge`（直播）或 P3/一级折叠（闭合）+ 每 pass 的 `desiredHidden` 重算处置，可逆 | 探针：闭合后 chip 展开 → 全部恢复 `""`；再收起 → 重新 `none`（幂等） |
| 2 | 行被 React 复用/搬到新段 | 新段不登记它 ⇒ 收尾写回 original | 探针 (c)：搬走后 `r1: none → ""` |
| 3 | 行被 React 删除（脱离 DOM） | 无视觉；账本条目随元素不可达 | 由 `isConnected`/WeakMap 语义保证 |
| 4 | 切换会话/flow 替换 | `switchFlow → restoreAllDisplays()`（fold.ts:1527）遍历全部受控元素写回 | 探针 (d)：切换后 `r1: none → ""` |
| 5 | 插件卸载 `stop()/dispose` | 同上（`switchFlow(null)` → `restoreAllDisplays`） | 源码路径唯一，无旁路 |
| 6 | 元素在"插件隐藏期间"新获得原生 `hidden` | 由 D-1 登记保意图；React 事后移除 hidden 时，下一 pass 的 hide 仍会落账；官方展开瞬间也不会短暂可见 | 探针：加 hidden 后 `r1` 保持 `none`，移除 hidden 后仍 `none`，全程 0 次多余写 |

**唯一"无插件入口"的窗口（既有缺陷同源，非本轮引入）**：直播段里落在**块内**的状态行（`block.statusRows`，即"工具行之后、正文之前"的重试行/终态行）不受 `convergeLiveStatusRows` 管辖（后者的定义域 = 块内 `statusRows` 的**补集**，fold.ts:4262-4263）。此类行在直播期由 `reconcileBlock` 按块的"可折叠性"处置，存在两种形态：

- 块可折叠（≥2 条可折叠行，含常见的"工具 + 终态行"组合）⇒ 会被藏进二级 chip，**但 chip 是可见入口**，点击可恢复（实测：`e1: none → ""`）；
- 块**不可折叠**（恰好 1 条可折叠行 + 1 条状态行）⇒ 走 `blockFoldableCount(block) < 2` 的 restore 早退分支，**恢复**；
- 仍有一个**一次闪烁**窗口：状态行刚入块但块尚不可折叠（恢复）→ 块变为可折叠的瞬间（隐藏）→ 正文到达使块不再可折叠（恢复）。实测该序列在桩里可复现（`e1="" → none → none`）。

**HEAD 对照**：同一夹具、同一序列，改动前 bundle 的终态**逐字相同** ⇒ **非本轮回归**。但它把 `convergeLiveStatusRows` 注释里"终态行永远不会被隐藏（F-2）"的范围限定为**段级**——见 D-1。

### 3.2 永久可见（该藏没藏）

| 形态 | 判定 |
|---|---|
| 被 G1（用户手势接管）的组 | **设计使然**（fold.ts:2187 显式跳过；fold.ts:2274 `isTrusted` 才登记）——用户意图优先 |
| 直播段"最新一条"重试行 | **设计使然**（收敛语义） |
| 终态行（段级 / 直播窗口） | **设计使然**（F-2） |
| 官方组内滚动窗口内的行 | 插件**不可达**（§4.2：组三层只读；ISSUE 已声明"物理合并/隐藏组根"不可行） |
| 历史段的 last 组（跨段并排展开） | **设计缺口 = ISSUE 根因A**，本轮未修；实测 `g1=true g2=true`（两段各自的 last 都展开），见 D-3 |

---

## 4. C. §4.2 只读保护面核对（逐写点）

### 4.1 写点清单（本次新增/修改相关）

| 位置 | 写什么 | 是否可能落到保护节点 |
|---|---|---|
| `cleanupLegacyResidue` fold.ts:618/640/641 | `removeAttribute('style')`（空 style）/ `style.display = ''` | **否**：候选集虽含组三层与 `[hidden]`，但 640 只对"内联 display === 'none' 且（dirty 或 isNativeProtected）**且不在 controlled 集**"执行；新增的 `controlled` 排除正是本轮加的保护（V4 证明去掉它就会写出保护面语义的伤害） |
| `hideElement` fold.ts:2964-2967 | **不写任何 style**（仅 `desired.add`） | **否**（新增分支本身零写） |
| `hideElement` fold.ts:2997 / `restoreElement` 3021/3028 / fade onfinish 3123 | `style.display` | **否**：入口 `isNativeProtected` 早退；onfinish 回调路径另有同一判据守卫（fold.ts:3111-3122） |
| 段级 chip 的 `chip.style.display`（fold.ts:1416 等） | 插件自建元素 | 否 |
| `convergeLiveStatusRows`（经 hideElement/restoreElement） | 间接 | **否**：其定义域是 `statusRows`；但注意 **函数自身不校验** `isNativeProtected`，保护完全依赖 `hideElement` 入口（现状成立；若将来给 statusRows 的定义域扩到可能带 hidden 的节点，需在此显式加判据——建议项） |

### 4.2 实测（含**灵敏度正对照**，避免空集真）

第一次探针用的元素枚举方式（`document._all`）只覆盖插件自建节点，正对照不敏感 ⇒ 结论作废，已重做：

- **正对照**：把 `partition.last.style.display = "none"` 注入 bundle（模拟违规实现）→ 审计捕获 **3** 次组根写；
- **真实实现**：同一夹具 + 官方 `hidden` 翻转两轮 + 稳态 4 pass → 保护节点写 = **0**；非保护面写仅 `r1: ""→none`（1 次，首次收敛）。

> 说明：以上为桩级验证。ISSUE §"需真机验证清单"第 4 条（`processHidden` 时重试行 hidden 属性实况）仍未被真机数据覆盖，交付时应声明该边界（见 D-3）。

---

## 5. D. 性能

| 指标 | 实测 | 判定 |
|---|---|---|
| 稳态（无变化）显示写 | 4 个连续 pass **0 次**（真实实现审计） | 零写 ✅ |
| 稳态合成 click | 4 个连续 pass **0 次**（直播段两组夹具） | 零 click ✅ |
| `convergeLiveStatusRows` 单次成本 | 无状态行：**0.0022ms**（早退）；40 组 + 20 条重试行：**0.019ms** | 相对同夹具 18ms/pass（桩的 `querySelectorAll` 主导）≈ **0.1%** ✅ |
| 每次"新组出现"的额外 click | 过渡 pass 恰 **2** 次（1 次展开新 last + 1 次收起旧组），稳态 0 | 相对改动前的"每新组 1 次展开"，**净增 1 次 = 用户要求的收起本身**，线性无放大 ✅ |
| mutation 放大 | `driveGroups` 幂等早退发生在 `withMuting` 之前（fold.ts:2204-2210）⇒ 稳态不进入 muting 窗口、不产生 mutation | 无放大 ✅ |

> 方法学提示：探针 (e) 的 18ms/pass 主要来自桩的 `querySelectorAll` 全树线性扫描（真机是引擎原生选择器，量级不同），因此**绝对耗时不可外推**，只用它做"收敛占比"的相对量级判断。

---

## 6. E. 测试质量与鉴别力

### 6.1 场景与断言真实性

4 个新场景的断言均基于真实 DOM 状态（`style.display` / `aria-expanded` / chip 计数 / 写计数），无"只断言不变量"的空转：

- 缺口①场景含 F-5 前置（补 `turn-process` 座位使段级 chip 真正建出），使末段 P3 断言有鉴别力；
- F-2 场景显式维持"直播态"（running think 行），否则段会被判 `terminated` 而走错路径——该前置断言（`chips === 0`）本身即为夹具正确性的守卫；
- 根因B 场景用官方 disclosure 语义桩（click 切 `aria-expanded` + `beforematch`），与 `fold-017-safety` / `fold-chip-drive` 同构；
- D-1 场景用 `Object.defineProperty` 计数 display 写，能区分"值相同但发生了写"。

### 6.2 消融矩阵（全部实测，逐字节还原 + rebuild）

| 变体 | 改动 | 结果 |
|---|---|---|
| V1 | 删 `this.driveGroups(covered, false)` | **FAIL** 仅"根因B：新组出现后前一组被收起 (g1=true)" |
| V2 | 删终态行豁免（`|| isTerminalStatusRow(...)`） | **FAIL** 仅"F-2 直播段 turn-error 保留可见 (e1=none)" |
| V3 | 谓词换回 `!nativeManaged` | **FAIL** "R3-3 稳态零写 (first=3 now=11)" |
| V4 | 删 `cleanupLegacyResidue` 的 `controlled` 排除 | **FAIL** 2 条 D-1 断言（`r1=""`、写 1→2） |
| V5 | 在 chip 循环前**追加**一次 `restoreUnusedDisplays`（近似但非忠实的 F-A 回滚） | **FAIL** 3 条（R3-3 + 2 条 D-1）；**说明 V5 会污染 D-1 场景的判别力，故另做 V6** |
| V6 | **忠实**回滚 F-A（唯一调用点移回 chip 循环之前） | **FAIL** 3 条 + **全量 `run-all` 1 个文件失败** |

每次变体后均执行 `Copy-Item $env:TEMP\fold.ts.orig src\fold.ts` + `node build.mjs`，哈希回到基线（§ 头部三值）。

### 6.3 基线对照（防"新旧都通过"的空集真）

把 4 个新场景指向 **`git show HEAD:lib/client.js`**（旧 bundle，未改仓库文件，测试副本写在 `%TEMP%\p1-head-check\`）：

```
FAIL  直播期第 1 条重试行被收敛隐藏 (r1=)          ← 缺口①
FAIL  直播期第 2 条重试行被收敛隐藏 (r2=)
FAIL  R3-3 稳态零写 (first=-1 now=0)
FAIL  更新的重试行出现后，原最新一条让位隐藏 (r3=)
FAIL  更早的重试行仍保持隐藏（不回流）
FAIL  F-2 更早的重试行仍被收敛隐藏 (r1=)
FAIL  根因B：新组出现后前一组被收起 (g1=true)       ← 根因B
FAIL  D-1 前置：r1（非末条）已被插件隐藏 (r1=)      ← D-1
FAIL  D-1 元素获得原生 hidden 后… (r1=)
FAIL  D-1 原生 hidden 移除后插件隐藏仍在 (r1=)
[10 FAILURE(S)]
```

⇒ 新场景在旧实现上**确实失败**，且旧实现的既有断言仍全部通过 ⇒ 无空集真、无夹具漂移。

### 6.4 一处精确化（非缺陷）

F-2 场景的**正向**断言（`e1 === ''`）在旧 bundle 上也成立（旧代码同样不会隐藏段级状态行——它什么都没做），其鉴别力来自 **V2**（删豁免即失败）。也就是说它防的是"新代码引入的回归"，而不是"修复既有 bug"；这与场景注释的表述一致，但建议在测试注释中写明这一点，避免将来被误读为"该断言证明了旧实现的缺陷"。

---

## 7. F. 全量回归与构建守卫

| 项 | 结果 |
|---|---|
| `node test/run-all.mjs`（改动集，收口时刻） | **32 个测试文件全部通过，exit 0** |
| 同上（本次审查开始时基线） | 32/32，exit 0 |
| V6（F-A 回滚）期间全量 | **1 个测试文件失败** ⇒ F-A 归位是承重的（有回归网） |
| `build.mjs` 守卫 | host d.ts export guard: ok / client d.ts export guard: ok / host half syntax check: ok / client bundle syntax check: ok（`node --check` 双产物） |
| 构建幂等 | `node build.mjs` 重建后 `lib/client.js` 哈希与工作区一致（无源码/产物漂移） |

---

## 8. G. 残留问题（按严重度；均不阻断本轮交付）

### D-1【中低 · 既有缺陷同源，非本轮引入】F-2 的"终态行永不隐藏"只覆盖**段级**，块内形态仍会在直播期被藏

- 机制：`convergeLiveStatusRows` 的定义域是 `segment.statusRows`，而 `buildSegments` 把"块内状态行"从中剔除（fold.ts:4262-4263）⇒ 落在工具块里的 `turn-error` / `turn-max-tokens` 在直播期由 `reconcileBlock` 处置；当块可折叠时它随 chip 收起被 `display:none`（探针实测 `e1="none"`，有二级 chip 作入口，点击可恢复）。
- **HEAD 对照：同一夹具、同一序列，改动前终态逐字相同** ⇒ 不是本轮回归。
- 影响：函数注释中"把它们收敛掉等于掩盖错误"的论证在**块内**形态不成立；且存在 §3.1 描述的一次"隐藏→恢复"闪烁。
- 修法（可选，独立小改）：把 `isTerminalStatusRow` 豁免同样接到 `reconcileBlock` 的两个 restore 早退分支（fold.ts:2406-2419 的 `blockFoldableCount(block) < 2 || (working && hiddenCount === 0)`），终态行不计入 `blockFoldableCount` 并在该分支被恢复。

### D-2【低】两处注释不精确（会影响未来读者的推论）

1. fold.ts:1395-1396「官方直播期组头是可见的：grouped=true ⇒ 组头 hidden 为 false」——官方 `CHAT:2301`：`grouped = stepGrouping === "collapsed" || (stepGrouping === "history" && turnLocation?.status !== "open")`，`CHAT:2356 hidden: !grouped`。**detailed 档的当前开放回合 `grouped=false` ⇒ 组头 hidden**，此时被 `covered` 收起的组没有重开入口。应加档位限定（standard/compact 成立；detailed 开放回合不成立）。
2. fold.ts:2953-2963 的 D-1 注释称"登记的是已有意图…语义与修正前一致"：仅对"元素不在账本"的情形成立。元素**在账本中**时该分支会把意图写进 `desiredHidden`，从而在本 pass 让 `restoreUnusedDisplays` 不去清账（净效果良性：元素由 `hidden` 属性藏住、下一 pass 重判），但"与修正前一致"的措辞不够准确。

### D-3【低 · 交付口径】本轮**不含**问题⑤ 根因A、P3 缺口②③，且**未做真机验证**

- 根因A（跨段 last）实测仍在：`steering` 切段后两段各自的 last 并排展开（`g1=true g2=true`）。ISSUE 把它列为 P1 最高，本轮只修了根因B（同段内新组顶掉旧组）。
- P3 缺口②（`nativePassiveSegments` 段的状态行裸露）、缺口③（块内 `statusRows` 的无条件 restore）本轮未处理。
- ISSUE 的"需真机验证清单"（11 项，文档自述"修复动手前必须先过"）在本次审查中**未见任何真机证据**；本轮全部证据为桩级 + 官方 bundle 静态锚点。**交付时应明确声明：不得对外表述为"问题⑤ 已修"，且 §4.2/C 项结论需真机复核**（尤其第 4 条 processHidden 实况、第 8 条直播期组驱动）。

### D-4【信息】性能探针的绝对耗时不具外推性

`%TEMP%` 探针里的 ms 数字由桩的 `querySelectorAll` 主导（真机为引擎原生选择器），只用于相对占比判断，不可作为真机性能结论。

### D-5【低 · 建议】防御性判据

`convergeLiveStatusRows` 自身不校验 `isNativeProtected`，保护完全依赖 `hideElement` 入口与"statusRows 不带原生 hidden"这一真机前提（ISSUE 第 4 条待验证）。建议在该函数循环内加一行显式 `isNativeProtected` 跳过（零成本、与 `retainDisplayControl` 同款口径），把前提变成代码级保证。

---

## 9. 审查过程存档

- 消融实验：V1/V2/V3/V4/V5/V6，每次均 `node build.mjs` + `node test/fold-retry.test.mjs`（V6 另跑全量），随后从 `%TEMP%\fold.ts.orig` 还原并 rebuild；收口哈希与基线一致（§ 头部）。
- 探针（全部在 `%TEMP%`，未写入仓库、未新增/删除仓库文件）：`p1-final-probe.mjs`（受保护面/稳态/边界）、`probe2`（click 增量、跨段、节点搬移、会话切换、规模成本）、`probe3`（内存插桩计时，变体 bundle 亦在 `%TEMP%`）、`probe5/probe6/probe7/probe8/probe9/probe10/probe11/probe12`（块内状态行、开局重试链、二级 chip 入口、审计正对照、终态行恢复路径、HEAD 对照）、`p1-head-check\*`（旧 bundle 对照，`git show HEAD:lib/client.js` 导出，未改工作区文件）。
- 官方证据：均给语句锚点（`turnProcessAlwaysOpen` / `ChatNodeSeat.alwaysOpen` / `TurnProcessNodeView` CHAT:6229 / `ChatGroupSeat.grouped` CHAT:2301 / `TurnErrorNodeView`+`failureFrom`+`fallbackState` 的 start/update/buildViewNode 契约），便于 bundle 演进后复核。
- 自我纠错记录（留档防止重犯）：首次"§4.2 零写"审计因只枚举 `document._all`（`el()` 造的夹具元素不经 `document.createElement`）而产生**空集真**，正对照立刻暴露（违规注入未被捕获），已改为手工遍历 + 正对照重测（§4.2）。
