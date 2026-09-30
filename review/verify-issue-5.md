# 独立复核报告:问题⑤「最新组保持展开」有时不收起旧组

复核对象:`ISSUE_ROOTCAUSE_2026_09_30.md` 第 94-117 行(问题⑤全节)+ 第 105-107 行(被排除假设)+ 第 164-166 行(真机验证项 8/9/10)
复核者:独立审查员(会话 c151096f-eabe-44f4-9dc3-4ee7bf5d829c)
复核方式:静态只读;每条结论给「文件:行号 + 片段」,行号均为本次实际读到
证据基线:本机 `C:\Users\wkyiw\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`
- CHAT = `dsh-client-ui-chat\lib\client.js`(12515 行)
- RENDERER = `dsh-client-ui-renderer\lib\client.js`
- SLOTS = `dsh-client-ui-slots\lib\index.js`
- UI-SESSION = `dsh-client-ui-session\lib\client.js`
- UI-CONV = `dsh-client-ui-conversation\lib\client.js`
- 插件 = `E:\Git\dsh-auto-collapse\src\fold.ts`(5573 行)

---

## ① 逐条判定表

### A. 根因A:partition.last 每段语义 + 无段新旧门控

| # | 文档结论 | 本次实测证据 | 判定 |
|---|---|---|---|
| A1 | `groupPartitionOf` 在 fold.ts:1693-1713,**对每个段独立划分 last** | fold.ts:1693 `private groupPartitionOf(snapshot: SegmentSnapshot): { covered: HTMLElement[]; last: HTMLElement | null } {`;函数体 1694-1713,1714 收尾 `}`。形参是**单个** `snapshot`(段),段内独立找最后一个可驱动组:1705-1708 `for (let i = groups.length - 1; i >= 0; i--) { if (drivable(groups[i])) { lastVisible = i; break } }`,1710-1713 返回 `{covered: groups.slice(0, lastVisible).filter(drivable), last: groups[lastVisible]}`。**每个段各自一份,互不知晓其他段** | **成立**(行号偏差 0;函数实际跨 1693-1714,报告写 1693-1713 属闭区间末行取法差异) |
| A2 | fold.ts:1348 `driveGroups([partition.last], true)` **无段新旧门控** | fold.ts:1348 `if (partition.last !== null) this.driveGroups([partition.last], true)`。所在循环 fold.ts:1334 `for (const segment of segments) {` ——**无任何"是否最新段/是否当前回合"的条件**;上方唯一门控是 1336 `if (nativePassiveSegments.has(segment.key)) continue`(verbose/aborted/error 让路)。目标态恒为 `true`(展开) | **成立**(行号偏差 0) |
| A3 | 「某组一旦曾是段 last 就永远是」 | **不严密,但结论方向成立**。`last` 每 pass 由 DOM 重算(fold.ts:1694 `snapshot.groups.filter(group => group.isConnected)` + 1699-1703 `drivable`),可驱动性 = 已连接 ∧ `group.closest('[hidden]') === null` ∧ `!group.hasAttribute('data-group-expanded-mode')`(fold.ts:3941-3943)。**任一前提翻转即可打破不变式**:原 last 组变成 outerHidden(未被 drive 的组其祖先可被官方置 hidden)→ 它退出 last 候选,前一组顶替为 last。官方重渲染时组 key 改变还会让 `ProcessGroup` 重建(CHAT:10768-10775 / 10836-10849) | **部分成立**(需补前提:不变式只在「该组保持可驱动 且 段内其后无新增可驱动组」时成立) |

补充(报告未写、影响 A 的量级判断):A2 的持续作用**只在段没有 state 时决定了 covered 不被动**(见 B),段一旦闭合,covered 每 pass 都会被驱动态。因此 A 的"永久展开"真正长期显形的是**该段最后一个可驱动组**(它永远是 last,每 pass 被驱动展开),而不是任意历史 last。

### B. 根因B:直播段不建 segmentState → covered 收起被整体跳过

| # | 文档结论 | 本次实测证据 | 判定 |
|---|---|---|---|
| B1 | fold.ts:1130-1131 直播段不建 segmentState | fold.ts:1130 `if (!snapshot.closed && !snapshot.terminated) continue`;1131 `if (snapshot.running || !snapshot.hasWork) continue`;state 只在 1134-1137 创建:`let state = this.segmentStates.get(snapshot.key)` / `if (state === undefined) { state = {...}; this.segmentStates.set(snapshot.key, state) }`。全文件 `segmentStates.set` **仅此一处**(其余 13 处均为 get/delete/遍历) | **成立**(行号偏差 0) |
| B2 | fold.ts:1353 `state === undefined continue` 确在 `driveGroups(covered)` **之前** | fold.ts:1353 `if (state === undefined) continue`;fold.ts:1359 `this.driveGroups(covered, state.groupsExpanded)` —— 1353 < 1359,**顺序确如文档所述**。且 1348 的 last 驱动在 1353 **之前**,所以直播段是「只驱动 last 展开、covered 完全不驱动」 | **成立**(行号偏差 0) |
| B3 | 这是「新组出现旧组不收」的直接机制 | **成立,且不依赖原生行**。链条:直播段 state=undefined(B1)→ 1353 continue → covered 永不驱动(1359 不可达)→ 而上一轮的 last 已被 1348 驱动为展开 → 新组出现后旧组保持展开。关键:1353 的门控对**所有**段生效,与 `nativeManaged` 无关 | **成立** |
| B4 | 「症状窗口 = 整个直播期」 | 成立,但文档给了限定(真机验证项 8)。补充上游事实:直播期**通常根本没有**原生 turn-process 行 —— CHAT:6229 `if (turn?.status !== "closed") return null;`,所以 `button[data-turn-process]` 在线程未闭合期间不渲染,插件侧 `nativeManaged` 为空(fold.ts:1040-1049 需 `nativeTurns.has(turn)`)。这不推翻 B(1353 与原生行无关),但说明直播期组展开**完全由插件自己驱动**,原生不会维持任何组展开 | **成立**(文档未提 CHAT:6229 这条上游事实) |

### C. 根因C:元素级永久豁免

| # | 文档结论 | 本次实测证据 | 判定 |
|---|---|---|---|
| C1 | `bindGroupGesture`(fold.ts:2142-2154)任意 isTrusted click 就 `userOwnedGroups.add` | fold.ts:2139-2155:2142 `group.addEventListener('click', (event: Event) => {`;2143 `if (event.isTrusted !== true) return`;2147 `const button = target.closest('button[data-process-activity]')`;2153 `if (typeof group.contains === 'function' && !group.contains(button)) return`;2154 `this.userOwnedGroups.add(group)`。无方向/无撤销/无过期。绑定点 fold.ts:977-979(每 pass 对 flow 内 `[data-step-process]` 绑一次,`dataset.dshcfGestureBound` 防重复) | **成立**(行号偏差 0;函数起点实为 2139,报告区间 2142-2154 恰是监听器体) |
| C2 | `driveGroups` 永久跳过(:2067) | fold.ts:2067 `if (this.userOwnedGroups.has(group)) continue     // §5.7 G1:用户已接管`;且 `userOwnedGroups` 是 `WeakSet`(fold.ts:753),清理只靠节点回收 —— 注释 fold.ts:2133-2134 明示「组元素被 React 重挂时 WeakSet 自然失效」 | **成立**(行号偏差 0) |
| C3 | `groupInert`(:2103-2122,attempts>3)真的没有重置事件 | fold.ts:2122 `if (attempts > GROUP_DRIVE_MAX_ATTEMPTS) this.groupInert.add(group)`(`GROUP_DRIVE_MAX_ATTEMPTS = 3`,fold.ts:671);`groupInert` 声明 fold.ts:750 `private groupInert = new WeakSet<HTMLElement>()`;消费点仅 2066、写入点仅 2100(异常)与 2122。**全文件无 `groupInert.delete`** → 只随节点回收失效 | **成立**(行号偏差 0) |
| C4 | 「React memo 复用组 DOM,流式重渲染不重挂 → 豁免跨 pass 常驻」 | CHAT:2289 `const ChatGroupSeat = (0, react.memo)(function ChatGroupSeat(...)`;render key CHAT:5091-5105 `key: chatRenderKey(entry)`,CHAT:1801-1810 group 分支 = `JSON.stringify(["group", entry.key])`;**key 不含流式内容**,故流式更新时 React 复用同一 DOM(不重挂)。key 会变的情形:官方分组重建导致 `extendedGroup` 失配(CHAT:10768 兜底 `brandString(JSON.stringify(["process", first.key, first.groupPart ?? null]))`) | **成立**(静态可判:key 稳定性决定复用;何时换 key 见 CHAT:10836-10849) |

### D. 根因D:回合行 open 态与切会话

| # | 文档结论 | 本次实测证据 | 判定 |
|---|---|---|---|
| D1 | 回合行 open 态存 per-Session store(`createChatStore`,`init:{turnProcesses:[]}`) | 工厂 CHAT:1573-1590 `function createChatStore() { return defineStore({ init: () => ({ turnProcesses: [] }), actions: { setTurnProcessOpen: (draft, turn, answerStep, open) => {...} } }) }`。**但实例化不在 CHAT 内按会话发生**:CHAT:12326 `const chatStore = createChatStore();` 位于 `function apply(ctx)`(CHAT:12274)内,模块级单次执行;CHAT:12408 把它作为 `store: chatStore` 注册到 `conversation.view` 条目上。真正的 per-session 语义在另外三个包里:`conversation.view` 的 scope 由**父入口** `conversation.session` 声明(UI-CONV:18209-18215 `children: { "conversation.view": { kind: "list", scope: "session" } }`);RENDERER:1588-1589 `const scope = this._core.specDynamic(options.name).scope; this._acquire(store, scope)`;RENDERER:1639 `storeOf: (entry, scopeBinding) => entry.store === void 0 ? void 0 : this.resolveStore(entry.store, scopeBinding)`;RENDERER:1691-1703 `if (record.scope === "root") key = ROOT_INSTANCE_KEY; else { if (scopeBinding === void 0) throw ...; key = scopeBinding.key; ... let instance = record.instances.get(key); if (instance === void 0) instance = handle.create(key)`;UI-SESSION:390-396 `return { key: binding.sessionId, ctx: binding.ctx, ... }`。跨代回收:RENDERER:1487-1496 `bindStoreScope` + RENDERER:1747-1753 `releaseStoreScope(key) { for (const record of this._stores.values()) { if (record.scope === "root") continue; record.instances.delete(key) } ... }`。**注意**:文档引用的证据是 `@returns a handle instantiated once per rendered Session scope`(CHAT:1571)与 `/** Per-Session Chat view store. */`(CHAT:1559)——**这是文档注释,不是实现** | **成立**(结论对),但**证据引用错**:单看 CHAT 会得出相反的「apply 级单例、全局共享」 |
| D2 | `ChatNodeSeat processOpen = alwaysOpen || processEntry !== void 0` | CHAT:1674-1679 `const storedEntry = useStore((state) => processSpec === void 0 ? void 0 : storedTurnProcessEntry(state, processSpec.turn)); const processEntry = processSpec !== void 0 && storedEntry?.answerStep === (processSpec.answerStep ?? 0) ? storedEntry : void 0; const liveProcess = processPresentation !== void 0 && !processPresentation.turnClosed; const interleavedInput = ...; const alwaysOpen = liveProcess || interleavedInput || turnProcessAlwaysOpen(routedNode); const processOpen = alwaysOpen || processEntry !== void 0;`。另 CHAT:1681 `if (processSpec !== void 0 && !alwaysOpen) actions.setTurnProcessOpen(...)` → `alwaysOpen` 时按钮的 setOpen 是 no-op | **成立**(行号偏差 0,逐字一致) |
| D3 | 「切会话后 ChatGroupSeat 的官方 effect(outerHidden && root hidden → setOpen(false))把所有组本地 open 置 false」 | effect **确实存在**:CHAT:2315-2321 `(0, react.useEffect)(() => { if (outerHidden && rootRef.current?.hasAttribute("hidden")) setOpen(false); }, [outerHidden, rootRef, setOpen]);`,`outerHidden` 定义 CHAT:2307。**但把它说成「切会话折叠」的机制是错的**:切会话会改变 scope 代际 key(RENDERER:593-599 `sessionGenerationKeyOf(binding)` 按 `binding.ctx` 缓存;RENDERER:1051 `scopeIdentity = ... `session:${sessionGenerationKeyOf(binding)}``;RENDERER:1086 `}, sessionGenerationKeyOf(scopedBinding));`),使整棵子树 **unmount→remount**,ChatGroupSeat 的 `useDisclosure`(CHAT:2294,本地 `useState`,实现 CHAT:1845-1856)随之归零 —— 视觉折叠来自 remount,**不是**该 effect(remount 时 effect 纵使运行,open 本就是 false,是 no-op)。该 effect 的真实触发条件是「outerHidden 翻转为真且 root 已带 hidden」,与切会话无关 | **部分成立**(effect 逐字属实;**归因错误**) |

### E. 「被排除的假设」4 条

| # | 文档结论与理由 | 本次实测 | 判定 |
|---|---|---|---|
| E1 | store 恢复组展开:❌「beforematch 派发在 `[data-step-process-body]` 上**不冒泡**,只触发 ChatGroupSeat reveal,不写 store;组级 open 是本地 useState,官方无重新展开路径」 | (i) 「组级 open 是本地 useState」——**成立**:CHAT:2294 `const { expanded: open, setExpanded: setOpen } = useDisclosure();`;store 只在 2306-2307 被读、且只影响 `outerHidden`,不写组级 open。(ii) 派发点 `body.dispatchEvent(new Event('beforematch'))`(fold.ts:3996-3998,`groupBody` 定义 fold.ts:3931-3933 取 `[data-step-process-body]`)——**成立**。(iii) 「**不冒泡**」——**未经验证的外推**。同源反证:CHAT:4524-4527 `for (const type of READING_INTENTS) scroller.addEventListener(type, this.onIntent, { passive: true, capture: true });` 且 CHAT:4476-4482 `READING_INTENTS = ["wheel","touchstart","pointerdown","keydown","beforematch"]` —— 官方把 beforematch 当**必须捕获**才能在滚动容器上收到的事件,方向与「会冒泡」相反。(iv) **即使**该事件会冒泡,结论仍成立,但理由要换:CHAT:1614 `element.addEventListener("beforematch", reveal);`(无 options,冒泡阶段)注册在**每个 ChatNodeSeat wrapper** 上,而组体与会话流中的节点 wrapper 不是祖先关系——wrapper 在组内部(CHAT:1757-1779 的 wrapper 由 CHAT:2379-2382 `GroupMembers` 渲染在 `[data-step-process-content]` 内)。**真正让结论成立的是结构**:组根与节点 wrapper 是**兄弟**(CHAT:5091-5108 同层映射 `group`→ChatGroupSeat / `node`→ChatNodeSeat),官方 `processHidden` 只作用在节点 wrapper 上(CHAT:1709),永远碰不到组根 | **结论成立、理由不成立**(「不冒泡」属未验证推断;按文档自己的理由,若该推断为假结论就会倒) |
| E2 | groupInert 误入(c2):❌「c2 反冲 effect(CHAT:2315-2321)在 alwaysOpen 组上不运行」 | CHAT:2307 `outerHidden = foldCompleted && presentation?.turnClosed === true && spec !== void 0 && !alwaysOpen && stored?.answerStep !== (spec.answerStep ?? 0)`;`alwaysOpen` 定义 CHAT:2303 `presentation?.turnClosed === false || presentation?.hasInterleavedInput === true || reason === "aborted" || reason === "error"`。直播中 `turnClosed === false` ⇒ `alwaysOpen=true` ⇒ `outerHidden=false` ⇒ 2315-2321 的 effect 体不执行 | **成立**(行号偏差 0) |
| E3 | 「时序/dirty 漏洞」不成立:「partition 每 pass 从当前 DOM 重算;observer 必触发」 | observer 配置 fold.ts:807-826:`observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-selected','data-state','aria-expanded','hidden','data-group-expanded-mode','data-chat-group-part'], characterData: true })`;调度 fold.ts:1996-2001 + 2030-2042(muting 记录并延迟重放,`withMuting` fold.ts:2009-2022 带 250ms 保险);partition 从 `snapshot.groups`(fold.ts:4124 `const groups = range.filter(el => isOfficialGroup(el))`)重算 | **成立**(行号偏差 0) |
| E4 | 「e8bbf36 缓存跳过」不成立(缓存有版本失效) | 缓存族:`kindCache` fold.ts:5086、`rowCollectCache` fold.ts:5079、`flowStructureVersion` fold.ts:5092-5098 由 `invalidateFlowIndexes` fold.ts:5118-5124 → `invalidateRowCollectCache` fold.ts:5113-5115 递增;`markDirty` fold.ts:861-908 在「空批次/非 characterData 批次/flow 祖先变化」时调用 908 `if (flowChanged) invalidateFlowIndexes(flow)`。`git show --stat e8bbf36` 确认为性能批次(`perf: 第一阶段性能优化——批次级段索引 + fold 缓存化`) | **成立**(行号偏差 0) |

### F. 修复方向 4 条

| # | 方向 | 可行性/风险(基于本次实测) | 判定 |
|---|---|---|---|
| F1 | 「最新组」改流粒度:仅最后一个活跃段产出 last,历史段全进 covered;fold.ts:1348 对历史段停止驱动 | **可行**。1348 已是唯一驱动点(全文件 `driveGroups(` 仅 1348/1359/2062);历史段 last 停drive 后,其 last 落入 covered(1710-1713 的 `slice(0, lastVisible)`)→ 由 1359 按 chip 态驱动收起。**现成先例可抄**:同文件已有「最后一个含正文的段」判定 fold.ts:4257-4261 `const keepBody = ...; let lastWithBody = -1; for (let i = snapshots.length - 1; i >= 0; i--) { if (snapshots[i].bodySteps.length > 0) { lastWithBody = i; break } }` —— 注意它与「最后一个段」不同,直接用会错。**风险**:① 语义反转(历史回合的最后一组默认收起),与 1341-1347 注释里 P4 修复的初衷相反;② 「活跃段」定义必须显式排除尾部空/纯组段,否则 `fold-017-safety` C 场景(尾部追加一个 turn:2 组形成第二个开段,fold-017-safety.test.mjs:283)会漂移 | **可行,需先用真实历史回合做语义确认** |
| F2 | 直播段也驱动 covered 收起(state 缺失时以虚拟目标 false 驱动) | **可行**:把 1359 的驱动提到 1353 门控之前、以 `state?.groupsExpanded ?? false` 为目标即可,不需要 chip(1354 的 `ensureSegmentChip` 依赖 state,保持不动)。**风险被文档高估**:文档担心「频繁 click 有焦点成本」,但 `driveGroupOnce`(fold.ts:3990-4015)展开方向走 `body.dispatchEvent(new Event('beforematch'))`(3996-3998,零焦点)、收起/回退方向的 click 也逐按钮中和了自己 button 的 `focus`(4007-4013 `Object.defineProperty(button, 'focus', { value: () => {}, configurable: true, writable: true })`,恰好命中官方 onClick 的 `event.currentTarget.focus()`,CHAT:2263-2265)。**真实风险**:直播期无 chip(无 state)→ 被收起的组只能靠组头按钮自行重开;且每次驱动都会产生 mutation 进入 fold.ts:801-805 的 muting 暂存队列 → 多一轮 pass(收敛,但幅度更大,静态不可判) | **可行,风险点应改列为「直播期无可重开的聚合入口」** |
| F3 | 豁免治理:userOwned 方向化;inert 增加重置事件;attempts 时间窗衰减 | **风险最高的方向**。`fold-017-safety.test.mjs:816-881`(R 组)以间谍计数硬锁 G1:`g1.btn.dispatchEvent('click', { isTrusted: true })`(852)后要求 `clicks.get(g1) === 0`(858-860),对照组 g2 要求 `> 0`(867-869),合成 click 不得接管(872-879)。方向化改造若不慎把「同向冲突」判成可驱动,R1 直接 FAIL。**inert 与 attempts 当前零测试覆盖**(见 ③) | **部分可行**(inert/attempts 侧低回归风险;userOwned 方向化必须连带改 R 用例语义) |
| F4 | 感知「回合行 open 且非最新回合」的段,降级其 last 驱动 | **可行,但有两个不同来源需分别处理**:原生段可读 `button[data-turn-process]` 的 `aria-expanded`(插件已在 fold.ts:1010 `flow.querySelectorAll('[data-turn-process]')` + 1034-1035 `const expanded = btn.getAttribute('aria-expanded') === 'true'` 里做过);**非原生段没有该按钮**(CHAT:6229 直播期不渲染;非 compact 亦无),其「回合行 open」只能取插件自己的 `state.expanded`(fold.ts:1204-1207 持久化恢复)或 live 行的存在。**且 fold.ts:1271-1290 已有「一级展开/chip 谁拥有状态行」的仲裁先例**(chipOwnsStatus)可复用 | **可行,需先明确 open 的判定源** |

---

## ② 报告中的事实错误或行号偏差清单

### 行号偏差:**问题⑤全节 0 偏差**

逐条核对结果(报告行号 → 本次实际读到):1693-1713→1693-1714(闭区间写法)、1348→1348、1130-1131→1130-1131、1353→1353、2067→2067、2103-2122→2122(区间取法)、2142-2154→2142-2154、CHAT 1573-1575/1679/2315-2321→**全部精确命中**。这是本次复核中少见的干净行号。仅两处属写法差异(非错误):
1. `groupPartitionOf` 函数实际在 1714 行收尾,报告写 1693-1713(取到最后一个 return 语句)。
2. `bindGroupGesture` 函数头在 2139,报告写 2142-2154(指向监听器体,语义无误)。

### 事实错误 1(证据链):根因D 用**文档注释**当实现证据

- 报告原文(第 103 行):「回合行 open 态存 per-Session store(bundle createChatStore,`init:{turnProcesses:[]}`,**注释 "instantiated once per rendered Session scope"**)」。
- 该字符串确在 CHAT:1571,但它是 JSDoc。实现侧:CHAT:12326 的 `createChatStore()` 在 `apply(ctx)`(CHAT:12274)里只调用**一次**,CHAT:12408 以 `store: chatStore` 挂到 `conversation.view` 条目;**per-session 语义完全由外部三包决定**(UI-CONV:18211-18214 声明 scope、RENDERER:1588-1589/1639/1691-1703 按 `scopeBinding.key = sessionId` 建实例、RENDERER:1487-1496/1747-1753 按代际回收)。
- 后果:任何只读 CHAT 复核的人会得出**相反**结论(apply 级单例 → 全局共享 → "切会话后 store 仍保留")。文档把最关键的机制外包给了一个注释。

### 事实错误 2(机制归因):「切会话自动折叠」不是 outerHidden effect 干的

- 报告原文(第 103 行):「切换会话 → store 重建空 + flow 重挂 → ChatGroupSeat 的官方 effect(outerHidden && root hidden → setOpen(false))把所有组本地 open 置 false → 视觉"自动折叠"」。
- 实测:切会话改的是 scope **代际 key**(RENDERER:593-599 + 1051 + 1086),React 因此把整棵会话子树 unmount/remount;ChatGroupSeat 的 `useDisclosure` 是本地 `useState`(CHAT:2294、1845-1856),remount 即归零。effect(2315-2321)在 remount 时纵使执行也是 no-op(`open` 本来就是 false)。该 effect 的真实触发条件是 `outerHidden` 翻真 **且** root 已带 `hidden`,与切会话无因果关系。
- 影响:结论「切会话后视觉自动折叠」仍对;但据此推出的**预测**会错(见 ③ 的「切回同一会话」反例)。

### 事实错误 3(理由不成立,结论侥幸成立):排除假设①的「不冒泡」

见 ①E1。`beforematch` 的冒泡语义文档未验证;且按文档自己的推理链,一旦该事件冒泡到会话流内节点的 reveal(CHAT:1614 注册、wrapper 位于组内容内 CHAT:2379-2382),`setOpen(true)`(CHAT:1710-1712)→ `setTurnProcessOpen`(CHAT:1681)→ **确实会写 store**(CHAT:1576-1588)。结论之所以仍成立,靠的是**组根与节点 wrapper 是兄弟**(CHAT:5091-5108)、`processHidden` 只作用于节点 wrapper(CHAT:1709)这条**结构**理由,而不是「不冒泡」。

### 结论正确但表述过强 1:根因A 的「永远是」

见 ①A3。`drivable` 谓词含两个可翻转前提(`[hidden]` 祖先、`data-group-expanded-mode`),二者翻转即可让该组不再是 last。文档写成无条件不变式。

---

## ③ 报告遗漏的反证或反例

1. **遗漏:store 实例按 sessionId 缓存,切回同一会话(同一 ctx 代)展开态会「复活」。**
   RENDERER:1698-1702 `let instance = record.instances.get(key); if (instance === void 0) { instance = record.scope === "root" ? handle.create() : handle.create(key); record.instances.set(key, instance) }`。实例只在代际结束(RENDERER:1492-1496 的 `binding.ctx.effect` 清理)或重新 `bindStoreScope`(1488-1490)时删除。
   **可检验预测(与文档模型不同)**:A→B→A 往返切换,若旧会话 ctx 代未结束,则回到 A 时 `turnProcesses` 仍在,回合行仍 open;若旧代已结束,则清空。文档的「store 重建空」只在后一种情形成立,而它把这条当成了必然。**这条恰好是真机可判**(且文档的真机清单里没有)。

2. **遗漏:`groupInert` / `groupAttempts` 与「跨会话 store 重建」零自动化覆盖。**
   `grep -n "groupInert|groupAttempts|attempts" test/*.mjs` 仅命中 `metrics-unit.test.mjs` 里 model-retry 的 `data.attempts` 数据(482/506/509/526/538/540),**与组驱动防护无关**。文档第 107 行把「groupInert 误入」判为「基本排除」,但该路径既无回归锁、也无真机项(真机项 9 只说「userOwned/inert 命中率(临时日志)」),属于**结论无护栏**。

3. **遗漏:直播期没有原生 turn-process 行(CHAT:6229),而文档在问题⑤的证据链里反复以「用户点开回合行」解释显形面。**
   在**直播期**,该按钮不存在 ⇒ 不存在「用户点开回合行」这条路径;直播期的旧组不收纯由 B3 的 state 门控解释。文档的三场景枚举(第 100 行「①直播回合(行 alwaysOpen)」)把两种不同机制(行恒开 vs 无行)混为一类。

4. **遗漏:「行 open 才显形」的前提对最新回合不成立。**
   CHAT:2303 `alwaysOpen = presentation?.turnClosed === false || ...` ⇒ 直播回合的行恒开(**无按钮、无 disabled 逻辑参与**);而历史回合在 compact 下 `processHidden = controllerInactive || foldable && processMember && !processOpen`(CHAT:1709)会在未点开时把成员藏掉。因此只有「历史回合 + 用户点开过」这一路才真的依赖 store(D1/D2),文档把它当成了根因A/B/C 的普遍放大镜。

5. **遗漏:「不冒泡」这条断言在本仓库既无测试也无真机项。**
   `grep -rn "冒泡|bubbles|beforematch"` 全仓库:src 只有 fold.ts:3965-3983 的注释,测试里只有 fold-chip-drive.test.mjs 的**桩实现**(`body.addEventListener('beforematch', ...)` 于 142-145 行,桩的 `dispatchEvent` 语义由 fake-dom.mjs 自定,不能证真实浏览器行为)。文档的真机清单 11 项里没有这一条,而它恰是排除假设①的支点。

---

## ④ 修复方向的可行性评估与风险(含测试影响与设置冲突)

### 4.1 方案1(流粒度 last)会破坏哪些现有测试?——**当前测试集内:0 个会被破坏**

本次逐夹具核对(判据:同一 `seat(flow,'user')` 到下一个 user/turn-tail 之间是否落有 `makeGroup`):

| 文件 | user 座位数 | 含组夹具 | 段数 |
|---|---|---|---|
| `fold-chip-drive.test.mjs` | 6(157/195/230/255/297/328) | 全部 6 个,组数 3/3/1/3/3/3(161-163、198-201、233、258-260、300-302、331-333) | **每夹具 1 段**(单 user 座位 + 单 turn-tail) |
| `fold-017-safety.test.mjs` | 18(192…827) | 7 个含组块(255+260、329/331、368-370、492、558-561、589-591、619/620、640-642+673、793-795、830-834) | **每块 1 段** |
| 其余 30 个测试文件 | — | `makeGroup` **零命中**(`data-step-process` 只出现在上述两文件) | 不涉及 |

即:所有会断言 `aria-expanded` 的夹具都是单段,「最后一个活跃段」就是该夹具唯一的段,方案1 不改变其结果。**但必须显式排除的陷阱有两处**:
- `fold-017-safety.test.mjs:283` 在 turn-tail **之后**追加一个 `turn:2` 的 outerHidden 组,会形成**第二个(开)段**。若「活跃段」判定写成「最后一个有组的段」,则前一段(2 个可驱动组)会被降级 → 该用例的 C1/C2(body 未被写)仍通过,但同文件其它以「本段最后一组」为前提的**注释级假设**(如 256-259 行「必须有第二个组:让被测组退居非最后一组」)在语义上会漂移。
- `fold-017-safety.test.mjs:834` 的 `makeGroup` 注释明写「第 4 组:A1 规定『最后一组恒展开、不进覆盖集』,需它让 g1~g3 全部落入覆盖集」——方案1 若同时改 covered 的构成,chip 计数的既有断言(K1 `2 个工具组` 于 573-574、L1 `1 个工具组` 于 603-604、L2-1 于 809-811、N2 `3 个工具组` 于 695-698)都依赖「恰为除最后一组外」的口径,**实现时必须让 covered 的构成公式保持 `slice(0, lastVisible)` 不变**,只改变 `last` 的产生段。

### 4.2 方案2(直播段驱动 covered)

- 改动面极小(把 1359 的意图提到 1353 之前),且**不触碰 chip**(1354 依赖 state)。
- 文档列的两个风险中,「焦点成本」基本已被 `driveGroupOnce` 中和(fold.ts:3996-3998 与 4007-4013),**真正的新风险是**:直播期没有 chip ⇒ 被收起的组没有聚合展开入口,用户只能逐个点组头;而官方直播期的组头是可见的(`grouped=true` ⇒ CHAT:2356 `hidden: !grouped` 为 false),所以有入口,但体验从「一屏可见多组」变为「多组收起」。
- 次生风险:每次驱动都产生 mutation → 进 fold.ts:801-805 的 muting 暂存队列 → 2009-2042 再排一轮 pass。收敛性静态不可判(需真机计时)。

### 4.3 方案3(豁免治理)/方案4(回合行感知)

- 方案3 的 userOwned 侧与 `fold-017-safety.test.mjs:816-881` 的 G1 断言**直接耦合**:R1 要求用户点过的组此后 click 计数恒 0;方向化后必须重写该用例的语义(否则「同向不豁免」会立刻让 R1 FAIL)。
- 方案4 与既有设置/状态无冲突,但需明确 open 的读取源(原生按钮 vs `state.expanded`),两者在直播期与历史期恰好互补(见 ①F4)。

### 4.4 与既有设置的语义冲突(**报告完全未提**)

本仓库有两条**部分降级**的保留类设置(报告第 113-117 行的修复方向没有提到它们):

1. `keepLastBodySteps`(仍在生效):默认 1(`src/index.ts:17`、`src/locales.ts:24`),读取 fold.ts:986 `const keepLastBodySteps = Math.max(0, Math.floor(this.keepLastBodyStepsProvider()))` → buildSegments(987、4059)。它决定**每个段保留多少条正文**,收尾在 fold.ts:4257-4268:
   ```
   4257  const keepBody = Math.max(0, Math.floor(keepLastBodySteps))
   4258  let lastWithBody = -1
   4259  for (let i = snapshots.length - 1; i >= 0; i--) {
   4260    if (snapshots[i].bodySteps.length > 0) { lastWithBody = i; break }
   4261  }
   4264    const keepCount = i === lastWithBody ? Math.max(1, keepBody) : keepBody
   ```
   **冲突点**:方案1 与它是**两个独立的「最后段/最后组」概念**,命名相近但语义不同(`lastWithBody` 是「最后一个含正文的段」,不是「最后一个段」)。若实现时复用这一模式,必须避免把「无正文的尾部纯组段」误当最后段。**组合副作用**:`keepLastBodySteps=0` 时非最后段连 finalStep 都折进一级行(4264-4267 的 `keepCount=0`),再叠加方案1 把历史段的最后一组也收起,历史回合将**整体塌缩到只剩一条已处理行/chip** —— 这正是代码自己在 fold.ts:4287-4288 标注的「keepLastBodySteps=0 收起态 = 合法全折叠——已处理行是唯一展开入口,必须保留」边界。结论:**无直接语义冲突,但组合后的可达状态需要显式确认**。

2. `keepLastRows`(已软降级、运行时无效):fold.ts:2272-2274 `const hasRunning = working && block.rows.some(row => rowRunning(row)); const keepRows = KEEP_NONE; const keepRow = (_row: HTMLElement): boolean => false`;注释 2256-2271 声明「设置项 UI 移除、运行时不再生效」,settings.ts:658 同声明。文档的 `keepLastBodySteps` 提法未区分这两者,而问题⑤的修复方向与 `keepLastRows` **无交集**。

---

## ⑤ 无法确认、需要真机的点

| # | 待验证项 | 为何静态不可判 | 与文档真机清单的关系 |
|---|---|---|---|
| 1 | `beforematch` 是否冒泡(以及是否会到达组内节点 wrapper 的 reveal) | 规范行为需真实浏览器;本仓库桩(fold-chip-drive.test.mjs:142-145)只复刻「组自己的 reveal」,不能证冒泡 | **文档清单缺此项**,而它是排除假设①的支点 |
| 2 | 切会话时旧会话 ctx 代是否结束(决定 store 实例被删还是被缓存复用) | 取决于 DSH 会话保活策略与 `bindStoreScope` 的实际调用时序(RENDERER:1487-1496) | 文档清单缺;**有可判预测:切回原会话看回合行是否复活** |
| 3 | 「组根带 outerHidden 时其 title button 是否仍可见可点」 | CHAT:2355-2356 的 `hidden: !grouped` 与 2308 的 `useSearchableHidden(outerHidden)` 谁先生效,取决于渲染期 DOM 实测 | 文档项 8 的细化 |
| 4 | 直播期真实多组同时展开的比例(根因A/B 的实际症状强度) | 依赖真实分组节奏(工具调用间隔、组创建频率) | 文档项 8/9 |
| 5 | 方案2「直播期每次驱动 → 一轮 pass」的收敛幅度与帧率影响 | 运行期性能 | 文档项 9 |
| 6 | `ChatGroupSeat` 的 key 何时真的改变(官方分组重建 → 豁免 WeakSet 自然失效的时机) | 依赖 `added`/`extendedGroup` 在真实流式序列中的命中情况(CHAT:10836-10849) | 文档项 9 的补充 |
| 7 | `groupInert` 在真实直播中的命中率(是否真会累积到 4 次) | 运行期计数 | 文档项 9(仅提 userOwned/inert 命中率,未区分) |

**静态可判、无需真机的部分**(澄清文档第 164-166 行的措辞):根因 A/B/C/D 的机制本身全部静态可判,本次已全部读证;真机项 8/9/10 应为**强度与命中率**验证,而非机制验证。

---

## 结论摘要

- **问题⑤的事实结论整体成立**:根因A(1348 无段门控)、根因B(1130-1131 不建 state → 1353 早退 → 1359 不可达)、根因C(2154 add / 2067 skip / 2122 inert 无重置)全部逐字命中,行号**零偏差**;根因D 的结论(回合行 open 存 per-session store)成立,但证据引错了对象(引的是 CHAT:1571 的 JSDoc,真正机制在 UI-CONV/RENDERER/UI-SESSION 三包)。
- **三处必须修正的判断**:①「切会话自动折叠」的机制是 scope 代际 key 变化导致子树 remount、本地 `useState` 归零,不是 outerHidden effect(CHAT:2315-2321);②排除假设①的「beforematch 不冒泡」是未验证推断,结论实际靠「组根与节点 wrapper 是兄弟」这条结构理由;③根因A 的「一旦曾是 last 就永远是」不严密(drivable 两个前提可翻转)。
- **修复方向**:方案1 在当前测试集内**不破坏任何 last 断言**(所有含组夹具都是单段),但必须保持 covered 的 `slice(0, lastVisible)` 公式不变以免动到 K1/L1/L2-1/N2 的 chip 计数;方案2 的「焦点成本」风险已被 `driveGroupOnce` 中和,真实风险是直播期缺聚合重开入口;方案3 的 userOwned 侧与 fold-017-safety:816-881 的 G1 断言直接耦合;方案1 与 `keepLastBodySteps=0` 的组合会让历史回合塌缩到只剩行/chip(报告未提)。
