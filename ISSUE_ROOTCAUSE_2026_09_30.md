# 0.2.0 根因取证报告:五问题 + 一项架构改进评估(只读排查,未改任何文件)

日期:2026-09-30
排查对象:dsh-auto-collapse @ DSH 0.2.0-rc.2(插件适配止于 0.1.7-rc.2,已验证基本兼容)
排查范围:用户报告的五个问题(①-⑤)的根因取证 + 一项架构改进评估(⑥ 看门狗 SSE 迁移,非缺陷)。
排查方式:五路独立分析——主线程基准推演 + 4 个 subagent(R2 问题②④ / R3 问题③ / 交叉验证 / 对抗验证)交叉比对;R1(问题①专项)中途失败,其任务由交叉验证覆盖。
证据基线:DSH 0.2.0-rc.2 bundle(C:/Users/v_pchunhli/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<包>/lib/client.js,下称 CHAT = dsh-client-ui-chat、TOOL = dsh-client-ui-tool、PRIM = dsh-client-ui-primitives);插件源码本仓库(src/fold.ts 5573 行、src/turn-metrics.ts)。
行号均可复核;**所有修复动手前,文末「需真机验证」清单必须先过**。

---

## 问题① tokensPerSecond 恒为空(含 timeToFirstToken 同源失效)

### 结论(一句话)
0.2.0-rc.2 官方重构 turn-tail,不再把 tokensPerSecond/ttftMs 写入节点 data——插件的权威数据源被删除,显示恒空;fallback 也有真实断链场景。

### 证据链
1. **权威源断供(主因)**:tailData()(CHAT:10414-10436)返回值仅 {turn, seq, time, closing, branchUnavailable, tokenUsage?};turn-tail 的 buildViewNode(CHAT:10480-10483)直接透传该值为 data,无二次加工。插件 turn-metrics.ts:483 读 n.data.tokensPerSecond、:486 读 n.data.ttftMs → 恒 undefined。
2. **tokenUsage 仍在**:官方 tokenUsage(跨 attempt 聚合)未删——断供只限 tps/ttft 两个字段,这解释了其他指标(duration/modelCalls/inputTokens/cacheHitRate/outputTokens/contextDelta)全部正常的现象。
3. **单测为什么是绿的**:test/metrics-unit.test.mjs 桩注释自证「rc.1 turn-tail:权威聚合 + tokensPerSecond 仍在」——桩数据来自旧版真机,官方删字段后桩未更新,典型的桩漂移。
4. **fallback 断链边界**(turn-metrics.ts:311-350 + 401-403):liveDecodeMs 累计要求 settled/interrupted step 的 finalNode.timing.firstTokenTime 为有效数值(CHAT:7517-7526 只在首个 token delta 写入;isTokenDelta CHAT:7406-7413 把 reasoning-delta 非空也判 true——**深度推理模型不会因此断链**,首个 reasoning delta 即写入)。真正断的场景:
   - ① step 无任何 delta 直接 assistant/message 结算;
   - ② interrupted 合成 finalNode(CHAT:7569-7577)无 timing(插件已正确跳过);
   - ③ **历史回合窗口重放**(分页/compaction 后 live-chunk 不在事件窗口内 → fallbackState CHAT:7579-7595 → settleMessage CHAT:7529-7538 不写 firstTokenTime → 历史回合 decodeMs=null)。⚠️ 唯一未决点:持久化是否保留 live-chunk 事件,静态无法确认,需真机验证。

### 修复方向
- **改用官方 deriveStats 同口径自算**(CHAT:6923-6961 + assistantStepReading CHAT:6883-6890):遍历 settled assistant-step,decodeMs=completedTime−firstTokenTime、decodeTokens=usage.outputTokens,tps=decodeTokens/(decodeMs/1e3);官方对 null timing 的处理=该步不累计。插件 accumulateNode 已累计 liveDecodeMs/liveOutputTokens(turn-metrics.ts:337-350),finalizeGroupMetrics 已有 liveDecodeMs>0 fallback(:401-403)——补齐方向明确。
- **ttft 自算** = acc.firstTokenTime − acc.firstStepStart(turn-metrics.ts:311-322 已采集,与官方 CHAT:6886 同口径),归属持首分组。
- **同步更新单测桩**(turn-tail 桩去掉 tps/ttft 权威源假设,改为真机 0.2.0 形状),防再次漂移。

---

## 问题② 「已重试模型请求」把原生组折叠分割为很多个

### 结论(一句话)
分割是 0.2.0 官方分组算法的固有结构(INDEPENDENT 集合含 model-retry,每遇一条即断组)——插件无法消除;用户看到的视觉 = **多截组头折叠按钮 + 重试行夹缝可见**的组合,插件的 P3 对策存在三个覆盖缺口导致重试行未收敛。

### 证据链
1. **官方断组器**:CHAT:10633-10641 `INDEPENDENT = new Set(["user","steering","turn-trigger","model-retry","turn-error","turn-max-tokens","turn-tail"])`;分组循环 CHAT:10797-10802 遇成员即 flush(true) + 单独 emit,后续工具行进 pending、下一次 flush 开新组(flush 组键取 extendedGroup(...)?.key 优先、JSON 串(含 first.key)兜底,CHAT:10765-10785)。多次重试 ⇒ 必然「组、重试行、组…」交错(历史真机:59 组/34 重试行交错)。
2. **区分两个集合**:TURN_PROCESS_INDEPENDENT_KINDS(CHAT:1518)**不含** model-retry → 原生回合行收起时它作为 processMember 被官方 processHidden + useSearchableHidden 藏掉;用户点开回合行(或 alwaysOpen 回合)后可见。
3. **插件层**:分段边界仅 user/steering/turn-tail(fold.ts:4214-4248);model-retry 是状态装饰行(fold.ts:3902 STATUS_ROW_KINDS),进 statusRows(fold.ts:4115-4121),组是不透明容器(fold.ts:3915/4361)。P3 修复(2592612)把块外状态行并入段级 chip 隐藏(fold.ts:1363-1385)。
4. **P3 三个覆盖缺口(用户仍见分割的原因)**:
   - 缺口①:**运行中段不建 segmentState**(fold.ts:1130-1131 `if (!snapshot.closed && !snapshot.terminated) continue` / `if (snapshot.running || !snapshot.hasWork) continue`)→ chip 循环 state===undefined continue(fold.ts:1353)→ P3 不跑——**重试恰恰集中发生在运行中**,症状窗口=整个直播期;
   - 缺口②:nativePassiveSegments 段完全跳过(fold.ts:1336;passive=aborted/error/插话/verbose 回合)→ 无 chip、无隐藏,重试行裸露;
   - 缺口③:块内 statusRows 在块级 restore 分支被无条件放回(fold.ts:2297「单条不折叠」等分支)→ 重试行裸露;另外 chip/段展开态会 restore 重试行(fold.ts:1288/1383)——展开态平铺是设计使然,不算缺陷。
5. **多截组头视觉**:每个 ChatGroupSeat 各带自己的 ProcessGroupHeader 折叠按钮——即使行全藏了,N 个组头仍在。**插件可达上限 = 全部组收起 + 1 个 chip + 重试行隐藏;「物理合并成一个组」需隐藏组根,违反 §4.2 只读保护面(0.1.7 B1 教训:React 永不清除组根残留样式),不可行。**

### 修复方向(P3 三缺口补齐)
1. 运行中段:对段级 statusRows 做「非最新」隐藏(重试链只留最新一条,闭合后交 P3)——复用 sysRowOrder 序列(fold.ts:4177-4190);
2. passive 段:定向隐藏段级 statusRows 但**保留末条**(aborted/error 回合重试行可能是唯一错误线索);
3. 块级 restore 分支(fold.ts:2286-2299)对 statusRows 改「随 chip 意图」而非无条件 restore。
风险:与官方 processHidden 翻转的时序竞态(restoreUnusedDisplays 每 pass 清理可覆盖);passive 段隐藏可能遮错误信息(保留末条缓解)。

---

## 问题③ 「工作步骤展示」为详细/完全展开(verbose)时改用插件自研折叠

### 结论(一句话)
**有条件能,改造量小-中**——现行 fold.ts 的块级二级折叠路径就是 0.1.5 自研折叠的直接演进后裔,不需要整块复活旧代码;verbose 下 React 不管组内行显隐,插件写 display 无回写冲突。

### 证据链
1. **0.2.0 是四档**(CHAT:12100-12129 POLICIES):compact/standard/detailed/verbose;verbose = {foldCompletedTurns:false, stepGrouping:"none", liveProcessDetail:false, settledReasoningPreview:true}。
2. **verbose DOM 推导链**:fold=false → processWindowReady=false(CHAT:1688)→ foldable=false(CHAT:1692)→ 按钮 open=true(CHAT:6227)/canCollapse=false→disabled(CHAT:6230/6250)/aria-expanded="true"(CHAT:6251);stepGrouping="none" → grouped=false → 组头 div 携带 `hidden: !grouped`=false 即**不隐藏**(CHAT:2356,属性存在但值为 false)、组体恒展开、**组体无 hidden/until-found** → React 不再管组内行显隐。
3. **现插件让路路径**(§5.10):nativePassiveTurns(fold.ts:1028-1038,判定=aria-expanded==='true'&&disabled)→ nativePassiveSegments(:1050-1057)→ 4 处消费(:1257/:1336/:2196-2208/:1536)。让路谓词同时命中 aborted/error/插话/运行中——不是 verbose 专属。
4. **旧实现考古**(末代 c8809e4):折叠工具行/think 行/command/compaction,chip 挂块宿主,display:none + originalDisplay WeakMap 记账。依赖现状:selectors 全部存活(TOOL:1434 区 data-variant/tool/state、PRIM DisclosureRow data-disclosure-row/expandable);已消失的 data-follow-end 现行 fold.ts:4681-4686 已有兼容兜底。
5. **⚠️ 判别信号(对抗验证修正,注意方向)**:CHAT:2354 `"data-group-expanded-mode": !grouped || void 0` —— **verbose 下每个组都带该属性;standard/compact 下都不带;detailed 下仅历史回合组带**。充分判别 = 「flow 内组全带 data-group-expanded-mode」**且**「turn-process 按钮恒展开+disabled」(后者单独会误伤 aborted/error——它们在 standard 下组仍是折叠模式、无该属性,组合信号可区分)。

### 推荐设计
- resolveFoldStrategy(flow):'native'(官组驱动)| 'legacyVerbose'(纯块级 chip);单 observer 每 pass 重判;翻转走现有 switchFlow 全清(chip/display/segmentStates/blockExpanded)再重放;
- legacy 分支复用同一块分类器与 chip UI,只替换驱动层(去官组驱动——verbose 组头 hidden 无可驱动按钮);
- 灰度第一步:半接管(verbose 下仅加自研聚合 chip、不隐藏官方行,零风险)。

### 风险
① 模式误判(必须用全局信号);② 策略切换残留(必须全清);③ 双驱动层维护成本;④ React 清 style(机制同 0.1.5,已有成熟处理)。

---

## 问题④ 指标挂原生组行 / 重试行收入折叠

### 结论(一句话)
④a(指标挂原生组标题)可行、低风险、**低收益**,不建议全面迁移;④b(重试行收入折叠)可行,合并进问题②的 P3 缺口修复。

### 证据链(④a)
- turn-process 行挂载**已实现且 0.2.0 兼容**:官方计数属性 data-turn-process-messages/-tool-calls/-subagents 仍在(CHAT:6247-6249),插件指标 span 挂 button[data-turn-process];
- 组标题 button[data-process-activity] 值逐帧变(fold.ts:3945-3946 注释),React 高频重渲染随时摘除追加节点,需每 pass 重挂;N 组只能挂一处;无 chip 段(nativePassive/单组段)确实缺指标落点——这是唯一真实收益。

### 证据链(④b)
- 收起态官方已自动藏重试行(processHidden + useSearchableHidden,data-turn-process-hidden 为官方自产属性)——插件无需复刻;
- 需补的只有问题②的 P3 三缺口(见上);写的是插件命名空间 display 控制,React 摘除即自愈;
- **上限声明**:即使重试行全藏,N 个组头按钮的视觉仍在(官方结构)——视觉收敛已是插件可达上限。

---

## 问题⑤ 「最新组保持展开」有时不收起旧组(切会话后才折叠)

### 结论(一句话)
多因叠加:**根因A(partition.last 每段语义,历史段最后组被每 pass 重驱动展开)+ 根因B(直播期 covered 收起被 state 门控整体关断)+ 根因C(userOwned/inert 元素级永久豁免)**;根因D(store 条目使回合行常驻 open,切会话重置)解释「切会话才折叠」的显形面。

### 证据链
1. **根因A(最高·设计语义)**:groupPartitionOf(fold.ts:1693-1713)对**每个段**独立划分 last(段内最后一个 drivable 组);fold.ts:1348 `if (partition.last !== null) this.driveGroups([partition.last], true)` **无段新旧门控**——历史段的最后组每 pass 被主动驱动展开,对抗任何收起。某组一旦曾是"最新",永远是所在段的 last → 永远展开。可见三场景:①直播回合(行 alwaysOpen);②steering/aborted/error 回合;③用户点开过回合行。
2. **根因B(高·直播期)**:fold.ts:1130-1131 直播段不建 segmentState;fold.ts:1353 `if (state === undefined) continue` 位于 driveGroups(covered) **之前** → 直播段内前一"最新组"整回合不被收起,症状窗口=整个直播期。**这是"新组出现了,旧组没收"最直接的机制。**
3. **根因C(中·永久逃逸)**:bindGroupGesture(fold.ts:2142-2154)任意 isTrusted click(含键盘 Enter/无障碍激活)→ userOwnedGroups.add → driveGroups 永久跳过(fold.ts:2067);React memo 复用组 DOM,流式重渲染不重挂 → 豁免跨 pass 常驻。groupInert(fold.ts:2103-2122,attempts>3)无重置事件,永不再驱动。
4. **根因D(中·解释"切会话才折叠")**:回合行 open 态存 per-Session store(bundle createChatStore,init:{turnProcesses:[]},注释 "instantiated once per rendered Session scope");ChatNodeSeat processOpen = alwaysOpen || processEntry !== void 0 → 用户开过的回合行整会话保持 open → 旧段组持续可见(根因A/B/C 持续显形)。切换会话 → store 重建空 + flow 重挂 → ChatGroupSeat 的官方 effect(outerHidden && root hidden → setOpen(false))把所有组本地 open 置 false → 视觉"自动折叠"。**这是原生 outerHidden 行为,非插件驱动。**
5. **被排除的假设**(三方裁决,防未来重查):
   - store 恢复组展开:❌ 字面不成立——插件 driveGroupOnce 的 beforematch 派发在 [data-step-process-body] 上不冒泡,只触发 ChatGroupSeat reveal(本地 setOpen(true)),不写 store;组级 open 是本地 useState,官方无"重新展开"路径;
   - groupInert 误入(c2):❌ 基本排除——c2 反冲 effect(CHAT:2315-2321)在 alwaysOpen 组上不运行,最新组几乎不可能累积 3 次失败;
   - 时序/dirty 漏洞、e8bbf36 缓存跳过:❌ 不成立(partition 每 pass 从当前 DOM 重算;observer 必触发;缓存有版本失效)。

### 状态机(收敛条件)
组被收起 ⇔ 段已闭合/终止且有工作(state 存在)∧ 组非其段 last ∧ drivable(closest('[hidden]')===null 且折叠模式)∧ 非 userOwned ∧ 非 inert ∧ 目标态≠现值。
逃逸分支:①直播段(state 无);②是段 last(反被驱动为展开);③userOwned;④inert;⑤outerHidden/非折叠模式(不驱动但也不可见)。

### 修复方向(按风险排序)
1. **(推荐)「最新组」改流粒度**:仅最后一个活跃/最新段产出 last,历史段全进 covered;fold.ts:1348 对历史段停止驱动展开。风险:改变 F4 修复语义(历史回合行展开时其最后一组默认收起),需保留 G1 保护。
2. 直播段也驱动 covered 收起(state 缺失时以虚拟目标 false 驱动,或 state 创建时补驱动)。风险:收起只能走 click(无 beforematch 等价),直播期频繁 click 有焦点/性能成本,需与官方 liveProcess 展示对齐。
3. 豁免治理:userOwned 记录接管方向(仅同向冲突豁免);inert 增加"回合闭合/组重挂"重置事件;attempts 加时间窗衰减。风险:可能违背 G1 用户意图保护,需真机校准。
4. (辅助)感知"回合行 open 且非最新回合"的段,降级其 last 驱动。

---

## 问题⑥(架构改进)看门狗轮询迁移到官方 /plugins/events SSE

### 结论(一句话)
可行且净收益为正——**前端性能只会变好不会变差**;但收益是「变化到达毫秒级 + 远程页面省流量」,不是性能抢救;实施时的关键约束是**复用官方订阅,不新增第二条常驻连接**。

### 0.2.0 官方 SSE 机制(源码 + 实测)
- 服务端(dsh-client-hmr lib/index.js,5KB):
  - 路由 `/plugins/events`(EVENTS_ENDPOINT),kind:exact,SSE(text/event-stream);连接建立即推 1 帧全量 graph + `: connected`;
  - 帧类型两种:`{type:"graph",graph}`(onGraphChanged,仅模块图实际变化时推)与 `{type:"rebuilt",id,rev}`(onRebuilt,仅 bundle mtime/size 变化时推);
  - 客户端断开即从 connections 集合摘除;插件卸载时 destroy 全部连接。
- 客户端(dsh-client-hmr lib/client.js,3KB):官方 client half **已经常驻订阅**该 URL(EventSource);graph 帧交模块控制器 entries.sync(frame.graph)(差异 reconcile:entryTargets 比较,无实际变化零重载),rebuilt 帧走 entries.reload(id,rev)。
- 服务端成本(不管迁不迁都在):host half 每 500ms(Config.pollIntervalMs 默认)stat 一轮全部 client bundle 的 mtime/size——纯本地 fs stat,timer.unref(),无网络流量。

### 实测量化(本机 74 个客户端模块,3 秒抓帧)
| 维度 | 现状:轮询 roster(1.5s) | 迁移后:SSE |
|---|---|---|
| 静止期网络流量 | ~3.3KB/次 × 40 次/分 ≈ 130KB/分 + HTTP 头(~280KB/分) | ≈ 0(连接建立推 1 帧 ~31KB JSON;静止期 0 帧) |
| 变化到达延迟 | 最坏 ~1.5s | 推送,毫秒级 |
| 客户端连接占用 | 每次短连接 | 1 条长连接(HTTP/1.1 占 6 条/域配额之一) |
| 单帧大小 | 3.3KB(roster) | ~31KB(graph 全量,74 模块);仅变化时发生 |

### 实施约束与设计(按侵入度递增)
1. **硬约束——不新增 EventSource**:官方 client-hmr 客户端 half 已常驻订阅 /plugins/events;插件自开一条 = 第二条常驻连接,重复消费同一帧流、parse 成本双份(此即下文方案 c,不推荐)。
2. 方案 a(最小):保留探针但大幅拉长间隔(如 30s)作兜底——只降频不增感知,收益有限。
3. **方案 b(推荐)**:插件借力官方已消费的图变化信号(经 slots/store 间接感知官方 client-hmr 的状态发布),自身仅在「自身 404(被禁用)」时保留低频兜底探测;彻底消掉 1.5s 轮询。
4. **保底语义不能丢**:现看门狗「探针 404 = 自身被禁用 → 重载」是启停热生效闭环的一部分;SSE 迁移后 graph 帧本身携带 roster 变化(含自身移除),可用 sig 对比替代;但「node half 卸载后官方 SSE 是否仍推帧」需真机验证——若仍在,404 兜底仍必要。
5. **与官方 reconcile 的竞争**:官方 entries.sync 会 reconcile(可能重挂组件);插件若抢跑 reload 会与之竞争——建议只对比 sig,确认「官方 reconcile 无法处理的变更」时才 reload。
6. **最大受益者**:远程页面(LAN/手机)省掉每分钟 ~40 次请求 + ~400KB 流量;桌面单页面两边无感。
7. SSE 断线重连由 EventSource 内建(官方已处理),复用官方订阅则无需自理。

---

## 需真机验证清单(修复动手前必须先过)

| # | 验证项 | 关联 |
|---|---|---|
| 1 | 历史回合 live-chunk 事件是否可回放(分页/compaction 窗口)——决定 tps 自算对历史回合的覆盖 | 问题① |
| 2 | 多重试回合展开后的真实顶层 DOM 交错序列(组数/重试行数) | 问题②④ |
| 3 | 用户所见分割的具体场景:运行中 / alwaysOpen / 展开历史回合 | 问题② |
| 4 | processHidden 时重试行 hidden 属性实况(决定 hideElement 是否被 isNativeProtected 拦截) | 问题②④ |
| 5 | 0.2.0 设置 UI 实际档位数(类型四档,确认 UI 同步) | 问题③ |
| 6 | verbose 下组 DOM 实况(header hidden / 全组带 data-group-expanded-mode / 组体无 hidden) | 问题③ |
| 7 | detailed 下当前回合组 vs 历史组的属性差异;[data-variant="think"][data-preview] 档位差异 | 问题③ |
| 8 | 直播期新组出现后前一组 aria-expanded 是否恒 true 直到回合闭合(根因B) | 问题⑤ |
| 9 | 疑似卡住的组是否被 fold.ts:1348 每 pass click(根因A);userOwned/inert 命中率(临时日志) | 问题⑤ |
| 10 | steering/aborted 回合行恒开时多段 last 累积展开 | 问题⑤ |
| 11 | 插件被禁用后官方 SSE 的帧行为(自身从 graph 消除时是否推帧;node half 卸载后 SSE 是否存活) | 问题⑥ |

## 附:修复优先级建议(供决策,未拍板)

| 优先级 | 事项 | 关联 |
|---|---|---|
| P1 | 问题⑤收敛修复(根因A 流粒度 + 根因B 直播段收起 + 根因C 方向化豁免) | 三路分析收敛,直接消除"不收敛" |
| P1 | 问题②④:P3 三缺口补齐 | 改动集中在 fold.ts 1131/1336/2297 三处分支 + chip 循环 |
| P2 | 问题①:tps/ttft 自算(deriveStats 口径)+ 单测桩更新 | 字段断供已证实,公式与官方一致 |
| P2 | 问题⑥:SSE 迁移(方案 b:借力官方订阅,消 1.5s 轮询) | 架构整洁性优化;远程页面收益最大 |
| P3 | 问题③:verbose legacy 折叠分支 | 先灰度"半接管"(只加 chip 不隐藏) |

## 附:排查过程存档
- R2(问题②④)、R3(问题③)、交叉验证者(①⑤)、对抗验证者(①②③④)、R4(⑤专项)五路独立交付;R1 中途失败,其任务由交叉验证覆盖。
- 两处经对抗验证修正的关键判断(防止未来再犯):
  1. data-group-expanded-mode 语义方向:「存在=非折叠模式」(verbose 全带;standard/compact 全不带)——直觉容易写反;
  2. 组 open 态是 ChatGroupSeat 本地 useState,chatStore.turnProcesses 只管回合级 turn-process 折叠与 outerHidden,不覆盖组级 open。
