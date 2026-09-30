# dsh-auto-collapse 整体收口审查报告（冻结改动集 · 交付判定）

- 审查对象：工作区未提交改动集（6 文件，+968/-124，基线 diff stat 已在审查开始时记录）
- 审查日期：2026-10-01
- 审查方式：端到端通读 pass() 全流程 + 全部 style 写点核对 + 变异测试（28 个变异体，逐一回滚源码 → node build.mjs → 跑测试 → 逐字节恢复）+ 自建微基准/探针（写系统临时目录）
- 结论：**批准交付**。未发现阻断级（P1/P2）缺陷；发现 1 项死代码（P4）、若干文档过时（按要求只报告不改）与 2 项测试单点覆盖盲区（P4，双保险互为冗余，组合已被测试锁死）。

---

## 0. 交付门（F 项，全部实际运行）

| 门 | 结果 |
|---|---|
| `node build.mjs` | exit 0；四守卫全过（host d.ts export guard / client d.ts export guard / host half syntax check / client bundle syntax check） |
| `node test/run-all.mjs` | **32 个测试文件全部通过**，exit 0 |
| `npm run typecheck` | exit 0（tsc --noEmit） |
| 构建可复现性 | `node build.mjs` 前后 lib/client.js SHA256 恒等（1CEAA133…），构建确定性成立 |
| 恢复完整性 | 全部变异实验结束后：src/fold.ts=F922035B…、src/turn-metrics.ts=D415D1E5…、lib/client.js=1CEAA133…、lib/index.js=D385D568…，与实验前快照**逐字节一致**；`git diff --stat` 恒为 6 文件 +968/-124；仓库内无新增/残留文件（实验期间误写入 review/_tmp_mutate_log.txt 已删除，git status 复核干净） |

---

## A. 整体一致性（pass() 从头到尾通读）

实际执行顺序（fold.ts:973-1533）：

1. cleanupLegacyResidue(flow, controlledDisplay)（:984，D-1 排除项生效于一切决策前）
2. findBlocks / buildSegments / desiredHidden 建账（:994-1255）
3. completedKeys 循环 → 闭合段建 segmentStates（:1137-1227）
4. 失活 state 清理（:1229-1233）
5. 块级 reconcileBlock（:1257-1269，desiredHidden 登记 ①）
6. 一级中间循环 + 段级状态行循环（:1271-1325，liveStatusOwned 守卫在此；desiredHidden 登记 ②）
7. 无可见工作段清理（:1327-1345，retainDisplayControl 登记 ③）
8. cleanupStaleChips / placeProcessedRow（:1347-1348）
9. **段级组循环**（:1373-1484）：latestDrivableSegment 扫描 → effectiveCoveredOf（单一真源）→ driveGroups(last/covered) → 直播段分支（driveGroups(covered,false) + convergeLiveStatusRows）→ 闭合段分支（driveGroups → ensureSegmentChip → P3 状态行循环）
10. **restoreUnusedDisplays(desiredHidden)**（:1500，F-A 归位后位于 9 之后）
11. 孤儿 chip 清理 / 各账本清扫 / turn-status 替换（:1502-1532）

**判定：自洽，无互相抵消。** 关键交叉点逐一核实：

- **根因A × 根因B × 缺口① 的互斥性**：三者共用同一个 `covered` 变量（effectiveCoveredOf 产出）。`partition.covered`（= slice(0, lastVisible)）与 `partition.last`（= groups[lastVisible]）**构造上不相交**，所以最新段的 driveGroups([last],true)（:1400）与 driveGroups(covered,false)（:1436，仅 state===undefined 分支）目标态相反但集合不重叠。缺口① 的 convergeLiveStatusRows 与闭合段 P3 由 `state === undefined` 分支（:1410）严格二选一，同一 pass 内同一行只有一个写入者。
- **F-1/R2-1 守卫的完备性**：`liveStatusOwned = state===undefined && !nativePassiveSegments.has(key)`（:1315）。直播段 ⇒ true（中间循环跳过、由 converge 独占）；passive 段 ⇒ false 且段级循环开头 continue（:1382）⇒ 中间循环 restore（插件让路语义）。两个谓词拼起来穷尽（注释声称的"严格互补"核实成立）。变异 M25（删守卫）→ 每 pass 往返写 3→11 次，测试失败，证明该守卫承重。
- **F-A 位置**：restoreUnusedDisplays 现位于段级循环后，P3（:1480-1483）与 converge（:1437→:1924）的 desiredHidden 登记都能被本 pass 收尾看到。变异 M8（位置退回）→ 稳态写 3→11 + D-1 断言失败，证明位置承重。
- **驱动先于 chip 创建**（:1454-1456）：变异 M24（顺序退回）→ 历史段仅 1 组且 chip 建不出时驱动整体失效（2 断言失败），证明顺序承重。
- **R7 同源**：ensureSegmentChip 改为接收外部 covered 参数，chip 计数/摘要与 driveGroups 目标集合逐元素同一数组。变异 M23（退回内部旧口径）→ chip 称 2 实际 3，失败。
- **与 nativeCollapsed 的交互**（本批新增驱动是否会在原生行收起时误点击）：driveGroups 内部 `group.closest('[hidden]') !== null → continue`（:2249）挡住收起态原生行下的组，实测稳态 0 click（见 D 项）。
- **直播段滑窗**：探针实测 12 条重试行仅末条可见；追加第 13 条后仍仅 1 条可见且为最新（r11=none, r12=''），无回流、无震荡。

结论：**三个问题的修复无冲突、无对冲、无互相抵消**；此前单点审查发现的"阻断缺陷"（驱动晚于 chip）确已被正确修复并有测试锁定。

---

## B. 最坏路径穷举（永久 display:none / 永久可见）

### B1. 永久卡 display:none 的穷举（结论：不存在）

插件写的 display:none 全部走 hideElement 账本（originalDisplay WeakMap + controlledDisplay Set），恢复由三条机制兜底：每 pass 的 restoreUnusedDisplays（意图外即恢复）、stop()/switchFlow → restoreAllDisplays（:1569）、restoreElement 无"受保护放弃恢复"守卫（:3068-3074 显式说明撤销原因=防 B1 类永久破坏）。逐路径：

| # | 路径 | 结论 |
|---|---|---|
| 1 | 组三层（data-step-process/-body/-content）被写 display | 不可能：hideElement 入口 :3022 直接 return（不写不登记）；findBlocks :4575 把组当不透明容器（不当 host、不收内部行）；startFadeCollapse.onfinish :3173 写终态前**再判一次** isNativeProtected |
| 2 | 带 hidden 的元素被写 | 同上（:3022 一次判据含 `hasAttribute('hidden')`）；D-1 后唯一例外是"清遗留"：cleanupLegacyResidue 只在 inline==='none' 且（dirty 或 protected）时写 `''`——**只清除、只可能恢复可见**，且受控元素被排除（:637） |
| 3 | 意图消失但元素留在账本 | 不可能滞留：restoreUnusedDisplays 每 pass 对不在 desired 的账本元素 restoreElement（写回 original 并双删账本）；段消失/断连同样被清（含 pendingAnims 断连清扫 :1524-1526） |
| 4 | 在途动画卡死（fill:'forwards' 永不结束） | display 从未被写 none（动画路径不写终态），意图翻转时 restoreElement→cancelPendingSync 取消动画恢复自然布局；后台 tab 由 setTimeout 兜底 pass（:934-939） |
| 5 | 隐藏后元素**新获得**原生 hidden（D-1 场景） | 三重防护：cleanup 排除受控元素（:637，M6 杀死）、hideElement 保意图登记（:3023，M7 单删存活但见 B3）、convergeLiveStatusRows 保意图（:1916-1918，M20 单删存活但见 B3）；组合删除 M26 → 测试失败（锁定） |
| 6 | 插件卸载/会话切换 | stop() → switchFlow(null) → restoreAllDisplays 全量还原（不受保护判据影响） |
| 7 | React 重挂同一节点 | 账本按元素身份（WeakMap/Set），重挂后下一 pass 重新决策；不需要隐藏时被 restore |

### B2. 永久可见（该藏没藏）的穷举

| # | 路径 | 结论 |
|---|---|---|
| 1 | 直播段重试链 | 非末条全藏、末条保留、终态行（turn-error/turn-max-tokens）永不藏——**设计取舍**（保留失败线索与当前尝试进度），M18/M19 变异均被测试杀死，语义被锁定 |
| 2 | 闭合段状态行 | chip 收起=藏、chip 展开=恢复（P3）；无 chip（宿主缺失）时由一级折叠处置，不产生永久可见 |
| 3 | passive 段（verbose/aborted/error） | 插件完全不介入=全部原生可见，§5.10 设计；实测该段状态行被中间循环 restore（自愈） |
| 4 | 组该收没收 | 仅剩两条既有豁免：**userOwnedGroups（G1 用户接管）与 groupInert（>3 次驱动失败）**——即 ISSUE 报告明示不在本批范围的根因C；G1 是有意设计，inert 有 c2 死循环防护语义。新驱动路径（直播段 covered）不会新增 inert 积累：目标态与官方默认态一致，toDrive 阶段"已在目标态即复位"（:2262） |
| 5 | 历史段最后一组 | 已并入 covered 由 chip 收起（根因A）；chip 不可建时驱动仍执行（M24 修复点），用户可点组头重开（G1 不受损） |
| 6 | 变 verbose 后的陈旧段级 chip | **既有残留（非本批引入）**：段先建出 chip 后回合翻转为 alwaysOpen/disabled 时，段级循环开头 continue 不会 dropSegmentChip，插件 chip 留在原生座位内。review-gap1-round3.md:259 已记录同类 case（"仅记录，不阻塞"）。纯视觉噪音、不产生永久隐藏，触发需"会话中途改设置到 verbose"，判 P4 观察项 |

### B3. 两处新守卫的单点覆盖盲区（P4，非缺陷）

- M7：hideElement 的 `if (controlledDisplay.has(el)) desired.add(el)`（:3023）单删 → **全量 32 文件仍全绿**；
- M20：convergeLiveStatusRows 的受保护跳过+保意图（:1916-1918）单删 → 仍全绿；
- M26：**两处同时删** → D-1 场景 2 断言失败（锁定）。

机理：两条守卫在 D-1 测试路径上互为对方的备份（converge 不对受保护行调 hideElement，故 hideElement 分支不走；反之亦然）。行为语义正确、组合承重已被测试证明；只是**没有任何断言单独钉住其中一条**。若未来有人删掉其一，测试不会报警（只有同时删两条才会）。建议（不阻塞）：补一条直击单点的断言，或把两处合并为一个共用谓词。

---

## C. §4.2 只读保护面（全量 style 写点核对，44 处）

| 写点（fold.ts） | 目标 | 保护 |
|---|---|---|
| :640 cleanupLegacyResidue `display=''` | 组三层 ∪ [hidden] 候选 | **唯一写到受保护节点的点**：前置 `inline!=='none' continue`（:621）+ D-1 受控排除（:637）⇒ 只清插件遗留的 display:none、只可能恢复可见；为 W1-17/R19 验收第 9 条（组根 style.display 恒空串）的**明示例外**，非本批引入 |
| :3022-3055 hideElement | 任意调用方传入 | 入口 isNativeProtected 直接 return（受保护元素**进不了账本**）；账本双写 :3041-3042 在守卫之后 |
| :3181 startFadeCollapse.onfinish | 动画目标 | 写终态前二次 isNativeProtected 守卫（回调路径） |
| :3079/:3086 restoreElement | 仅账本内元素 | 只写回插件动手**前**的原值（清自身痕迹，从不新引入隐藏）；无受保护守卫是**有意的**（:3068-3074 注释，撤销过错误守卫） |
| :1458/:2416-2421/:2595/:2666-2670/:2989-2994 chip | 插件自建 button.dshcf-chip | 插件全资；挂载点为 turn-process 座位内部或块宿主，**绝不成为 flow 直接子级**（:2611-2642 硬守卫） |
| :2718/:2766-2767 merged-think 行 | 插件自建 button.dshcf-merged-think | 插件全资 |
| :2859-2861/:2874-2876/:2907-2908 merged-body | 插件自建 div.dshcf-merged-body（:2814-2819 类名校验） | 插件全资 |
| :3134-3137 clearCollapseLock | 仅 kind:'height' 的动画元素（= merged-body，:2869/:2916） | 插件全资 |
| :5171/:5177/:5185 chip 内 code/failure/sep | ensureChip 自建 span（:2587-2591） | 插件全资 |
| :1459/:5169/:5182/:5213 classList | 插件自建元素 / dshcf-* 类 | 插件命名空间 |

**本批新增代码（convergeLiveStatusRows / effectiveCoveredOf / liveStatusOwned / driveGroups 调用点）对受保护节点零 style 写**：仅有的"写"是 `desiredHidden.add()`（内部 Set 记账，非 DOM 写），且仅当元素已在账本（插件此前确实写过）。`button[data-turn-process]` 本身无任何 style 写点（指标 span 追加为 §4.2 硬约束 2 的明示例外，且经 syncNativeDisclosure 只动自建 span）。

结论：**通过**。isNativeProtected 的实现（:4260-4266）覆盖组三层 + hidden 三类；其 docstring 第三条（button[data-turn-process] 元素本身）并未体现在函数体里，但全库核实**没有任何写点会命中该按钮的 style**（唯一交互是 appendChild 指标 span 与 readNativeTurnCounts 只读属性），故为注释与实现的表述差（P4 级文档瑕疵，非保护面缺口）。

---

## D. 性能（自建微基准，写临时目录）

夹具：20 个官方组（含 turn-process 座位、工具行）+ 闭合；另一夹具 20 组 + 10 条直播重试行。计点方式：对全部元素的 style.display 挂计数访问器 + 包裹全部 button.click。

| 场景 | 5 个稳态 pass 的 display 写 | click | 单 pass 挂钟 |
|---|---|---|---|
| 闭合段 20 组（稳态） | **0** | **0** | ≈7.2 ms（桩环境，含测试桩 O(n) 全树扫描；真机由 React 渲染主导，此值仅作代码路径成本量级参考） |
| 直播段 20 组 + 10 重试行（稳态） | **0** | **0** | 同上量级 |

新增逻辑的每 pass 成本量级：cleanupLegacyResidue 多一次 Set.has（O(候选)）；convergeLiveStatusRows 为 O(statusRows) 的末条选择 + O(statusRows) 幂等写循环；根因A 的 latestDrivableSegment 为 O(segments) 一次扫描（groupPartitionOf 每 pass 本就要算）；根因B 复用 driveGroups（现值==目标即早退 + 失败计数复位）。**稳态零写、零 click 达成**（R3-3 断言亦已在测试中锁定该性质）。

---

## E. 测试鉴别力（实际回滚验证 ≥3 项的要求，共执行 28 个变异）

方法：变异源码 → `node build.mjs`（fold.ts 类）或直跑（turn-metrics.ts 类）→ 跑对应测试 → 逐字节恢复 → 重建。全部变异的测试命令均真实执行。

**被杀死的变异（对应修复点均有真实鉴别力）**：

| 变异 | 杀伤断言 |
|---|---|
| M1 移除缺口①收敛（convergeLiveStatusRows 整体） | 9 条（直播期收敛、F-2、D-1 前置等） |
| M2 覆盖集退回"所有段都含 last 口径"（根因A） | 4 条（根因A 主断言 + 阻断缺陷 + R7×2） |
| M3 移除直播段 driveGroups(covered,false)（根因B） | 1 条（根因B 主断言） |
| M4 liveStatusOwned 恒 false（F-1） | 3 条（R3-3 稳态写 3→11、D-1×2） |
| M5 守卫误用 nativeManaged（R2-1） | 1 条（R3-3 写 3→11）——证明"只有写次数能区分"的注释属实，该断言是真鉴别力 |
| M6 cleanupLegacyResidue 不排除受控元素（D-1） | 2 条（D-1 主断言 + 零写） |
| M8 restoreUnusedDisplays 位置退回（F-A） | 3 条（R3-3 + D-1×2） |
| M9 ttft 移出 settled 门控 | 1 条（P3-B running 不计入） |
| M10 ttft 移回 usage 早退之后 | 1 条（P2-1 无 usage 步 =250 而非 100） |
| M11 decodeMs 退回严格大于（P2-2） | 1 条（零时长步 1099 而非 100） |
| M12 turnAcc ttft 不合并（P3-1） | 1 条（整回合 ttft=200） |
| M13 tps 去 billed 兜底 | 2 条 |
| M14 ttft 去 billed 兜底 | 1 条 |
| M18 收敛不留末条 | 3 条 |
| M19 终态行豁免移除（F-2） | 1 条 |
| M23 chip 用旧口径（R7 谎报） | 1 条（chip=2 vs actual=3） |
| M24 驱动放回 chip 创建之后（阻断缺陷） | 2 条 |
| M25 中间循环不跳过直播段状态行 | 3 条 |
| M26 D-1b+D-5 组合删除 | 2 条（D-1 场景） |

**存活（无断言失败）**：M7、M20（单点，见 B3——组合被杀，判定为可接受的双保险冗余，非零覆盖）。

结论：**6 个新场景 + metrics 补充用例整体有真实鉴别力**，其中根因A、根因B、缺口①、F-1、R2-1、F-A、阻断缺陷、R7、D-1、F-2、问题① 的 ttft settled 门控 / usage 早退顺序 / 钳零 / turnAcc 合并 / billed 兜底共 19 个修复点逐一验证"回滚必 FAIL"。

---

## G. 文档一致性（只报告，未改）

1. **behavior-spec.md:186-187 与实现直接矛盾（最值得修的一处）**：仍写"额外要求 completed > firstToken 严格正时长，使零时长步**整步排除**""官方把它计入累加但贡献 0，本插件整步跳过"——P2-2 修复后语义已反转（decodeMs 钳零、outputTokens 计入分子、与官方同源）。下一位维护者按此文档会把 `>=` 改回 `>`（有 M11 测试兜底，会立刻 FAIL，但文档本身误导）。
2. **behavior-spec.md:160**：ttft"rc.1 直接读 turn-tail.data.ttftMs"已过时——现自算逐 step 平均优先、billed 仅兜底；":161 把 ttftMs 列为回合级数据" 同样过时（现在每个有 settled 步的分组都有自算值）。
3. **behavior-spec.md:185**："turn-tail 一经出现即以其权威值覆盖"已过时——现自算恒优先。
4. **behavior-spec.md:184**："保持官方 deriveTurnMetrics 的该轮聚合吞吐语义"大体仍对，但数据来源描述未更新。
5. **behavior-spec.md:239-243（F4）**：未反映根因A 的流粒度语义（"最后一组恒展开"现只在最新可驱动段兑现，历史段 last 并入 covered）。建议补一句，避免与"16 组中最后一组=true"的单段实测证据混淆。
6. **README.md:45-46 / README.en.md:42-43**：tok/s 描述仍是"turn-tail 缺席时按官方口径推导"的旧优先级（现自算优先于 turn-tail 权威值）。
7. **README.md:144 / :202**：`groupPartitionOf（covered=chip 代表、last=恒展开）`未更新为 effectiveCoveredOf 单一真源 + 流粒度 last。
8. **ADAPTATION_PLAN_0.1.7.md:263/286-292 等**：历史计划文档，"chip 覆盖除最后一组外的全部内容"与现行语义有偏差（历史文档，可不改）。
9. **fold.ts:4253（isNativeProtected docstring）**：第三条"button[data-turn-process] 元素本身"未体现在函数体（见 C 项，无实际写点，表述差）。
10. **fold.ts:622-626 注释**："`dirty.has(el)` 分支对候选集恒为假"——D-1 之后，"曾被插件隐藏、后来获得 hidden"的元素可使该分支为真（随后被 :637 controlled 排除）。结论（该分支无独立效果）仍成立，理由表述过时（P4）。

---

## H. 其他不宜交付的问题

**无阻断项。** 非阻断清单（按严重度）：

1. **P3｜文档矛盾（G-1）**：behavior-spec 零时长步语义与实现相反。风险=误导后续维护，测试已兜底。
2. **P4｜死代码**：`private effectiveCoveredOf(snapshot, isLatestSegment)`（fold.ts:1725-1727）无任何调用点（段循环用的是模块级函数 :4113；ensureSegmentChip 改收参数后不再经过它）。tsconfig 未开 noUnusedLocals 故 typecheck 不报。建议删除或改为唯一入口（后者更符合"单一真源"注释的意图）。
3. **P4｜测试单点盲区**（B3）：M7/M20 单删存活、组合删除才被杀。建议补单点断言或合并谓词。
4. **P4｜cleanupLegacyResidue 的 controlled 参数可选**（:603）：当前唯一调用点已传；未来新调用点漏传会静默退回 D-1 往返写。建议改必填。
5. **P4｜isNativeProtected docstring 与函数体的表述差**（C 项）。
6. **P4｜既有残留（非本批引入，已有在案记录）**：段级 chip 建出后回合翻转为 passive 时不回收（B2-6）；根因C（userOwned/inert 永久豁免）仍在 ISSUE 清单未修——本批范围明确不含，交付不受影响，但问题⑤的"彻底消失"仍以根因C 为残差。
7. **观察项｜直播段收起驱动只能走 click**：直播期 covered 组收起无 beforematch 通道（展开才有），理论上官方反复置 true 时每 pass 一次 click；实测稳态 0 click，且有 inert 防护兜底。与 ISSUE 修复方向 2 的风险提示一致，已被"目标态==官方默认态"化解。

---

## 最终判定

**批准交付。** 理由：
- 三个问题的修复经 28 个变异体交叉验证均有真实鉴别力，无互相抵消；
- §4.2 只读保护面全量核对通过，本批新增代码对受保护节点零 style 写；
- 最坏路径穷举未发现任何"永久 display:none / 永久可见"新路径；仅存的永久性豁免（G1/inert）为既有设计且在案；
- 稳态零写、零 click 实测达成；
- 32/32 测试、typecheck、四守卫全绿，构建可复现，改动集逐字节恢复如初。

建议合入后按 G 项清单做一次文档同步（优先 behavior-spec.md:186-187 的零时长步语义），并顺手清掉 P4 的死代码与可选参数。
