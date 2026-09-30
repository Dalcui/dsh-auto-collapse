# 独立复核报告：ISSUE_ROOTCAUSE_2026_09_30.md 之「问题②」「问题④」

- 复核范围：报告 §问题② （第 33-52 行）、§问题④（第 78-90 行）
- 复核者：独立审查员会话 b98465f8-0572-440e-a9d0-fd1da4033ea5
- 复核方式：**只读**静态取证。全程未修改任何既有文件，唯一写入为本文件。
- 证据基线（本次实测确认）：
  - `@deepseek-ai/dsh` package.json version = **0.2.0-rc.2**（npm 全局安装）
  - CHAT = `C:\Users\wkyiw\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-ui-chat\lib\client.js`，**totalLines = 12516**（报告引言口径一致）
  - 插件源码 `src/fold.ts` totalLines = 5573（与报告一致）；仓库 HEAD = `2592612`（与报告引用的 P3 提交号一致），`git status` 干净（仅报告文件与 review/ 未跟踪）
- 行号约定：本报告所有行号均为**本次实际读到的行号**；与报告偏差一律显式标注。

---

## ① 逐条判定表

### A. 问题② —— 官方侧（CHAT）

| # | 报告结论 | 本次实测证据（文件:行号 + 关键片段） | 判定 |
|---|---|---|---|
| A1 | INDEPENDENT 集合 = CHAT:10633-10641，含 user/steering/turn-trigger/model-retry/turn-error/turn-max-tokens/turn-tail | CHAT:10633-10641 逐字一致：`const INDEPENDENT = new Set(["user","steering","turn-trigger","model-retry","turn-error","turn-max-tokens","turn-tail"])`（10633-10640 为元素，10641 为 `]);`） | **成立（零偏差）** |
| A2 | 分组循环 CHAT:10797-10802「遇成员即 flush(true) + 单独 emit」 | CHAT:10797-10802：`if (INDEPENDENT.has(node.kind)) { flush(true); emit(key, { kind: "node", key }) }` | **成立（零偏差）** |
| A3 | 非成员行进 pending、下一次 flush 开新组 | CHAT:10803-10806 `turn-process` 单独 emit（不 flush）；10808-10812 reasoning→pending.push；10821-10824 其他→pending.push；10826 收尾 `flush(followed)` | **成立（报告未列行号，无偏差可算）** |
| A4 | flush 组键：`extendedGroup(...)?.key` 优先、JSON 串（含 first.key）兜底，CHAT:10765-10785 | CHAT:10765 函数头；10768-10772 `const key = this.extendedGroup(pending, added)?.key ?? brandString(JSON.stringify(["process", first.key, first.groupPart ?? null]))`；10775 组复用；10776 refresh；10778-10781 emit + membership；10784 `pending = []` | **成立（零偏差）** |
| A5 | TURN_PROCESS_INDEPENDENT_KINDS（CHAT:1518）**不含** model-retry | CHAT:1518-1527：`["system-prompt","user","steering","turn-trigger","turn-process","turn-error","turn-max-tokens","turn-tail"]` —— 无 `model-retry` | **成立（零偏差）** |
| A6 | 收起态官方 processHidden + useSearchableHidden 自动藏掉 model-retry | CHAT:1599-1620 `useSearchableHidden`：hidden 时 `element.setAttribute("hidden","until-found")`；CHAT:1689 processMember 定义（含 `!TURN_PROCESS_INDEPENDENT_KINDS.has(kind)`）；CHAT:1709 `const processHidden = controllerInactive \|\| foldable && processMember && !processOpen`；CHAT:1710 传入 useSearchableHidden；CHAT:1768 wrapper 写 `"data-turn-process-hidden": processHidden \|\| void 0`（官方自产属性确认） | **成立** |
| A7 | 「…用户**点开回合行**（或 alwaysOpen 回合）后可见」 | CHAT:1551-1556 `turnProcessAlwaysOpen` = status==="open" 或 reason aborted/error；CHAT:1676-1679 `liveProcess` / `alwaysOpen` / `processOpen = alwaysOpen \|\| processEntry !== void 0`；即：用户手动展开回合行 → processOpen=true → processHidden=false → 重试行可见 | **成立** |
| A8 | 「重试恰恰集中发生在运行中」 | 运行中回合 `liveProcess = !turnClosed`（CHAT:1676）→ alwaysOpen → processHidden 恒 false → 官方全程不藏重试行。**静态可判的部分成立**；「集中发生在运行中」属观测性结论 | **成立（静态部分）/ 需真机验证（分布）** |

### B. 问题② —— 插件侧（fold.ts）

| # | 报告结论 | 本次实测证据 | 判定 |
|---|---|---|---|
| B1 | 分段边界仅 user/steering/turn-tail，fold.ts:4214-4248 | 4214-4217 `if (kind === 'user' \|\| kind === 'steering')`；4239-4247 `if (kind === 'turn-tail')`；循环体 4214-4248 | **成立（零偏差）** |
| B2 | model-retry 是状态装饰行，fold.ts:3902 STATUS_ROW_KINDS | 3902 `const STATUS_ROW_KINDS = new Set(['model-retry','turn-error','turn-max-tokens'])`（声明行 3897-3901 为文档注释） | **成立（零偏差）** |
| B3 | 进 statusRows，fold.ts:4115-4121 | 4115-4119 注释；4120 `const inBlockStatus = new Set(...segmentBlocks.flatMap(block => block.statusRows))`；**4121** `const statusRows = range.filter(el => isStatusRow(el) && !inBlockStatus.has(el))` | **成立（零偏差）** |
| B4 | 组是不透明容器，fold.ts:3915/4361 | 3915-3917 `function isOfficialGroup(el){ return el.hasAttribute('data-step-process') }`；4361 `if (el.hasAttribute('data-step-process')) continue` + 4350-4360 的 §4.2/B1 注释 | **成立（零偏差）** |
| B5 | P3（提交 2592612）把块外状态行并入段级 chip 隐藏，fold.ts:1363-1385 | 1363-1380 为 P3 注释块（含引用 CHAT:10565-10573 / 10718-10727 —— **这两个 CHAT 引用是旧版行号，见 ② 清单**）；1382-1385 实际逻辑：`for (const status of segment.statusRows) { if (state.groupsExpanded) restoreElement(...) else hideElement(status, desiredHidden, segmentAnimate) }` | **成立（声明范围 1363-1385 未覆盖 1381-1382 两行）** |
| B6 | 缺口①：运行中段不建 segmentState（1130-1131），chip 循环 1353 `state===undefined continue`，P3 不跑 | 1130 `if (!snapshot.closed && !snapshot.terminated) continue`；1131 `if (snapshot.running \|\| !snapshot.hasWork) continue`；1134-1137 是 **唯一** `segmentStates.set`（grep 全域确认：702 声明、1137 set、1222 delete，别无他处）；1353 `if (state === undefined) continue`（**在 1359 driveGroups / 1382 P3 之前**） | **成立（零偏差）** |
| B7 | 缺口②：nativePassiveSegments 段完全跳过（1336） | 1336 `if (nativePassiveSegments.has(segment.key)) continue`，位于 chip/P3 循环最前；填充点 1102/1109：`const passive = keys.turn !== undefined && nativePassiveTurns.has(String(keys.turn))`，1038 `if (expanded && btn.hasAttribute('disabled')) nativePassiveTurns.add(t)` —— 谓词确实同时命中 verbose（foldable=false⇒aria-expanded=true、canCollapse=false⇒disabled）与 aborted/error（turnProcessAlwaysOpen） | **成立（零偏差）**；但「passive 段 ⇒ 重试行裸露」**不完整**，见 ③-1 |
| B8 | 缺口③：块内 statusRows 在块级 restore 分支被无条件放回（2297） | 2286 分支条件 `if (blockFoldableCount(block) < 2 \|\| (working && hiddenCount === 0))`；2297 `for (const status of block.statusRows) this.restoreElement(status, animate)` 后 2298 `return`；同型无条件 restore 另有 2191 与 2207。触发条件为退出条件：「有效行数 < 2」或「进行中且待折叠行数 = 0」 | **成立（零偏差）**；「触发条件」细节需补，见 ②-5 / ③-2 |
| B9 | chip/段展开态会 restore 重试行（1288/1383），设计使然不算缺陷 | 1286-1289 `if (!chipOwnsStatus) { for (const status of segment.statusRows) { if (collapse) hide else restore } }`；1383 `if (state.groupsExpanded) this.restoreElement(status, segmentAnimate)` | **成立（零偏差）** |
| B10 | 复用 sysRowOrder 序列（fold.ts:4177-4190） | 4177-4190：`const sysRowOrder: HTMLElement[] = []; if (!closed && !terminated) { ...candidates... 按 flowOrderIndexOf 排序 }`；4181 明确 `for (const status of block.statusRows) candidates.push(status)` —— 即 sysRowOrder **只含块内 statusRows，不含段级（块外）statusRows** | **成立但要点被报告省略**：报告把 `segment.statusRows` 当作可复用的 `sysRowOrder` 序列，实际两者元素集不同（见 ④-1）。`sysRowOrder` 在 pass() 中亦**无任何消费者**（grep 全域仅 4181/4188/4200 三处），已被软降级（1240-1243 `keepTrailing` 恒空） |

### C. 问题② —— 上限声明「物理合并组不可行」

| # | 报告结论 | 本次实测证据 | 判定 |
|---|---|---|---|
| C1 | 每个 ChatGroupSeat 各带自己的折叠按钮，N 个组头仍在 | CHAT:2288-2386 `ChatGroupSeat` → 2355-2365 标题外层 `div{hidden: !grouped}` 内 `ProcessGroupHeader`；CHAT:2244-2287 头部按钮；CHAT:10633-10641 每组各自 emit `{kind:"group"}` | **成立** |
| C2 | 「物理合并成一个组」**需隐藏组根**，违反 §4.2 只读保护面 | 「需隐藏组根」：成立（组间有 model-retry flowItem，唯一合并路径是让组根/重试行不可见）。「违反 §4.2」：**这是**插件的自我限制——§4.2 的伤害论证是关于 `display`（组根无 style prop ⇒ React 永不自愈），而插件自 0.1.7 起已经改走「驱动 button + 官方 hidden」通道，该通道下隐藏组根**不必**写 display；插件自身也已对组根**写入** `data-dshcf-gesture-bound` 属性（fold.ts:2140-2141），说明「组根只读不写」并非绝对 | **部分成立**（事实部分成立；「不可行」的归因不完整 → 见 ③-4） |
| C3 | 「0.1.7 B1 教训：React 永不清除组根残留样式」 | fold.ts:2826-2829 `组根 JSX 没有 style prop（CHAT:2343-2352）→ React 永不清除插件写的 style.display → 整组永久消失（真机实测 B1：11/97 组命中）`；CHAT:2345-2385 组根 JSX **确实没有 style prop**；fold.ts:591-594 注「真机实测 97 组：11 个组根留下空 style 属性」 | **成立** |
| C4 | 「插件可达上限 = 全部组收起 + 1 个 chip + 重试行隐藏」 | 逻辑自洽（组各自收起后视觉上等价于「合并」；N 个组头仍在属官方结构） | **成立**（属推断性结论，静态不可完全证伪；「1 个 chip」为段级 chip，与块级 chip 并存时可能 >1，见 ⑤-3） |

### D. 问题④a —— 指标挂原生组行

| # | 报告结论 | 本次实测证据 | 判定 |
|---|---|---|---|
| D1 | `data-turn-process-messages/-tool-calls/-subagents` 仍在（CHAT:6247-6249） | CHAT:6246-6249 `"data-turn-process": node.data.turn` / `-messages: node.data.messageCount` / `-tool-calls: node.data.toolCallCount` / `-subagents: node.data.subagentCount` | **成立（零偏差）** |
| D2 | 插件指标 span 挂 `button[data-turn-process]` | fold.ts:1776-1827 `syncNativeDisclosure`：1778 `flow.querySelector('[data-turn-process="'+turn+'"]')`；1817-1825 `span.className='dshcf-native-metrics'`、`button.insertBefore(span, labelSpan.nextSibling)`；独立佐证 grep：源码中 **无任何** `data-turn-process-hidden` 消费点 | **成立** |
| D3 | 组标题 `button[data-process-activity]` 值逐帧变（fold.ts:3945-3946 注释） | fold.ts:3944-3946 注释原文：`⚠️ data-process-activity 的**值**逐帧变（read/code/…），只能按属性存在性选择，绝不能用值做标识（规格书 §5.4）`（声明 3945-3946 略过 `@param` 行，语义正中）；消费点 1735-1749 `summarizeGroups` 读值仅用于计数；官方侧 CHAT:2256 `const activity = data.closed ? data.summary.counts[0]?.kind ?? "thinking" : live.activity` —— 运行期随 live 活动变 | **成立** |
| D4 | 「React 高频重渲染随时摘除追加节点，需每 pass 重挂」 | fold.ts:1773-1775 注释自述：`React 重渲染（展开/收起原生行）会清掉这个 span——与其它自愈注入同款：每 pass 重建/更新`；每 pass 由 1208-1212（nativeManaged 分支 → `syncNativeDisclosure`）调用 | **成立（插件自述，非官方源码证据）** |
| D5 | ④a「低收益、不建议全面迁移」 | 「N 组只能挂一处」：官方组根**不含** `data-turn-process`（组根属性见 CHAT:2345-2354），故确实只有回合级一处可挂 —— 成立；「无 chip 段确实缺指标落点」：撤掉缺口③ 分支后，无 chip 段（covered 为空）的段级 statusRows 仅由一级折叠控制（1285-1289 collapse 时 hide、展开时 restore）——成立 | **成立**（价值判断部分属主观，静态不可判） |

### E. 问题④b —— 重试行收入折叠

| # | 报告结论 | 本次实测证据 | 判定 |
|---|---|---|---|
| E1 | 收起态官方已自动藏重试行（processHidden + useSearchableHidden，data-turn-process-hidden 为官方自产属性） | 同 A6：CHAT:1709 / 1710 / 1608 / 1768。插件侧 grep 无 `data-turn-process-hidden` 命中 ⇒ 官方自产成立 | **成立** |
| E2 | 插件「无需复刻」 | 只有当回合行处于收起态时才成立——而 `liveProcess`（未闭合回合，CHAT:1676）与 `turnProcessAlwaysOpen`（open/aborted/error，CHAT:1551-1556）都会让 processHidden 恒 false；插件侧 1336 又把被动段整体摘出。与 A8、B7 自洽，报告亦已点名这些窗口 | **成立（但报告对 ④b 的措辞「官方已自动藏」比 ② 的口径更绝对；两节并不矛盾，见 ⑤-2）** |
| E3 | 「需补的只有问题②的 P3 三缺口」 | **不完整**：P3 生效的前置条件比报告所述多一条 —— 段必须至少有一个**可驱动**的已覆盖组，即 `partition.covered.length > 0`（1337-1339 `const covered = partition.covered; const shouldChip = covered.length > 0`；1349-1352 无覆盖即 `dropSegmentChip` + continue）。单组段 / 全部组已被驱动过（outerHidden 或非折叠模式）的段，**不会被 P3 覆盖** | **部分成立** → 见 ③-3 |
| E4 | 写入插件命名空间 display 控制，React 摘除即自愈 | 插件写的是 `el.style.display`（2835/2847-2848/2885），状态行是 `div.flowItem`（CHAT:1757-1779）——**带 `data-chat-anchor-key` 与 `data-chat-paging-anchor` 等 React 受控属性**。报告未提示：这些写入会改变官方 `readVisibleTurn` 二分（CHAT:4669-4692，`const rows = elements.column.children`）所依赖的几何单调性（row.getBoundingClientRect().top） | **部分成立** → 见 ③-5 |

---

## ② 报告中的事实错误 / 行号偏差清单

本次实测**未发现报告在 CHAT 与 fold.ts 上的行号偏差**（B1-B10、A1-A7、D1-D4 全部零偏差，唯一例外见 E-3 的注释块内部引用）。以下为 5 条需要修正或补注之处：

1. **CHAT 引用陈旧（P3 注释块内部）**：fold.ts:1367-1370 注释称 INDEPENDENT 在 `CHAT:10565-10573`、flush/emit 在 `CHAT:10718-10727`；实测为 **CHAT:10633-10641 / 10797-10802**。偏差 = `-68 / -79`。同类陈旧引用另见 behavior-spec.md:103（`CHAT:10565-10733`，实际 10633-10802，偏差 -68/-71）与 test/fold-chip-drive.test.mjs:24（同为 10565-10733）。报告正文用的 10633-10641 是**正确**的，问题只在注释与规格书里。
2. **B5 声明范围**：报告称 P3 为 `fold.ts:1363-1385`，实际注释块 1363-1380、`segmentAnimate` 赋值 1381、循环头 1382、逻辑体 1383-1385。声明范围未覆盖 1381-1382（advance 2 行）。
3. **D3 声明范围**：报告称注释在 `fold.ts:3945-3946`，实际 `⚠️` 注释起于 **3944**，3945-3946 为注释的续行。语义正中，仅起点偏移 1 行。
4. **B10 的语义偏差（非行号）**：报告修复方向 1 写「复用 sysRowOrder 序列（fold.ts:4177-4190）」。`sysRowOrder` 实际是 `块 rows ∪ 块 statusRows`（4180-4181），**不含** `segment.statusRows`（块外状态行，4121 的定义域恰好是块内补集）。用它做「重试链只留最新一条」需要先把块外状态行并进去，报告未说明这一步。
5. **C2 的归因（非行号）**：「不可行」被归因于「违反 §4.2」，但 §4.2 的完整文本（behavior-spec.md:8-10 = 组三层/带 hidden 只读不写 display 与不插节点；ADAPTATION_PLAN_0.1.7.md:186-192 = 「只读不写**+ 不写 style.display + 不 prepend/insertBefore**」，且 194 条 4「chip 门禁」、195-202 条 5「chip 属性分两类」）**并没有涵盖「隐藏组根」这一操作**。ADAPTATION_PLAN R1 的措辞是「对组根/组内写 `display` 破坏原生折叠」（:553），限定词是 display。因此 §4.2 **支持**「不可写 display」，**未支持**「不可通过官方通道隐藏组」。

---

## ③ 报告遗漏的反证 / 反例

1. **缺口②的真实性比报告更强，但机制被错述**。报告说「nativePassiveSegments 段完全跳过（1336）→ 无 chip、无隐藏，重试行裸露」。实际：passive 段在 1334-1336 就被 `continue` 跳过，**根本走不到 1337 的 groupPartitionOf**；而块内 statusRows 在更早的 2196-2208 `nativePassive` 分支同样被无条件 `restoreElement`。所以 passive 段的状态行裸露是**双重**的（段级 + 块级），报告的「补缺口②」若只改 1336 一处，**块内那条路径仍会放行**。这是一个「报告说漏了」的实质点。
2. **缺口③的触发条件不止「单条不折叠」**。2286 的退出条件有两个：`blockFoldableCount(block) < 2` **或** `(working && hiddenCount === 0)`（2284-2286）。第二条（进行中 + 无待折叠行）正是「重试退避期 / 单行块」的常见形态。报告只举了前者（第 45 行「单条不折叠」等分支），遗漏了第二条，而后者在运行中更容易命中（与缺口①的窗口重叠）。
3. **P3 生效还有一个报告未提的门槛**：`covered.length > 0`（1339）。单组段（`partition.covered` 为空）不建 chip → 1349-1352 提前 continue → P3 不跑。多个重试却只有一个可驱动组的回合，仍会裸露。这不属于报告列的「三个缺口」中的任何一个。
4. **上限声明有反例（同仓库内）**：`bindGroupGesture` 对组根**写** `group.dataset.dshcfGestureBound = '1'`（fold.ts:2140-2141），即插件已经在组根上留下自己的命名空间属性，而 §4.2 的文本禁止的是 display 与插节点。这说明「组根绝对不可写」不是本项目的既有共识，报告把它当作**既定上限**来引用，属于**过强的自我限制**。真正的技术风险（不是我推断，而是仓库自身记录的）是：任何让 `outerHidden` 组**短暂可见**的操作都会触发 CHAT:2315-2321 的 `if (outerHidden && rootRef.current?.hasAttribute("hidden")) setOpen(false)`，以及 §5.5 记录过的 c2 死循环路径（fold.ts:652 的注释表）。因此「物理合并」即便可行，也必须先过 c2 门禁 —— 报告给出的**结论（不建议做）可接受，理由需换成 c2/官方 innerText 依赖，而不是 §4.2**。
5. **组标题文案的真实来源（对 D3/D5 的旁证，修正一处易犯的误判）**：`processTitle`（CHAT:1820-1836）**完全由 `summary.counts` + i18n 标签推导**，与 DOM 文本无关；全 CHAT 文件中 **`innerText` 命中数为 0**（grep 确认）。因此「把指标节点挂进组标题会污染标题文案」这一担心**不成立**（本复核初稿曾如此推测，已撤回）。真正制约「挂组标题」的是：`ProcessGroupHeader` 是 `react.memo`（CHAT:2244），title 随 `summary` 变化重渲染 → 追加节点被移除（自愈，非破坏），以及下面的 D3 细节。④a「N 组只能挂一处、不宜选组标题」的结论**仍然成立**，但依据是**稳定性**而非**文本污染**。
6. **D3 注释「逐帧变」是过度概括**：CHAT:2256 `const activity = data.closed ? data.summary.counts[0]?.kind ?? "thinking" : live.activity` —— **已闭合组的 activity 由 summary.counts 派生，是稳定的**；只有未闭合（live）组才随 live 活动逐帧变。插件注释（fold.ts:3944-3946）的**规则结论（值不可作标识符）依然正确**，但「逐帧变」对闭合组不成立。
6. **`sysRowOrder` 已是死代码**：4177-4190 计算出的序列在 pass() 中无消费者，`keepTrailing` 恒空（1240-1243），`keepLastRows` 被 `void` 掉（1241-1243）。报告把它当作「可复用的既有序列」推荐，实际它从未被任何逻辑读取过（至少在本仓库当前 HEAD 上）。
7. **`hasStoppedRow` 的扫描面不含 statusRows**：4152-4155 `hasStoppedRow` 只看 `block.rows`（`rowState` 为 stopped/aborted），**不含** `block.statusRows`，也不含 `segment.statusRows`。报告未涉及；作为「报告对 statusRows 分层描述偏简」的补充证据（它直接影响 `terminated` 判定与缺口③的触发频率）。

---

## ④ 修复方向的可行性评估与风险

报告给出的三条修复方向（第 49-51 行）逐条评估：

**方向 1：运行中段对段级 statusRows 做「非最新」隐藏，复用 sysRowOrder 序列。**
- 可行性：**中**。技术上可行——`segment.statusRows` 是插件可写的普通 flowItem（1377-1378 注释已核实「flow 直接子级、不带原生 hidden、不属于 [data-step-process]*」），因此不触发 2831 的 `isNativeProtected` 门禁。
- 风险 A（报告未提）：运行中段的 `segmentState` 不存在（1130-1131），而 P3 的 `desiredHidden` 登记发生在 chip 循环内（1382-1385，且 1353 就以 `state===undefined` 提前退出）。运行中隐藏若不走 chip 循环，必须**另外**在 `desiredHidden` 里登记，否则 1302 的 `restoreUnusedDisplays` 会在同一 pass 反向恢复（1302 的注释明确记录过这个「恢复→再隐藏往返双写」的教训）。报告把它描述成「复用序列」过于轻描淡写。
- 风险 B：`sysRowOrder` 只含块内行（4180-4181），而缺口①针对的是**块外**`segment.statusRows`（4121）。要「只留最新一条」，得先把两类合流并保证 DOM 顺序——`flowOrderIndexOf`（3866-3870）可用，但报告未给出这条合成口径。
- 风险 C：「非最新隐藏」在流式期会与官方 processHidden 的翻转时序交织；报告已列为风险，成立。

**方向 2：passive 段定向隐藏段级 statusRows 但保留末条。**
- 可行性：**低-中**，且报告**低估了改动面**。见 ③-1：passive 段的状态行有一条**更早**的块级无条件 restore（2196-2208），只改 1336 无效。
- 风险：报告提出的「保留末条以免遮住错误线索」是合理缓解；但需注意 passive 谓词同时覆盖 verbose（非错误场景），在 verbose 下隐藏任何状态行都直接违背 §5.10「插件完全不介入」的既有契约（1050、1335-1336、2194-2195 三处注释反复强调），会与行为规范（behavior-spec.md:16 第 ⑥ 条）冲突。**这一条建议按场景拆分：aborted/error 与 verbose 不能共用同一谓词。**

**方向 3：块级 restore 分支（2286-2299）对 statusRows 改「随 chip 意图」而非无条件 restore。**
- 可行性：**中-高**，但报告的定位不完整：
  - 无条件 restore 的同型分支有 **三处**（2191 nativeCollapsed、2207 nativePassive、2297 单条/无折叠行），报告只点了 2297。
  - 2297 分支是**退出路径**（2298 直接 return），且进入条件含「进行中且无待折叠行」（2286 第二条）——改这里等于把「块内状态行」的处置整体交给 segment/一级层，需要同时确认 2369-2375（正常 chip 路径）不会与新语义重叠。
  - **测试保护盲区**：test/fold-chip-drive.test.mjs:29-34 明确声明 D5「不锁一级 restore 路径是否覆盖 chip 意图这一具体分支——实测把该仲裁改成恒真后 D5 仍 PASS（因为本夹具下段的 statusRows 走的是另一条路径：nativeCollapsed 分支提前接管）」。也就是说，**2285-2298 这条路径在当前测试集中无鉴别力**。任何在此处的改动必须先补测试，否则回退不会被发现。这是报告完全没有提到的实施风险。

**总体判断**：三条方向**方向正确、均有落点**，但都**不足以**在报告描述的改动量内闭合用户症状：
- 「重试链只留最新一条」需要新增跨（块内/块外）状态行的统一排序与 `desiredHidden` 登记，不能只改 1131/1336/2297 三处（报告第 174 行的优先级表把它们描述为「改动集中在三处分支 + chip 循环」——**偏乐观**）。
- covered 为空（单组段）的 P3 盲区（③-3）未纳入修复计划。
- passive 段与 verbose 的语义冲突（④-方向 2）需要先决，否则会破坏已锁定的 §5.10 行为。

---

## ⑤ 静态不可判 / 需真机验证

1. **数据分布类**：「重试集中发生在运行中」（A8）与「59 组/34 重试行交错」（报告第 39 行、fold.ts:1370-1371）均为历史真机观测。本次只读审查**无法复现**，需要真实会话的 DOM dump。
2. **④b 的实测口径**：processHidden=true 时重试行 `div.flowItem` 上的 `data-turn-process-hidden` / `hidden` 属性实况——决定插件 `hideElement` 是否被 `isNativeProtected`（4050 `el.hasAttribute('hidden')`）拦住。属运行期行为。
3. **C1/C4 的视觉结论**：N 个组头按钮在「全部组收起」后的实际视觉密度、段级 chip 与块级 chip 是否并存导致「1 个 chip」不成立——需真机截图比对。
4. **D4 的机制细节**：React 究竟在哪些重渲染上摘除 `button[data-turn-process]` 内的追加 span（插件注释自述，官方源码中未找到直接证据），以及「每 pass 重挂」的实测开销，需真机 instrumentation。
5. **缺口①②③ 的真实用户可见占比**：三个缺口各自的触发频率（运行中 / passive / 单条块 / 无 covered 组）只能靠真机日志统计；本报告只能证明「三条路径静态存在且具体行号成立」。
6. **缺口③ 修复后的 `desiredHidden` 竞争**：`restoreUnusedDisplays`（3018-3022）与 `pendingAnims` 的交互属运行期时序，静态不可判。
7. **「物理合并组」通道的可行性**：官方是否暴露任何不写 display、不插节点、且不会触发 CHAT:2315-2321 反冲的组隐藏通道——本次只确认了「button 折叠 = 驱动官方 open 态」这一条路，未能穷尽；且该方向是否值得做（收益 vs c2 风险）需真机验证。

---

## ⑥ 一句话总结

报告在**问题②④的所有关键行号与官方机制描述上零偏差**（INDEPENDENT 10633-10641、flush 10765-10785、循环 10797-10802、TURN_PROCESS_INDEPENDENT_KINDS 1518、data-turn-process-* 6247-6249、fold.ts 1130/1336/1353/1363-1385/2297/3902/4115-4121/4214-4248 全部核实）；三处需要修正的是：(a) 上限声明所引的 §4.2 文本**并不覆盖**「隐藏组根」，是**自我限制**而非既有约束（反例：插件已对组根写 `dataset.dshcfGestureBound`）；(b) 缺口②的根因不止 1336，块级 2196-2208 有更早的无条件 restore，只改一处无效；(c) 「复用 sysRowOrder」有事实错误——该序列只含块内 statusRows 且已是无消费者的死代码，而 P3 要处理的是块外补集。此外 P3 生效还多一道 `covered.length > 0` 门槛（1339），以及 2285-2298 路径在测试集中**无鉴别力**（fold-chip-drive.test.mjs:29-34 自述）。
