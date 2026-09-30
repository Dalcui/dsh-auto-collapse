# 独立代码审查：问题⑤ 根因B（直播段 covered 收起）

审查对象：未提交工作树（git diff 可见的三文件改动）
审查基线：lib/client.js @ sha1 3DB75999FDFAFD66FE759A76DAC6E617A24885A6C695B2101430AFC575B58A91（node build.mjs 重建后哈希不变 ⇒ 构建产物与 src 同步，无漂移）
官方基线：C:\\Users\\wkyiw\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai\\dsh-client-ui-chat\\lib\\client.js（564KB / 12515 行，2026-09-30 20:03）
审查方式：只读复核 + 系统临时目录探针（%TEMP%\\rev-rcB-probe{1,2,3}.mjs，未入仓库）+ 一次消融实验（已完整还原）

---

## 结论

**批准合入（Approve with follow-ups）。**

根因B 的机制复核**成立**，修复方向正确，实现位置正确，无同 pass 振荡、无额外点击放大、稳态零写、G1 用户意图保护实测生效。32/32 全绿，消融可鉴别。

但必须指出两点：
1. **本轮 diff 的真实范围远大于「根因B 一行」**——它还含「P3 缺口①（直播段重试链收敛）」的完整实现与两处位置归位（restoreUnusedDisplays 归位、直播段让出段级状态行处置权）。这三块**耦合在同一次 pass 的写序里**，单独审查根因B 会漏掉它们引入的风险（见 D-1/D-2/D-5）。
2. **根因B 只在同一段内成立**。ISSUE 问题⑤ 的**根因A 完全未修**（实测复现：跨段两段各自的 last 并排展开，见 D-3），用户症状在「插话/多段回合」场景下**依旧存在**。若本轮对外宣称「问题⑤ 已修」，属于过度声明。

---

## A. 机制复核：前提是否成立

### A-1 官方组默认收起 —— 成立（读官方 bundle 证实）

    // CHAT:1845-1856
    function useDisclosure(version = 0) {
      const [expandedVersion, setExpandedVersion] = react.useState(null)
      return { expanded: expandedVersion === version, setExpanded, toggle }
    }
    // CHAT:2294
    const { expanded: open, setExpanded: setOpen } = useDisclosure()   // 无参 ⇒ version=0

useState(null) ⇒ expanded = (null === 0) = false。**默认收起，且无任何官方自动展开路径。**

### A-2 展开仅来自插件驱动 —— 成立（穷举了 setOpen 的全部官方调用点）

grep setOpen 在 chat bundle 中命中 ChatGroupSeat 作用域内只有三处：

| 位置 | 代码 | 触发条件 |
|---|---|---|
| CHAT:2316 | if (outerHidden && rootRef.current?.hasAttribute("hidden")) setOpen(false) | **只会收起**（c2 反冲，方向安全） |
| CHAT:2322-2324 | reveal = () => setOpen(true) | 仅由 useSearchableHidden 的 beforematch 监听器调用 |
| CHAT:2329-2337 | toggle = () => { ...; setOpen(!open) } | 仅由 ProcessGroupHeader 的 onClick 调用（CHAT:2263-2266） |

CHAT:6229 的 if (turn?.status !== "closed") return null 只存在于 TurnProcessNodeView（回合级 turn-process 行），**与组无关**。

⇒ **直播期不存在任何官方展开通路**；插件 driveGroups([last], true) 是唯一让组展开的力量。修前直播段在 state === undefined 处 continue ⇒ covered 在整个直播期无人驱动 ⇒ 上一 pass 被展开的组永久停留。**机制陈述与官方源码逐条吻合，根因B 判定无误。**

### A-3 附带证实（影响严重度判定）

ProcessGroupHeader 的按钮在**直播期是可见可点的**：
- CHAT:2301 grouped = policy.stepGrouping === "collapsed" || (stepGrouping === "history" && turnLocation?.status !== "open")
  ⇒ standard/compact 恒 true；detailed 下历史回合 true、**当前开放回合 false**
- CHAT:2356 hidden: !grouped ⇒ 组头容器 hidden=false
- CHAT:2247-2253 直播期标题走 useStableLiveProcessTitle（活动/tool 名），即官方**刻意**在直播期暴露组头

⇒ 修复注释里「被收起的组由用户点各自的组头重开」**真机成立**（detailed 开放回合除外，见 C-2/D-4）。

---

## B. 正确性

### B-1 covered 与 last 互斥 —— 严格互斥

groupPartitionOf（fold.ts:1756-1777）单次遍历选定 lastVisible，返回 covered = groups.slice(0, lastVisible).filter(drivable)、last = groups[lastVisible]。slice 的排他上界保证 last 不在 covered 内。两者又都先经同一个 drivable 谓词（非 [hidden] 且非 data-group-expanded-mode）。

⇒ **同一 pass 内不会出现同一组既被要求展开又被要求收起**；driveGroups([last], true)（:1361）与 driveGroups(covered, false)（:1391）目标态相反、集合不交。**无同 pass 振荡。**

### B-2 driveGroups 幂等早退 —— 真生效

    // fold.ts:2193-2197
    const current = button.getAttribute('aria-expanded') === 'true'
    if (current === expanded) { this.groupAttempts.delete(group); continue }

早退发生在 withMuting **之前**；toDrive.length === 0 时 :2200 直接 return ⇒ 不进入 muting 窗口、不产生 mutation。**实测**（探针10）：稳态连续 3 个 pass，两组 aria-expanded 属性写次数 = **0**。

### B-3 消融鉴别力 —— 独立复现

把 :1391 临时改为 void covered 后重建并跑全量：

    FAIL  根因B：新组出现后前一组被收起（修复前恒为 true，两组并排展开）  (g1=true)
    [1 FAILURE(S)]   ← 其余 31 个文件全绿

⇒ 该行是**唯一**使新场景通过的原因，实施方「去掉该行 → FAIL(g1=true)」的声明**独立复现成功**。（已还原：fold.ts sha256 0443DCFA…、client.js sha1 3DB75999… 与审查开始时一致，git status 与初始完全相同。）

### B-4 参数恒为 false 是否可被后续展开态推翻 —— 不可

直播段（state === undefined）没有 chip，而 state.groupsExpanded 只能由 chip 点击翻转（ensureSegmentChip 的 click 处理器）。且 completedKeys 循环会在段闭合时让 state 退出（fold.ts:1219-1223 删除未完成 key 的 state）⇒ 进入 chip 分支时 groupsExpanded 必为 false，driveGroups(covered, false) 与直播期目标态**连续一致**，不会出现「闭合瞬间反向弹开」。

### B-5 调用频次不会放大点击 —— 实测无放大

探针9（6 个组逐个出现）：总 click = **11**，其中首组建立 1 次、此后每个新组恰好 1 次收起 click。原因是「展开点击先于降级」（同一 pass 内 covered 判定基于当轮 DOM，先成为 last 的那次展开 click 不可避免）。**每新增一个组 = 1 次 click，线性、无放大。**

---

## C. 用户体验副作用（逐条实测）

### C-1 用户手动展开过的组会不会被强收 —— 不会（G1 实测生效）

探针1：直播期两组，g1.btn.dispatchEvent('click', { isTrusted: true }) 模拟真实手势 →

    PASS  【G1】两个 pass 后用户展开的 g1 仍保持展开（未被 driveGroups 强收）

bindGroupGesture（:2249-2266）在 pass 开头对 flow.querySelectorAll('[data-step-process]') 逐组绑定，冒泡到组根；isTrusted !== true 早退（:2253）。桩的 dispatchEvent **实现了冒泡**（fake-dom.mjs:252-276），所以这条链路是真被测到的，不是空转。

**但补一条更准确的表述**：G1 是**元素级永久**豁免，不是「同向冲突才豁免」。用户点开 g1 后，即使把 g1 拖回 covered，插件也**永不再**驱动它——因此**下一次** G2→G3 的降级周期里，g1 会再次留在展开态（多个用户开过的组可持续累积展开）。这是 ISSUE 根因C 的既有设计，**不是本轮引入**，但本轮把直播期的收起驱动打开了，用户「点开→又被下一轮降级放过」的体感会更明显。

> 顺带澄清一个易误判点：探针里「合成 click 不获 G1 保护」的断言失败是我探针写错（fake-dom 的 dispatchEvent(type, init) 会把 init 展开覆盖默认的 isTrusted: false，需显式传 isTrusted: false）。FakeNode.click() 自身传的是 isTrusted: false（fake-dom.mjs:291-293），**生产路径无此问题**，不作为缺陷。

### C-2 直播期被收起的组有没有别的重新展开入口 —— 只有「用户手点组头」一条

探针2（直播期）：seg-chip=0、processed=0、组头容器 hidden=false。
- 插件侧**无**聚合 chip、**无**一级行 ⇒ 插件不提供任何重开入口
- 插件侧也不会**重新展开**已收起的 covered（目标态恒 false）；用户手点后由 G1 接管保护
- ⇒ 真机唯一入口是官方组头按钮，而它**在直播期是可见可点的**（A-3 已证）⇒ **不存在「组被收起后无法再打开」的死锁**

**但 detailed 档有一个真实缺口**：CHAT:2301 中 stepGrouping === "history" 时，**当前开放回合** turnLocation?.status === "open" ⇒ grouped = false ⇒ 组头容器 hidden = true（CHAT:2356）、组根带 data-group-expanded-mode。此时 groupCollapsibleMode 返回 false ⇒ 该组的按钮**根本不可见**；若它同时是 covered（同段后续还有别的可驱动组），用户就会看到：**组头点不到 + 组体因 covered 被收起而不可见**。修复注释里「官方直播期组头是可见的」这句在 **detailed 档不成立**，注释应加档位限定。（严重度中；需真机在 detailed 档确认该组合的实际形态。）

### C-3 会不会让用户「看不到正在进行的工作」—— 不会，反而更清楚

探针4（直播期，两组 + running 工具行）：.dshcf-processing = "正在工作" 存在，且唯一展开组 = 最新组。
- 插件自带实时摘要行恒在（syncLiveRows，:2060-2103）
- 最新组恒展开 ⇒ 当前工具/思考内容可见
- 旧组收起后组头保留活动图标 + 实时标题（data-process-activity + useStableLiveProcessTitle）⇒ 有「哪些组在动」的概览
- 对比官方自身：官方在 live 期**同样只展开最新组**（新组挂载时 useDisclosure 全新 state = false），且**永不回收**旧组。修复后的插件 = 官方意图 + 回收，语义上是**修复而非偏离**。

**结论：C-3 优于官方 live 行为，无副作用。**

---

## D. 缺陷清单（按严重度）

### D-1【中】convergeLiveStatusRows 在每轮判定后重置「最新重试行」——直播期重试链可见行每 5-6 秒换一条

探针1 的副作用观测（真实数据，非推断）：convergeLiveStatusRows（:1834-1859）每 pass 都调用 hideElement(rows[i], desiredHidden, animate)；hideElement 内有

    // fold.ts:2952-2953
    if (!this.originalDisplay.has(el) && !isDisplayed(el)) return false

⇒ 对「已被插件隐藏且**仍带着** hidden="until-found"」的行（data-chat-paging-anchor = grouped && !open，CHAT:2352）**恒提前 return**，desiredHidden **不被登记** ⇒ 循环结束后的 restoreUnusedDisplays(desiredHidden)（:1448，本轮刚从 chip 循环之前**挪到之后**）立即把它 restoreElement 回可见。

更关键的是**时序**：getAttribute('aria-expanded') 读的是 **DOM 属性**，而 React 对 aria-expanded={open} 的更新要等它自己的 render+commit。插件在**自己的 pass 内**先读后写：
- pass N：r4 出现 → 读 r3 按钮 = "true" → 隐藏 r3、显示 r4、desiredHidden 只含 r3
- React 稍后 commit：r3 按钮变 "false"、r3 的 hidden 被移除 ⇒ r3 **在下一次 pass 之前就已重新可见**
- pass N+1：读 r3 按钮 = "false" 且未被插件隐藏 ⇒ hideElement 走到底 ⇒ 隐藏 r3、**登记** desiredHidden ⇒ 收敛稳定

⇒ 最终态正确（探针4 的断言通过）、稳态零写（探针10 通过），但**每条「已重试模型请求」行会在直播期反复可见/隐藏，间隔 ≈ 插件 pass 的 5-6s 心跳**（syncLiveRows 的 liveTick，:2092-2098），而且**每轮都要为它重建一个 hidden 属性**（React 每轮移除、插件每轮重建 ⇒ **永久 property+childList mutation 流**，正是 shouldSchedule（:846-855）/ markDirty（:861-909）要吃的批次）。

代码位置：**不是根因B 那一行**，而是同一次 diff 里新增的 convergeLiveStatusRows 与「restoreUnusedDisplays 归位」的组合效应。**建议修法**：把「依据按钮属性判定」换成插件自持账本（如 this.liveStatusHidden: WeakSet），或在 convergeLiveStatusRows 内对未登记的已隐藏行**显式 desiredHidden.add(el)**，避免每轮依赖 React 的移除时机。

### D-2【中低】inert 组在直播期被反复探测：若宿主不渲染 beforematch，会走到 groupInert 永久豁免

探针8（模拟官方反冲/障碍）：8 轮后 click = 4，之后**永不再尝试**（groupInert 只增不减，:2232；无重置事件）。
- 官方 DOM 有 beforematch 监听（CHAT:1611-1618），展开方向走的是零点击通道 ⇒ **真机风险低**
- 但**本修复把 covered 的驱动从「一次性/闭合后」变成了「整个直播期每 pass」**，反冲组（或任何 aria-expanded 读值与插件写值不一致的组）被探测的次数从个位数上升到「整个直播期」，转入 groupInert 的概率**显著提高**，且一旦 inert 就**永久豁免**（根因C 的一部分）
- ISSUE 已把「inert 增加重置事件」列为修复方向 3；本轮未做。**建议**：至少给 groupInert 加一个「段闭合/组重新成为 last」时的重置点

### D-3【中，非本轮引入但影响验收口径】根因B 修复**不覆盖**根因A，跨段场景依旧并排展开

探针5（同回合内 steering 切段，两段各自一个组，**直播期**）：

    g1=true g2=true      ← 两段各自的 last 并排展开

机制：段级循环对**每个段**执行 if (partition.last !== null) this.driveGroups([partition.last], true)（:1361），**无「仅最新段」门控**；第一段的 last 恒为 g1，每 pass 被重新驱动展开 ⇒ 没有任何路径把它收回（它不在任何 covered 里）。这正是 ISSUE 里「根因A（最高·设计语义）」，修复方向第 1 条。

⇒ **若本轮对外表述为「问题⑤ 已修」，是过度声明。** 根因B 只解决了「同一段内新组顶掉旧组」这一子场景。

### D-4【低】注释与实现的两处不精确

1. **:1385-1386**「官方直播期组头是可见的：grouped=true ⇒ 组头 hidden 为 false」——**detailed 档当前开放回合 grouped=false**，组头 hidden（CHAT:2301/2356）。应加档位限定，否则未来读者会据此做错误推论。
2. **:1371-1394 的注释块**把「P3 缺口①（重试链收敛）」与「根因B（covered 驱动）」混在同一段，而实际有两套独立机制。建议拆开，便于后续按机制回滚/回归。

### D-5【信息】本轮 diff 范围与「根因B 一行」的描述不符

git diff --stat：src/fold.ts +146/-19、test/fold-retry.test.mjs +200、lib/client.js +49/-4。实质内容四块：
1. 根因B：driveGroups(covered, false)（:1391）——本轮主线
2. P3 缺口①：convergeLiveStatusRows（:1834-1859）+ 终态行豁免（isTerminalStatusRow，:4016-4020）
3. restoreUnusedDisplays 从 chip 循环**之前**挪到**之后**（:1448）
4. 直播段让出段级状态行处置权（liveStatusOwned，:1305）

第 3、4 两项是**写序变更**，会同时影响所有既有折叠路径；本轮测试未覆盖这两项与根因B 的交叉（D-1 就是该交叉的产物）。建议后续把「写序归位」拆成独立提交以便二分回归。

---

## E. 与既有测试的关系

### E-1 全量：32/32 通过

node test/run-all.mjs → [run-all] 32 个测试文件全部通过，退出码 0。

### E-2 实测覆盖率：直播段分支在**既有**用例中零覆盖

消融实验中，**唯一**失败的是新场景（fold-retry 的根因B 场景）。这同时说明：fold-chip-drive / fold-017-safety / fold-live 等既有用例的组夹具**全部只出现于已闭合段**（都有 turn-tail），从未触达 state === undefined 的新分支 ⇒ **既有断言不可能因本轮改动发生语义漂移**（无漂移风险），但反过来说，**回归网对直播段组驱动是空白**。

### E-3 逐条核对 aria-expanded 断言

| 用例 | 断言 | 结论 |
|---|---|---|
| fold-chip-drive D1-1/D1-2 | 覆盖组被驱动为收起 | 均带 turn-tail ⇒ 走闭合分支，不受影响 |
| fold-chip-drive D2 | last 保持展开 | 同上 |
| fold-chip-drive D3 | 单组段 last 展开、无 chip | 同上 |
| fold-017-safety K2/K3 | 覆盖组被驱动为收起 | 同上 |
| fold-017-safety K4 | 最后一组**不被**驱动、保持原生展开 | 桩里 open:true 预设，闭合段 driveGroups([last], true) 早退 ⇒ 不变 |
| fold-017-safety L2 | outerHidden 组未被驱动 | covered 的 drivable 谓词排除 + driveGroups 内 closest('[hidden]') 双保险；探针6 实测豁免组多 pass 后仍原状 |
| fold-017-safety L2-2 | 非折叠模式组未被驱动 | groupCollapsibleMode 排除；探针6 实测 |
| fold-017-safety M1 | verbose 不建段级 chip | nativePassiveSegments 在段级循环开头 continue（:1349）⇒ **根本走不到新分支** |
| fold-017-safety N0/R | 驱动后回读、chip 计数 | 闭合段路径 |

**无一条既有断言发生语义漂移。**

---

## F. 边界条件

| 边界 | 结论 | 证据 |
|---|---|---|
| 单组段（covered 为空） | 安全 | driveGroups 首行 if (groups.length === 0) return（:2173）；探针9 首组建立时 aria 由 driveGroups([last], true) 单独驱动 |
| covered 含 outerHidden 组 | 安全 | drivable 已排除 + driveGroups 内 closest('[hidden]') 二次拦截；探针6：多 pass 后 aria 恒 true、无振荡 |
| covered 含非折叠模式组（data-group-expanded-mode） | 安全 | groupCollapsibleMode 排除；探针6 同款 |
| passive 段 | 不受影响 | if (nativePassiveSegments.has(segment.key)) continue（:1349）在新分支**之前** ⇒ 根本到不了 |
| 组被 React 重挂 | 安全 | userOwnedGroups / groupInert 是 WeakSet，新元素自动失效；探针7：替换后的新组被正确纳入 covered 并驱到收起，last 保持展开 |
| 直播段 covered 在闭合瞬间 | 无反向弹开 | 闭合时 groupsExpanded 必为 false（state 新建于 completedKeys 循环，:1136）⇒ 目标态与直播期连续 |
| 组为最后一组但被 G1 接管 | 预期行为 | driveGroups 跳过；用户意图优先 |
| 直播期 covered 含 turn-process 座位 | n/a | 座位不是 [data-step-process]，不进 snapshot.groups |

---

## G. 性能/时序结论

| 项 | 实测 | 结论 |
|---|---|---|
| 稳态（无变化）click | 0（首次收敛后再跑 3 pass，click 恒 1） | 幂等零点击 |
| 稳态 aria-expanded 写 | 0 | 幂等零写 |
| 每次「降级」的 click | 恰好 1 | 无放大 |
| muting/mutation → 多一轮 pass | 不放大 | driveGroups 早退不进入 withMuting；新展开 click 是「本来就要发生」的那一次 |
| convergeLiveStatusRows 的写 | 每轮为被 React 移除 hidden 的行**重建属性**（永久 mutation 流，5-6s 周期） | 见 D-1 |
| inert 探测次数 | 直播期从「个位数」升到「每 pass」 | 见 D-2 |

---

## H. 建议（按优先级）

1. **D-1**：给 convergeLiveStatusRows 加插件自持账本（或在未登记的已隐藏行上显式 desiredHidden.add），消除依赖 React 移除时机的可见性抖动与每轮 hidden 写。
2. **D-3**：明确本轮**不含**根因A；若要让用户症状彻底消失，需落地 ISSUE 修复方向 1（「最新组」改流粒度：仅最新活跃段产出 last，历史段全进 covered），并保留 G1。建议作为下一轮独立任务。
3. **D-2**：给 groupInert 增加重置点（段闭合 / 组重新成为 last / 时间窗衰减），否则直播期的高频探测会把更多组推入永久豁免。
4. **D-4**：修正 :1385-1386 的档位不精确表述；拆分 :1371-1394 的混排注释。
5. **E-2**：补一条「直播段多组合成」用例（组逐个出现、含 outerHidden / 非折叠 / 重挂 三种 covered 变体），把既有用例的空白补上——本轮新场景只覆盖了最简形态。
6. 真机验证 ISSUE 清单第 8 条（直播期新组出现后前一组 aria-expanded）在 **standard / detailed 两档**都要过，尤其 detailed 档的 grouped=false 形态（D-4/C-2）。

---

## 附：审查过程存档

- 消融实验：临时改 src/fold.ts:1391 → void covered，node build.mjs + node test/run-all.mjs；**已完整还原**（fold.ts sha256 0443DCFAA75E2BA3C23C935154F1E4D08DB12EC51CFCE348990C26FB8284C49A，client.js sha1 3DB75999FDFAFD66FE759A76DAC6E617A24885A6C695B2101430AFC575B58A91，git status / git diff --stat 与审查开始时逐字一致），并重新 node build.mjs。
- 探针位置：%TEMP%\\rev-rcB-probe1.mjs / rev-rcB-probe2.mjs / rev-rcB-probe3.mjs（**均在系统临时目录，未新增/删除任何仓库文件**）。备份：%TEMP%\\rev-rcB-fold-orig.ts、%TEMP%\\rev-rcB-client-before.js。
- 官方证据引用均为语句锚点（函数名/唯一子串）与 CHAT 行号并列，便于在 bundle 演进后复核。
