# P3 缺口① 修复·第三轮复审（R2-1 / R2-2 / F-2 独立验证）

- 审查对象（未提交工作区改动）：`src/fold.ts`、`test/fold-retry.test.mjs`、`lib/client.js`（build 产物）
- 审查基线（开始 == 结束，逐字节一致；build 幂等）：
  - `src/fold.ts` = `9A5043CEC65710F68C6342FAB55B16A7324C0DF8A882CE4265973562A69B571B`
  - `lib/client.js` = `F4FFFD2F7FBEA105D1A82C8489CEAC0E6CA1D650EF26378C54CE4F148E58E8F3`
  - `test/fold-retry.test.mjs` = `18FC2240B6F06ECCEBB6D6378D5E1929EE4F613E31D60B5807A470E4C4D79B21`
  - 差异规模：`src/fold.ts +105/−15`、`test/fold-retry.test.mjs +139/−0`、`lib/client.js +48/−4`
- 方法：源码逐行推演 + **插桩探针**（在临时目录对 `lib/client.js` 做内存文本插桩：pass 相位标记、中间循环/收敛/P3 三处调用点打点、逐元素 `style.display` 写代理并抓调用栈），探针与变体 bundle 全部写在 `%TEMP%\dsh-review-gap1-r3\`，**未写入仓库**；另做「不触碰仓库」的变体 bundle 鉴别力矩阵 + 一次真实 `src` 改动→rebuild→测试→还原实验。
- 约束遵守：未启动次级 subagent，未调用 memory/skill_manage，未 git commit/push/checkout/reset；仓库唯一写入为本文件；鉴别力实验后 `src/fold.ts` 已还原并 `node build.mjs`，三文件哈希与开始时一致，`git status --porcelain` 仍只有三个已修改文件（+ 原有未跟踪项）。

---

## 0. 结论摘要

| 项 | 判定 |
|---|---|
| **R2-1**（高·功能，直播段双写） | **已修好**。插桩实测：nativeManaged 命中形态下稳态 **0 次** display 写；同夹具回退到旧谓词则为 **4 次/pass**，栈为 `pass<anonymous>:2113`（中间循环 else）→ `convergeLiveStatusRows<anonymous>:2518`，正是 `none→""→none` 往返 |
| **R2-2**（中·注释可复核性） | **基本修好，残留 1 处错行号**：`src/fold.ts:1417` 的 `（上方 1395-1398）` 指向 INDEPENDENT 根因叙述，真值 **1408-1411**（登记在 1410）。其余新注释的语句锚点**全部真实且语义相符** |
| **F-2**（终态行永不隐藏） | **生效且鉴别力确证**。插桩见到 `conv-branch err{terminal}` → `conv-restore err` → `WRITE err: "none"->""`；删掉该分支后新用例 **FAIL（e1=none）** |
| F-A（restoreUnusedDisplays 位置） | **仍成立，且本轮起是承重的**：挪回 chip 循环之前 → 闭合段 6 写/pass 往返、直播段 4 写/pass；新位置稳态 0 写 |
| 互补性（新谓词 vs 收敛门控） | **严格互补**（`state===undefined` 域内），实测无「双处置冲突」、无「都不处置」留下卡死 |
| A. 全量回归 | **32/32 全绿**（exit 0），改动前/后各跑一次 |
| B. 永久卡 display:none | **未发现**（逐路径穷举 + 探针实测，见 §5） |
| C. 二轮 F-A 结论 | **仍成立**（见 §6） |

**批准状态：可以合入**（无功能性阻断项）。残留 1 处低危注释行号 + 若干可选改进见 §8。

---

## 1. R2-1 独立验证（插桩实测）

### 1.1 谓词与门控的静态事实

- `liveStatusOwned = state === undefined && !nativePassiveSegments.has(segment.key)`（`src/fold.ts:1305`）
- 收敛调用门控：段级循环开头 `if (nativePassiveSegments.has(segment.key)) continue`（`src/fold.ts:1349`）
- 事实链：`nativePassiveTurns ⊆ nativeTurns`（`1033` 无条件加、`1038` 加 passive）⇒ `nativeManaged ⟹ keys.turn ∈ nativeTurns`（`1048`）⇒ **passive ⊆ nativeManaged**；`nativePassiveSegments` 的收集（`1102/1109`）只加 passive 段。
  因此对 `state === undefined` 的段：**非 passive ⟺ 会被 `convergeLiveStatusRows` 处置**，二者恰好穷尽；passive 段在收敛循环被 skip，由中间循环 restore 独占。

### 1.2 直播段（nativeManaged 命中形态）实测：无 `none→""→none`

夹具（与二轮要求一致：带 turn-process 座位 + 每 flow 节点带 `data-chat-turn`，对齐真机 chat bundle `client.js:1766`）：user(带 turn)→turn-process 座位`button[data-turn-process=1][aria-expanded=false]`→3 组官方工具组，组间夹 r1/r2/r3 三条 model-retry→进行中正文。

fixed（当前代码）稳态日志（每 token 一次 pass，逐元素 display 写代理）：

```
[pass] PASS
  guard {state=false nm=true passive=false live=true chipOwns=false collapse=false}
  converge
  conv-branch r1 {terminal} -> conv-hide r1
  conv-branch r2 {terminal} -> conv-hide r2
  conv-branch r3 {last}     -> conv-restore r3
  restoreUnused
steady writes: pass2=0 pass3=0   display: r1="none" r2="none" r3=""
RESULT NO-DOUBLE-WRITE
```

同一夹具、仅把谓词换回 `!nativeManaged`（变体 bundle，不改仓库）：

```
  guard {state=false nm=true passive=false live=false chipOwns=false collapse=false}
  mid-restore r1 -> WRITE r1.display: "none" -> ""
       at FoldController.restoreElement (<anonymous>:3353) <- FoldController.pass (<anonymous>:2113)
  ...
  converge
  conv-branch r1 {terminal} -> conv-hide r1 -> WRITE r1.display: "" -> "none"
       at FoldController.hideElement (<anonymous>:3341) <- FoldController.convergeLiveStatusRows (<anonymous>:2518)
steady writes: pass2=4 pass3=0
RESULT DOUBLE-WRITE(4 writes)
```

⇒ 二轮 R2-1 描述的写序在本轮夹具下**可复现**（证明探针敏感、夹具命中），当前代码**已消除**：中间循环不再触碰 live 段的 `statusRows`，该段状态行由 `convergeLiveStatusRows` **单一来源**处置。同时确认守卫输入 `nm=true`（旧谓词下 `live=false`）——即旧代码在**该形态**下守卫确实失效。

### 1.3 passive 段（verbose/aborted/error）行为未被破坏

夹具：turn-process 座位为 `aria-expanded=true + disabled`（verbose 形态），组间夹重试行。

```
guard {state=false nm=true passive=true live=false chipOwns=false collapse=false}
  mid-restore r1 / mid-restore r2      ← 只有中间循环，收敛循环不参与
steady writes=0   display: r1="" r2=""  segChip=0
RESULT PASSIVE-UNTOUCHED
```

- 由 `collapse = state && !expanded && !nativeManaged`，passive ⟹ nativeManaged ⟹ `collapse=false` ⟹ 中间循环走 **restore**（不是 hide）；从没被插件写过的行 `originalDisplay` 无账本 ⇒ `restoreElement` 早退、**零 display 写** ⇒ 完全符合 §5.10「插件完全不介入」。本轮谓词变化对 passive 段**无行为差异**（旧谓词下 passive 也是 `live=false`）。
- 直播→被动迁移实测（turn-process 座位从 false 翻到 `true+disabled`）：`mid-restore r1/r2` 把先前被收敛隐藏的行恢复回 `""`，**不卡隐藏**。

### 1.4 严格互补性：逐分支调用实测矩阵

探针在三个处置点分别打点，跨全部夹具（直播/passive/闭合/展开/迁移）得到：

| 段形态 | 中间循环 | 收敛循环 | 实测 |
|---|---|---|---|
| `state===undefined` 且非 passive（含 nativeManaged 命中） | **跳过**（`live=true`） | `convergeLiveStatusRows` 独占 | 仅见 `converge/conv-*`，无 `mid-*`，稳态 0 写 ✅ |
| passive（无论有无 state） | **处置**（`collapse=false` ⇒ restore，通常零写） | `continue` 跳过 | 仅见 `mid-restore` + `chip-loop-passive-skip` ✅ |
| 闭合 + chip 收起（`chipOwnsStatus=true`） | **跳过** | P3 hide | 仅见 `p3-hide` ✅ |
| 闭合 + chip 展开（`groupsExpanded=true`） | 处置（restore） | P3 restore | 两者同向、第二次落到已清账本 ⇒ 无写 ✅ |
| 闭合 + chip 未建出（`chip===null`） | 处置（collapse ? hide : restore） | `chip===null → continue` | 仅中间循环 ✅ |

**结论**：`state===undefined` 域内两者严格互补（无「同时处置且意图相反」）；其余分支的“双处置”只在**同向 restore** 出现且第二次是账本空操作（不产生 display 写）。唯一理论死角（chip 非空 + `chipOwnsStatus` + 转 passive ⇒ 两者皆不登记）**实测被 `restoreUnusedDisplays` 同一 pass 兜底恢复**，不构成卡死（见 §5.4）。

---

## 2. R2-2 复核（注释可复核性）

### 2.1 已修好

- `fold.ts:4106/4131/4167`、`（上方 1349）`、`（下方 1382）`、`见 1377-1378`、`range.filter（4121）` **全部消失**；`src/fold.ts` 内已无任何 `fold.ts:NNN` 形式的自引用（grep 验证）。
- 改为语句锚点的引用**逐条核对为真实且语义相符**：
  - `1363-1364`：`if (!snapshot.closed && !snapshot.terminated) continue`（pass 中 completedKeys 循环）→ 实存于 `1130`（`1131` 是紧随的第二道 continue）✓
  - `1797`：「机制见调用点注释（state 门控…）」✓
  - `1803-1808`：`buildSegments` 的 `flowItems(flow)`（`4150`）→ `items.slice`（`4175`）→ `range.filter`（`4211`）保序；「该 filter 的定义域 = 块内 statusRows 的补集」→ `4210`（`inBlockStatus`）+`4211` ✓
  - `1298`：CHAT:6229 `if (turn?.status !== "closed") return null` → 真机 bundle `dsh-client-ui-chat/lib/client.js:6229` **逐字一致** ✓（`6246` 亦确认 `data-turn-process = node.data.turn`）
  - `1392-1395`：INDEPENDENT 锚点 → 同 bundle `10633` `const INDEPENDENT = new Set([`、`10797` `if (INDEPENDENT.has(node.kind))`、`10798` `flush(true)` ✓
  - 抽查 `CHAT:6185/6186/6149/1558-1563/2301/1606-1627/2313-2319/4582-4605` 均能在 bundle 中定位到相符语句 ✓

### 2.2 残留 1 处错行号（R3-1）

`src/fold.ts:1417`：

```
1416  // 必须放在段级 chip 循环**之后**（本处）：P3 对块外状态行的 desiredHidden
1417  // 登记发生在该循环里（上方 1395-1398），若本调用先于它执行，...
```

- `1395-1398` 实际是 INDEPENDENT/flush 的**根因叙述注释**（无代码语义）。
- 真值：**`1408-1411`**（`for (const status of segment.statusRows) {` … `}`），`desiredHidden` 登记发生在 **`1410`** 的 `hideElement(status, desiredHidden, segmentAnimate)`。
- 该注释是**本轮改写的**（HEAD 原文为 `（fold.ts:1384-1387）`，同样已漂移），属 R2-2 同类残余，而 R2-2 正是本轮要求修掉的项。定级**低**（仅注释；描述文字本身正确，唯行号过时），但建议合入前顺手改成语句锚点，例如「P3 对块外状态行的 `hideElement(status, desiredHidden, …)` 登记」。

### 2.3 其他引用

- `test/fold-retry.test.mjs:263`（`fold.ts:1130-1131`）与 `:313`（`fold.ts:1208-1212`）**当前均为正确行**（逐行核对），但同为绝对行号、同样会漂移，建议与 R2-2 一并改语句锚点（R3-2）。

---

## 3. F-2 独立验证

### 3.1 分支真的生效（不是空操作）

构造真实恢复路径：终态行**先被块级二级 chip 隐藏**（terminated 行紧跟已开启块 ⇒ 进 `block.statusRows`），随后插入一条正文消息把该行**迁移为块外**（进 `segment.statusRows`，live 段仍 running）。插桩日志：

```
guard {state=false nm=false passive=false live=true ...}
  converge
  conv-branch err {terminal} -> conv-restore err
  WRITE err.display: "none" -> ""   at FoldController.restoreElement (<anonymous>:3353)
                                       <- FoldController.convergeLiveStatusRows (<anonymous>:2515)
RESULT F2-ERR-VISIBLE
```

即 `restoreElement` 确实被终态行调用**且真的把 `none` 改回可见**（账本命中，非早退）。同一夹具去掉豁免后：

```
  conv-branch err {terminal} -> conv-hide err     （两次 pass）
P2(after migrate): err="none"  →  RESULT F2-ERR-HIDDEN
```

### 3.2 新用例鉴别力（任务要求项）——确证

两种方式各做一次：

1. **真实改 src**：删除 `|| isTerminalStatusRow(rows[i])` → `node build.mjs` → `node test/fold-retry.test.mjs`：

```
=== 场景: 直播段终态行不被重试链收敛隐藏（F-2） ===
PASS  F-2 前置：段仍为直播态（无段级 chip）
FAIL  F-2 直播段 turn-error 保留可见（不被收敛隐藏）  (e1=none)
PASS  F-2 最新重试行仍保留（收敛正常工作）
PASS  F-2 更早的重试行仍被收敛隐藏
[1 FAILURE(S)]   [exit=1]
```

随后已还原 + rebuild，哈希回到基线。

2. **变体 bundle 矩阵**（复制测试到临时目录、用 `DSHCF_BUNDLE` 指向变体，仓库零改动）：

| 变体 | 结果 | 说明 |
|---|---|---|
| `fixed` | ALL PASS | 基线 |
| `noF2`（去终态豁免） | **1 FAIL**：`F-2 直播段 turn-error 保留可见 (e1=none)` | 该用例对 F-2 有鉴别力 ✓ |
| `oldpred`（R2-1 旧谓词） | **ALL PASS** | ⚠ 用例**测不到 R2-1**（见 R3-3） |
| `noconverge`（删直播收敛） | **5 FAIL**（含 F-2 场景的「更早的重试行仍被收敛隐藏」） | 缺口① 用例鉴别力仍在 ✓ |
| `famove`（F-A 挪回旧位置） | ALL PASS | F-A 位置无测试覆盖（与二轮一致） |

### 3.3 F-2 与 P3 的关系（任务问项）

实测（直播含终态行 + running 行保持 live → 加 turn-tail 闭合）：

| 阶段 | err（turn-error） | r1 | r2 |
|---|---|---|---|
| 直播稳态 | `""` 可见 | `none` | `""`（最后一条） |
| 闭合后（chip 收起） | `none` | `none` | `none` |
| 点开段级 chip 后 | `""` 恢复 | `""` 恢复 | `""` 恢复 |

- **F-2 只作用于直播窗口**；P3（`1408-1411`）对终态行**没有**豁免，闭合后 chip 收起即全藏。
- **判定：可接受**。理由：(a) 这是既有闭合语义，已被既有用例锁定（`turn-error 终态后随段折叠隐藏`、`折叠后 turn-error 行随段隐藏`、`二级展开后 turn-error 行恢复显示`），本轮未改；(b) 可逆——chip 展开即恢复（实测 ↑）；(c) 真机最常见的错误/中止回合**根本不走 P3**：alwaysOpen 回合的原生 turn-process 行为 `aria-expanded=true + disabled` ⇒ passive ⇒ chip 循环 continue、中间循环全量 restore ⇒ 错误行保持可见。故「直播期保留、闭合后收进折叠」是一致且不丢信息的策略。

### 3.4 「非末条终态行永久可见」是否造成新症状

- F-2 的 `restoreElement` 只对**插件自己隐藏过**的行有效（`originalDisplay` 无账本即早退），因此它**不会**凭空让行常显；只保证「该行一旦被收敛路径考虑，不会被隐藏」。
- 终态行低频（每回合至多一条），直播期常显正是设计目标；闭合后由 P3/一级折叠收起（§3.3）。探针 G/H/C 未观察到堆叠、抖动或卡死。
- 记录一处**既有**范围限制（非本轮引入、低）：F-2 只保护**段级**（块外）终态行；被 findBlocks 收进 `block.statusRows` 的终态行仍会随块级 chip 收起（可展开找回）。

---

## 4. A. 全量回归

```
node test/run-all.mjs   →   [run-all] 32 个测试文件全部通过   (exit 0)
```

改动前后各跑一次（一次在基线、一次在鉴别力实验还原 + rebuild 之后），均 32/32。`node build.mjs` 幂等：重跑后三文件哈希与基线一致。

---

## 5. B. 是否存在永久卡在 `display:none` 的路径

**未发现。** 逐路径：

1. **直播收敛路径**：只藏「非末条且非终态」的 retry 行，且**每 pass 重算** `lastConnected`；有新行到达时旧行让位、末条始终 restore（repo 用例断言 r3→r4 让位；探针 A 稳态 0 写）。
2. **闭合路径**（一级收起 / P3 / 块级 chip）：隐藏是期望态，且每个隐藏元素都有展开入口（段级 chip、一级「已处理」行或原生 disclosure 行）；探针 E/G + 既有用例均断言可恢复。
3. **被动段**：中间循环每 pass restore（探针 B 零写、行保持可见；探针 F 迁移后恢复）。
4. **理论死角**（`chipOwnsStatus=true` 且该段转 passive ⇒ 中间循环跳过、收敛循环 continue）：构造实测（chip 已建出后把 turn-process 行翻成 `aria-expanded=true+disabled`）→ 同一 pass 由 **`restoreUnusedDisplays`** 兜底把行恢复为可见（日志 pass3：`chip-loop-passive-skip` + `WRITE r1: "none"->""`），此后稳态零写。**不卡死**，且结果符合 passive「不介入」语义。
5. **账本语义**：`hideElement` 先登记 `desired` 再写；`restoreUnusedDisplays`（新位置 `1427`，在段级循环之后）恢复一切「本 pass 未被登记却仍在受控账本」的元素 ⇒ 「意外长期隐藏」要求某条路径**持续**登记它，而持续登记的只有上述有意为之的 owner。`stop()`/`switchFlow` 另有 `restoreAllDisplays` 全量还原。

---

## 6. C. 二轮「F-A 位置归位已合格」在本轮是否仍成立

**仍成立，且本轮起变成承重改动。** 同夹具 A/B（仅改调用点位置，变体 bundle）：

| 位置 | 夹具 | 稳态 display 写 |
|---|---|---|
| **当前（段级 loop 之后，`1427`）** | 闭合段 + chip | **0 次/pass**（`p3-hide` ×3，无写） |
| 旧位置（chip 循环之前） | 闭合段 + chip | **6 次/pass**：`restoreUnusedDisplays` 先 `none→""` ×3，随后 P3 `""→none` ×3 |
| 旧位置 | 直播段（fixed 谓词） | **4 次/pass**（`none→""→none` ×2） |

⇒ 归位方向正确、目的达成，且与 R2-1 合力才把两条路径的双写同时归零。未发现因该移动而「漏恢复」的元素（二轮 §2 影响面分析在本轮代码上复核仍成立：登记点 ①②④⑤ 全部早于 `1427` 或在其后不写 display）。

---

## 7. D. 缺陷清单（按严重度）

### R3-1【低·注释】R2-2 残留一处错行号
- 位置：`src/fold.ts:1417`，`（上方 1395-1398）` → 真值 **`1408-1411`**（登记在 `1410`）。
- 影响：纯注释可复核性（该段文字描述正确）。建议改语句锚点。

### R3-2【低·测试可维护】测试内仍有会漂移的绝对行号
- `test/fold-retry.test.mjs:263`（`fold.ts:1130-1131`）、`:313`（`fold.ts:1208-1212`）当前**正确**，但同属绝对行号，建议一并改语句锚点。

### R3-3【低·测试覆盖】R2-1 修复无回归用例
- 变体矩阵显示：把谓词换回 `!nativeManaged`（`oldpred`）后**全套 32 个测试文件仍全绿**，新用例也 ALL PASS ⇒ 未来回归到旧谓词不会被任何测试拦住。
- 可低成本补网：给新用例的 live 夹具的**段候选元素**（boundary/finalStep）加 `data-chat-turn="1"`（真机 chat bundle `1766` 对每个 flowItem 都写该属性），即复刻本轮探针夹具；该夹具下旧谓词会产生 4 写/pass，可被断言抓住（例如断言稳态 pass 对该段状态行零 display 写，或断言不出现 `""` 往返）。

### R3-4【信息·设计】F-2 的注释只写了直播窗口
- 注释未说明「闭合后终态行由 P3/一级折叠收起（可展开找回）」。建议补一句，避免后来者误以为终态行**永不**隐藏（实测闭合后确实会藏）。

### R3-5【低·既有，非本轮引入】passive + 残留 chip 的理论死角
- 触发条件：chip 已建出后，该回合才变成 alwaysOpen/disabled（真机需「可折叠闭合」翻成「恒展开」，如设置中途切换或 aborted 状态倒灌）。此时该 pass 中间循环与收敛循环都不登记其状态行，靠 `restoreUnusedDisplays` 兜底（结果正确、无卡死、无写风暴）。仅记录，不阻塞。

### R3-6【低·可选，二轮 R2-3 未处理】新 `makeGroup` 桩与 fold-017 语义不同
- 本文件的桩在 `click` 处理器末尾派发 `beforematch`，而 `fold-017-safety` 是**两个独立监听器**。本轮新增断言只驱动插件自建的 `.dshcf-seg-chip`（不驱动组按钮收起），**当前无行为差异**；一旦新增「驱动组收起」类断言即会静默失效。维持二轮判定：可选。

### R3-7【流程】审查期间源码仍在变动
- 本轮基线哈希与二轮不同属预期（代码已改）；建议合入前冻结哈希并在 PR 描述里贴出，避免行号引用互相不可印证（也是建议弃用绝对行号的现实理由）。

---

## 8. 放行建议

| 优先级 | 事项 |
|---|---|
| 合入前建议（1 行注释） | R3-1：`1417` 的 `1395-1398` → 语句锚点（或 `1408-1411`） |
| 可选（质量） | R3-3 补 R2-1 回归断言；R3-2 测试注释改语句锚点；R3-4 F-2 注释补闭合后行为 |
| 仅记录 | R3-5（既有死角，已兜底）、R3-6（桩语义，二轮已判可选）、R3-7（流程） |

**批准状态：批准合入。** R2-1 经插桩实测确认真实修复（稳态 0 写、对照变体 4 写/pass），F-2 生效且新用例有鉴别力，F-A 位置归位仍成立并在本轮起承重，全量回归 32/32；无功能性阻断项，无永久卡 `display:none` 路径。
