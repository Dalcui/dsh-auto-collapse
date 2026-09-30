# 独立复核报告:问题③ / 问题⑥ / 真机清单 / 优先级建议

复核人:独立审查员(未参与原报告撰写)
复核对象:ISSUE_ROOTCAUSE_2026_09_30.md 的「问题③」「问题⑥」「需真机验证清单」「附:修复优先级建议」
证据基线:dsh 0.2.0-rc.2,C:\Users\wkyiw\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\
性质:只读复核。所有行号均为本次实际读到;与报告有偏差者单独列出。

> 说明:报告第 7 行声明的证据基线路径为 C:/Users/**v_pchunhli**/... ,本次实际基线为 C:/Users/**wkyiw**/... 。
> 包版本、行号完全一致,判定为**报告撰写时的路径笔误**(同机不同用户名),不影响结论。已在第②节记录。

---

## ① 逐条判定表

### 1.1 问题③ — verbose 档自研折叠

| # | 报告结论 | 本次核到的证据(文件:行号 + 片段) | 判定 |
|---|---|---|---|
| ③-1 | 0.2.0 是四档 POLICIES(compact/standard/detailed/verbose),CHAT:12100-12129;verbose = {foldCompletedTurns:false, stepGrouping:"none", liveProcessDetail:false, settledReasoningPreview:true} | CHAT:12100-12129 'const POLICIES = { compact: {...}, standard: {...}, detailed: {..., stepGrouping: "history", ...}, verbose: { mode: "verbose", foldCompletedTurns: false, stepGrouping: "none", liveProcessDetail: false, settledReasoningPreview: true } };'。四项取值**逐字一致**。补充旁证:dsh-client-ui-chat/lib/index.js:9-14 'const TRANSCRIPT_VIEW_MODES = ["compact","standard","detailed","verbose"]',index.js:19/21 另有 legacy normal/expanded 读作 detailed(CHAT:12089 'saved === "normal" \|\| saved === "expanded" ? "detailed" : ...') | **成立** |
| ③-2a | fold=false → processWindowReady=false(CHAT:1688) → foldable=false(CHAT:1692) | CHAT:1688 'const processWindowReady = processSpec !== void 0 && processPresentation !== void 0 && foldCompleted && processPresentation.turn === processSpec.turn && (processPresentation.turnStarted \|\| processPresentation.turnClosed);';CHAT:1687 'const foldCompleted = usePresentation((policy) => policy.foldCompletedTurns);';CHAT:1692 'const foldable = processWindowReady && (liveProcess \|\| processMember \|\| ownsDisclosure);'。**链条成立**,行号精确 | **成立** |
| ③-2b | → 按钮 open=true(CHAT:6227) / canCollapse=false → disabled(CHAT:6230/6250) / aria-expanded="true"(CHAT:6251) | CHAT:6227 'const open = !turnProcess.foldable \|\| turnProcess.open;'(foldable=false ⇒ open=true);CHAT:6230 'const canCollapse = turnProcess.foldable && turnProcess.hasContent && !turnProcessAlwaysOpen(node);';CHAT:6250 'disabled: !canCollapse,';CHAT:6251 '"aria-expanded": turnProcess.hasContent ? open : void 0,'。**逐条成立**。⚠️ 归因需加限定:disabled 的成因**不止** verbose——CHAT:1551-1556 'turnProcessAlwaysOpen()' 对 status==="open"(运行中)/aborted/error 返回 true,同样置 canCollapse=false。报告在问题③里把它单归于 verbose,属**归因简化**(结论不变,但支撑不了"verbose 专属"的推论) | **成立(附限定)** |
| ③-2c | stepGrouping="none" → grouped=false → 组头 div hidden: !grouped=false 即不隐藏(CHAT:2356) | CHAT:2301 'const grouped = props.usePresentation((policy) => policy.stepGrouping === "collapsed" \|\| policy.stepGrouping === "history" && turnLocation?.status !== "open");'(none ⇒ grouped=false);CHAT:2355-2356 '(0, react_jsx_runtime.jsx)("div", { hidden: !grouped, children: (0, react_jsx_runtime.jsx)(ProcessGroupHeader, {...}) })'。**成立** | **成立** |
| ③-2d | "组体恒展开、组体无 hidden/until-found" | CHAT:2325 'const bodyRef = useSearchableHidden(grouped && !open, reveal);' → grouped=false 时 hidden=false → CHAT:1609 'else element.removeAttribute("hidden")',**组体确实无 hidden**。✅ 但"**组体恒展开**"在 verbose 下有语义错位:该 body 是**官方组**的 body(CHAT:2366-2370 '"data-step-process-body": true'),而 verbose 下 stepGrouping:"none" 若真不建组,这段 JSX 根本不执行(报告自己在下文也承认"verbose 组头 hidden 无可驱动按钮")。二者不能同时为真——**报告在同一节内保留了互相矛盾的两个描述** | **部分成立** |
| ③-3 | data-group-expanded-mode(CHAT:2354):**verbose 全带 / standard+compact 全不带 / detailed 仅历史回合组带** | 源码原文 CHAT:2354 '"data-group-expanded-mode": !grouped \|\| void 0,'。代入 ③-2c 的 grouped 定义 + POLICIES:compact(collapsed)/standard(collapsed)→grouped 恒 true→**恒不带** ✅;verbose(none)→grouped 恒 false→**恒带** ✅;detailed(history)→grouped=(turnLocation?.status !== "open"),即**已闭合(历史)回合的组 grouped=true→不带;当前未闭合回合的组 grouped=false→带**。**报告的 detailed 子句方向写反**(详见第②节 E1)。同报告第 182 行又写"standard/compact 全不带"(未提 detailed),与第 66 行"detailed 下仅历史回合组带"**自相矛盾**,两句必有一错 | **部分成立**(verbose/compact/standard 成立;detailed **不成立**) |
| ③-4 | 现插件让路路径 nativePassiveTurns(fold.ts:1028-1038)、nativePassiveSegments(:1050-1057)、4 处消费(:1257/:1336/:2196-2208/:1536) | fold.ts:1028-1039 'const nativePassiveTurns = new Set<string>() ... if (expanded && btn.hasAttribute('disabled')) nativePassiveTurns.add(t)'(**判定=aria-expanded==='true' && disabled,与报告一致**);fold.ts:1051-1057 'const nativePassiveSegments = new Set<string>() ... if (keys !== undefined && keys.turn !== undefined && nativeOpenTurns.has(String(keys.turn))) nativeOpenSegments.add(segment.key)'(注意:此循环只填充 nativeOpenSegments;nativePassiveSegments 实际在 fold.ts:1109 'if (passive) nativePassiveSegments.add(segment.key)' 填充,报告把两段混述);消费点 fold.ts:1257 'const passiveSeg = blockSegment !== null && nativePassiveSegments.has(blockSegment.key)' ✅、fold.ts:1336 'if (nativePassiveSegments.has(segment.key)) continue' ✅、fold.ts:2196-2208 'if (nativePassive) { ...stale.chip.remove()... restoreElement(...) return }' ✅(函数签名段在 2158-2167);**fold.ts:1536 不是本功能的消费点**——它是 toggleExpandAll() 里对 'button.hasAttribute('disabled')' 的 click 守卫(fold.ts:1527-1539),与 nativePassive 集合无数据流关系。故"4 处消费"实为 **3 处消费 + 1 处同谓词的独立守卫** | **成立(①处归类不准)** |
| ③-5a | 旧实现考古(末代 c8809e4):折叠工具行/think 行/command/compaction、chip 挂块宿主、display:none + originalDisplay WeakMap 记账 | 提交存在且 hash 精确:c8809e4 'feat(metrics): modelCalls 只计成功完成调用,重试拆为独立 retryCalls 字段'(2026-09-23)。在 git show c8809e4:src/fold.ts 中:chip 挂块宿主 '第28行: 在块宿主**原位**插入 chip';display+WeakMap:c8809e4:src/fold.ts:604 'private originalDisplay = new WeakMap<HTMLElement, string>()'、:2073 'if (!this.originalDisplay.has(el)) this.originalDisplay.set(el, el.style.display)'、:2083 "el.style.display = 'none'"、:2095-2101 还原并 delete;think 行:CSS 类 .dshcf-merged-think(c8809e4:319)、[data-variant="think"](c8809e4:2758/3593);command/compaction:c8809e4:2836 'const selector = ''[data-chat-call-id] [data-disclosure-row], [data-chat-flow-kind="command"] [data-disclosure-row], [data-chat-flow-kind="manual-compaction"] [data-disclosure-row]'''、:3541/3575。**四项描述全部落实** | **成立** |
| ③-5b | "依赖的 selectors 至今存活":TOOL:1434 区 data-variant/tool/state;PRIM DisclosureRow data-disclosure-row/expandable | TOOL:1716-1720 '(0, react_jsx_runtime.jsxs)("div", { className: ToolRow_module_css_default.root, "data-variant": variant, "data-tool": toolName, "data-state": state, ...})' —— **data-variant/data-tool/data-state 三属性确实存活**;但报告写的行号 **TOOL:1434 是 CSS 常量行**('const css$3 = ".o3BgMG_root{...}"'),真正的属性写入在 **TOOL:1716-1720**,偏差约 **+282 行**。PRIM:'dsh-client-ui-primitives/lib/index.js:3156' 'const DisclosureRow = memo(function DisclosureRow({ icon, title, open, expandable, onToggle, running = false, expandOnRowClick = false, previewChevron = expandable, keepContentWhenOpen = fal...'、:3177 '"data-disclosure-row": true,'、:3178 '"data-expandable": rowExpands \|\| void 0,'。另核:data-chat-call-id 在 TOOL:1859、data-subcalls 在 TOOL:1890,**均存活** | **成立(行号有偏差,见②)** |
| ③-5c | 已消失的 data-follow-end 现行 fold.ts:4681-4686 已有兼容兜底 | CHAT 全文档 data-follow-end **0 命中**(确认已移除);fold.ts:4681-4683 注释"旧的实时锚点 [data-follow-end] **已完全移除**(全文档 grep 0 命中) ... 保留 [data-follow-end] 作为旧版 DSH 的兜底(新 DOM 恒为 null,零成本)";fold.ts:4686 'const follow = row.querySelector<HTMLElement>(''[data-follow-end]'')'。**成立,行号精确** | **成立** |
| ③-6a | recommended design 可行(resolveFoldStrategy / 单 observer 每 pass 重判) | 技术上可行:observer 已在 fold.ts:808-826 配置 'attributeFilter: ['data-selected', 'data-state', 'aria-expanded', 'hidden', 'data-group-expanded-mode', 'data-chat-group-part']',即**策略翻转所需的两个谓词(aria-expanded、data-group-expanded-mode)都已在观察面内**,每 pass 重判具备触发条件 | **成立** |
| ③-6b | "翻转走现有 switchFlow 全清(chip/display/segmentStates/blockExpanded)再重放" | fold.ts:1421-1457 'private switchFlow(next)' 确实清理:pendingAnims(1426-1430)、animatableKeys/animatableSegmentBlocks(1431-1432)、chips(1433-1434)、mergedThinks(1435)、segmentStates(1436-1440)、currentBlocks(1441)、blockExpanded(1442)、runningSince/liveTurnStarts/completedOnce(1443-1445)、liveRows(1446-1447)、bodyTextCache(1452)、dirtyMessages(1453)、restoreAllDisplays(1454)、restoreTurnStatus(1455)。**报告点名的四项全部在内**。⚠️ 但**它清不掉两条永久豁免**:fold.ts:750 'private groupInert = new WeakSet<HTMLElement>()'、fold.ts:753 'private userOwnedGroups = new WeakSet<HTMLElement>()' —— **WeakSet 不可遍历,switchFlow 无法清理**,且注释(752)明说豁免是**元素级**的、靠 React 重挂新元素才自然失效。因此"策略切换必须全清"在现有 switchFlow 里**只具备一半**(display/chip/state 全清具备;豁免态全清**不具备**),报告把"全清"直接当成已具备的能力 | **部分成立** |

### 1.2 问题⑥ — 看门狗迁移到官方 /plugins/events SSE

| # | 报告结论 | 本次核到的证据 | 判定 |
|---|---|---|---|
| ⑥-1a | 路由 /plugins/events(EVENTS_ENDPOINT),kind:exact,SSE(text/event-stream) | dsh-client-hmr/lib/index.js:5 'const EVENTS_ENDPOINT = "/plugins/events";';:141-152 'ctx.webServer.register({ kind: "exact", path: EVENTS_ENDPOINT, handler: (req,res)=>{ if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return } connect(res) } })';:125-129 'res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" })' | **成立** |
| ⑥-1b | 连接建立即推 1 帧全量 graph + : connected | index.js:130-135 'res.write(": connected\n\n"); connections.add(res); res.write(sseData({ type: "graph", graph: ctx.clientModules.graph() }));' | **成立** |
| ⑥-1c | 帧类型两种:graph(onGraphChanged 推)与 rebuilt(id,rev)(onRebuilt 推) | index.js:117-123 'const publishGraph = () => { const line = sseData({ type: "graph", graph: ctx.clientModules.graph() }); for (const res of connections) res.write(line) }';:153-161 'const unsubscribeGraph = ctx.clientModules.onGraphChanged(publishGraph); const unsubscribe = ctx.clientModules.onRebuilt((id, rev) => { const line = sseData({ type: "rebuilt", id, rev }); for (const res of connections) res.write(line) });' | **成立** |
| ⑥-1d | 客户端断开即从 connections 摘除;插件卸载时 destroy 全部连接 | index.js:136-138 'res.on("close", () => { connections.delete(res) });';:162-168 'return () => { unsubscribeGraph(); unsubscribe(); disposeRoute(); for (const res of connections) res.destroy(); connections.clear() }'(整个路由+订阅+drain 都在**同一个** ctx.effect(..., "client-hmr: /plugins/events channel") 里) | **成立** |
| ⑥-2a | HMRCLIENT 已常驻订阅该 URL(EventSource) | dsh-client-hmr/lib/client.js:63-66 'ctx.effect(() => { const source = new EventSource(EVENTS_ROUTE); source.addEventListener("message", (event) => {...';:45 'const EVENTS_ROUTE = "/plugins/events".slice(1);';:77-79 卸载时 source.close() | **成立** |
| ⑥-2b | graph 帧交 entries.sync / rebuilt 帧走 entries.reload | client.js:57-62 'const entries = ctx.modules.entries; const handle = (frame) => { (frame.type === "graph" ? Promise.resolve().then(() => entries.sync(frame.graph)) : entries.reload(frame.id, frame.rev)).catch((error) => { ctx.logger.error(error) }) };'。⚠️ 细节:graph 分支外面套了 Promise.resolve().then(...)(**微任务延迟**),rebuilt 分支是直接调用——报告写成并列的"交/走",未提这个非对称性(不影响结论) | **成立** |
| ⑥-3 | host half 每 500ms stat 全部 client bundle(Config.pollIntervalMs 默认 500) | index.js:22 'const Config = z.object({ pollIntervalMs: z.number().step(1).min(1).default(500) });';:79-92 'const pollWatches = () => { for (const [id, watch] of watched) { ... current = bundleStat(watch.path) ... } }';:108-109 'const timer = setInterval(pollWatches, pollIntervalMs); timer.unref();';:28-35 bundleStat = statSync(path) 取 mtimeMs/ctimeMs/size。轮询集由 :93-104 syncWatches() 从 ctx.clientModules.graph().entries + artifactBaseline(row.id) 建立 | **成立** |
| ⑥-4 | **方案 b**:插件借力官方已消费的图变化信号(经 slots/store 间接感知官方 client-hmr 的状态发布) | **未找到任何这样的公开 seam**。逐条反证见下 | **不成立** |
| ⑥-4-反证1 | — | dsh-client-hmr/lib/client.js:51 'const inject = ["modules"];',:57 'const entries = ctx.modules.entries;' —— 它只**消费**服务,自己**没有** provide/exports 任何状态。全文件仅 90 行,导出面只有 exports.apply/inject/name(:83-85) | 反证 |
| ⑥-4-反证2 | — | 官方 client-modules 唯一对外提供的是模块系统本身:lib/client.js:868 'ctx.reflect.provide("modules", modules);'。该对象的**公开**成员(text 声明,lib/types 侧):manifest(原始 __DSH_BOOT__ 形状)、entries,**没有** graphRows(它是 :522 'graphRows = new Map()' 私有字段,只在 :550/:789/:817 等内部使用)。能读到的 roster 只有 window.__DSH_BOOT__.entries(parseBootManifest 的输入,:108-140) | 反证 |
| ⑥-4-反证3 | — | 最接近的候选是 ctx.modules.entries.state(:216-225),'{ getSnapshot: () => this.snapshot, subscribe: (listener) => {...} }'。但① 它的快照形状是 {syncing, failures}(:226-229),**不含任何 roster/图 id 集合**;② 即使退而求其次监听"有过一次 sync"作为自身被禁用/启用的代理信号,它也不会为"成员变化但 entryTargets 未变"发通知——:276-282 'sync(graph) { const manifest = parseBootManifest(graph); if (entryTargets(manifest) !== entryTargets(this.desired)) this.generation++; this.desired = manifest; const generation = this.generation; return this.enqueue(() => this.reconcile(generation)) }',而 entryTargets(:204-211)只序列化 [row.id, row.rev, row.inject, row.external];③ 该 seam 的文档注释自述用途是 ":216 /** Stable observable consumed by page diagnostics through the renderer''s injected hook. */",即面向官方 renderer 诊断;我在官方全部 200+ package 里 grep entries.state **0 命中**,说明它也**没有任何官方消费者**,更无面向第三方插件的文档化契约 | 反证 |
| ⑥-4-反证4 | — | 报告点名要查的两个地方都没有这个 seam:dsh-client-ui-slots/lib/index.js 全文 grep graph/hmr/clientModules/rebuilt **0 命中**;dsh-client-store/lib/index.js 同样 **0 命中**。dsh-client-ui-renderer/lib/client.js grep modules.entries/entries.state 亦 **0 命中** | 反证 |
| ⑥-5a | 硬约束——不新增 EventSource(HTTP/1.1 每域 6 连接) | 约束方向本身合理(第二条常驻连接会重复消费同一帧流、parse 成本双份——这点成立),但报告给出的**理由("HTTP/1.1 占 6 条/域配额之一"作为风险来源)方向可疑**:总量才 1 条,占 1/6,在同一部署下(Web 是 http://127.0.0.1:3080,LAN 亦然)并非压力源。HTTP/2 或本地回环下该理由更弱。真正成立的理由是"重复消费",不是"配额" | **部分成立** |
| ⑥-5b | 方案 d(直接自开 EventSource)的真实代价 | 报告未展开。**实测代价至少两条是报告漏掉的**:(1) 插件自开的 EventSource **能**收到同样的帧(路由是公开 exact 路由),这点没问题;(2) 但它与官方 client-hmr 消费的是**同一帧流**:官方收到 graph 会 entries.sync() → 可能 tearDown/import/reconcile 组件(client-modules:376-440),插件若在同一帧上抢先 location.replace 重载,会与官方 reconcile 竞争(报告第 147 行只把这列为"建议",未列为方案 d 的**必然**代价);(3) 插件侧需自行处理断线重连语义与 404 兜底的**并存**关系(EventSource 内建重连 vs 原 404 语义),报告第 149 行说"复用官方订阅则无需自理"——方案 d 下这句不适用 | **部分成立(代价被低估)** |

### 1.3 「需真机验证清单」11 项(见第⑤节详评)

| 清单项 | 报告的归类 | 本次判定 |
|---|---|---|
| 1 历史回合 live-chunk 回放 | 真机 | **确实必须真机** |
| 2 多重试回合展开后真实 DOM 交错序列 | 真机 | **确实必须真机**(但"必然交错"已静态可证) |
| 3 用户所见分割的具体场景 | 真机 | **确实必须真机**(人因) |
| 4 processHidden 时重试行 hidden 实况 | 真机 | ⚠️ **静态可判**——报告把可静态确认的推给了真机 |
| 5 0.2.0 设置 UI 实际档位数 | 真机 | ⚠️ **静态可判**,且报告自己在 ③-1 已断言四档(自相冗余) |
| 6 verbose 下组 DOM 实况 | 真机 | **部分静态可判**(属性/隐藏三项已可静态推出);"组是否真实存在/数量"须真机 |
| 7 detailed 下当前 vs 历史组属性差异 | 真机 | ⚠️ **静态可判**;且报告给的预期方向是错的,会污染真机判读 |
| 8 直播期前一组 aria-expanded 恒 true | 真机 | ⚠️ **静态可判**(CHAT:1676/1688/1692/1551-1556/6227/6230 已构成确定性推导) |
| 9 每 pass click / userOwned / inert 命中率 | 真机 | **确实必须真机**(运行期统计) |
| 10 steering/aborted 回合行恒开时多段 last 累积 | 真机 | **部分静态可判**(fold.ts:1348 + 1693-1713 + 1726 已可推出) |
| 11 插件禁用后官方 SSE 帧行为 | 真机 | **部分静态可判**:HMRHOST 的连接/路由生命周期完全挂在 client-hmr 自己的 ctx.effect 上,与第三方插件无关 ⇒ "插件卸载后 SSE 仍存活"静态可判✅;仅"模块图变化是否必然触发 onGraphChanged"需查 node 侧 clientModules 或真机 |

### 1.4 「修复优先级建议」排序(见第⑤节详评)

| 报告排序 | 本次判定 |
|---|---|
| P1 问题⑤收敛 | **成立但应排第 2**(风险面最大:G1 用户意图保护 + F4 语义变更) |
| P1 问题②④ P3 三缺口 | **成立且应排第 1**(改动局部、有现成夹具、无架构风险、是④b 前置) |
| P2 问题① tps/ttft 自算 | **成立**(口径可静态对齐) |
| P2 问题⑥ SSE 迁移 | **不成立/应末位暂缓**(方案 b 不可实现;方案 d 有真实代价;a 收益有限;非缺陷) |
| P3 问题③ verbose | **成立**(最低优先级正确) |

---

## ② 报告中的事实错误与行号偏差清单

### E1(最重要·结论性错误)data-group-expanded-mode 的 **detailed 子句方向写反**

- 报告第 66 行:「**verbose 下每个组都带该属性;standard/compact 下都不带;detailed 下仅历史回合组带**」
- 源码:CHAT:2301 'const grouped = props.usePresentation((policy) => policy.stepGrouping === "collapsed" || policy.stepGrouping === "history" && turnLocation?.status !== "open");';CHAT:2354 '"data-group-expanded-mode": !grouped || void 0,'
- 代入 detailed(stepGrouping:"history"):**已闭合(历史)回合**的组 → status !== "open" 为真 → grouped = true → !grouped = false → **不带属性**;**当前未闭合回合**的组 → status === "open" → grouped = false → **带属性**。
- 结论:detailed 下带属性的是**当前(未闭合)回合的组**,不是**历史回合组**。报告写反了方向,与她自己在同一行前半句给出的定义(「存在=非折叠模式」)冲突 —— 历史回合在 detailed 下恰恰是**折叠模式**。
- 影响面:报告第 162 行真机清单第 7 项「detailed 下当前回合组 vs 历史组的属性差异」若按此预期去实测,会把正确现象判为异常。
- 影响面(限定):报告给出的**可用判别信号**第 66 行后半句「flow 内组全带 data-group-expanded-mode」**仍然正确**——因为只有 verbose 是 stepGrouping:"none"(恒 grouped=false)。所以这条错误**不改变方案的可用性**,只改变对 detailed/单组的解释。

### E2(自相矛盾)第 66 行与第 182 行互斥

- 第 66 行:detailed 下**仅历史回合组带**该属性(即 detailed 至少部分带)。
- 第 182 行:「「存在=非折叠模式」(verbose 全带;standard/compact 全不带)」——**完全未提 detailed**,读起来像 detailed 也不带。
- 二者必有一错。按源码,第 66 行的 detailed 子句错、第 182 行的表述不完整。

### E3(行号偏差)TOOL:1434 区 不是属性写入点

- 报告第 65 行:「TOOL:1434 区 data-variant/tool/state」。
- 实测 TOOL:1434 是 CSS 常量行:'const css$3 = ".o3BgMG_root{flex-direction:column;display:flex}...";'(该 CSS 文本里确实含 [data-tool^=cordis_] 选择器,可能是误引来源)。
- 真正的属性写入:**TOOL:1716-1720**,'"data-variant": variant, "data-tool": toolName, "data-state": state'。**偏差约 +282 行**。
- 同一行号的「PRIM DisclosureRow data-disclosure-row/expandable」**准确**:PRIM:3156(DisclosureRow 定义)/3177('"data-disclosure-row": true')/3178('"data-expandable"')。

### E4(归类不准)fold.ts:1536 不是 nativePassive 的消费点

- 报告第 64 行把 :1536 列为 nativePassive 的「4 处消费」之一。
- 实测 fold.ts:1536 'if (button.hasAttribute(''disabled'')) continue' 位于 toggleExpandAll()(fold.ts:1507-1541),是**全局展开/收起快捷键**对原生行的 click 守卫,与 nativePassiveSegments/nativePassiveTurns 之间**没有数据流**。
- 实际消费点为 **3 处**:fold.ts:1257、fold.ts:1336、fold.ts:2196-2208(函数签名 fold.ts:2166 'nativePassive = false')。

### E5(表述混淆)fold.ts:1050-1057 的循环填充的不是 nativePassiveSegments

- 报告第 64 行:「nativePassiveSegments(:1050-1057)」。
- 实测 fold.ts:1051-1057 的循环只填 nativeOpenSegments(:1056);nativePassiveSegments 是在 fold.ts:1102-1109 由 'const passive = keys.turn !== undefined && nativePassiveTurns.has(String(keys.turn))' → 'if (passive) nativePassiveSegments.add(segment.key)' 填充。集合存在性与语义都对,只是**填充位置被写错一段**。

### E6(路径笔误)报告第 7 行的证据基线路径

- 报告写 C:/Users/v_pchunhli/AppData/...;本机实际为 C:/Users/wkyiw/AppData/...。包版本(0.2.0-rc.2)与所有抽查行号一致,判定为撰写机/复核机用户名差异的记录笔误,不影响任何结论。

### E7(未标注的归因简化)disabled 的成因

- 报告第 63 行把 disabled 完全归因于 verbose(foldable=false)。实测 CHAT:6230 'canCollapse = turnProcess.foldable && turnProcess.hasContent && !turnProcessAlwaysOpen(node)',而 CHAT:1551-1556 的 turnProcessAlwaysOpen 对运行中/aborted/error 同样返回 true。报告第 64 行自己也承认"让路谓词同时命中 aborted/error/插话/运行中",与第 63 行的单因归因**措辞冲突**(结论未被推翻,但支撑链不严)。

### 行号精确的部分(供对照)

CHAT:12100-12129、CHAT:1687/1688/1692、CHAT:6227/6230/6250/6251、CHAT:2354/2355/2356、fold.ts:1028-1039、fold.ts:1257/1336/2196-2208、fold.ts:4681-4686、c8809e4 全提交 —— **报告给出的行号在问题③主体链条上零偏差**,偏差集中在 E3/E4/E5 三处次级引用。

---

## ③ 报告遗漏的反证或反例

### ③-1 【最重要】「verbose 下 React 不再管组内行显隐」这一**前提**缺乏证据,且与报告的判别信号打架

- 报告第 59 行:「verbose 下 React 不管组内行显隐,插件写 display 无回写冲突」;第 70 行又说「legacy 分支复用同一块分类器与 chip UI,只替换驱动层(**去官组驱动——verbose 组头 hidden 无可驱动按钮**)」。
- 前一句假设 verbose 下**有组但组内行不被 React 管**;后一句假设 verbose 下**组头处于 hidden 状态**。两处描述无法同时成立,报告没有给出 verbose 下组的**存在性**判定。
- 本次核到的确定事实:CHAT:2301 的 grouped 只影响 CHAT:2356 的 'hidden: !grouped' 与 CHAT:2354 的属性,**不影响组本身是否渲染**;全 BUNDLE grep stepGrouping 仅命中 12003/12104/12111/12118/12125/12129/12148/12247/2301/2072(注释) 等处,**未找到任何"stepGrouping===''none'' 时不建组"的消费者**。
- 另有反例说明"组内行不受管"不成立:CHAT:1709 'const processHidden = controllerInactive || foldable && processMember && !processOpen;' 与 CHAT:1710 'const wrapperRef = useSearchableHidden(processHidden, ...)',以及 CHAT:1768 '"data-turn-process-hidden": processHidden || void 0,',是**与 stepGrouping 正交**的另一套隐藏机制,在 verbose 下照样参与计算。
- 判定:**这是报告问题③最关键的证据缺口**,应升级为真机第 6 项的首要内容(先判"verbose 下一个回合渲染出几个 [data-step-process]、组头是否 hidden"),在拿到该结论前,legacyVerbose 的"去官组驱动"设计没有立足点。

### ③-2 【最重要】「策略切换必须全清」不完整:两条永久豁免不进 switchFlow

- 报告第 69 行把「翻转走现有 switchFlow 全清」当作已具备的机制。
- 反证:fold.ts:750 'private groupInert = new WeakSet<HTMLElement>()'、fold.ts:753 'private userOwnedGroups = new WeakSet<HTMLElement>()'。**WeakSet 不可枚举**,switchFlow(fold.ts:1421-1457)不可能清理它们;fold.ts:752 的注释明确:豁免是元素级的,只有"组元素被 React 重挂 → 新元素 → WeakSet 自然失效"才复位。
- 后果:在 native 策略下被 userOwnedGroups/groupInert 豁免的组元素,如果**跨策略翻转仍然存活**(同一 flow、同一 React 复用元素),legacyVerbose 分支会**继承这些豁免而不再驱动它们**——正是报告第 74 行"② 策略切换残留(必须全清)"想避免的现象,但报告没有指出"全清"当前**做不到**。
- 附带:该缺口同样命中报告问题⑤的根因C,两处修复应合并设计(见第⑤节排序理由)。

### ③-3 「verbose 下组头 hidden」需要一个本次无法确证的中间步骤

- 报告第 70 行括号里的解释「verbose 组头 hidden 无可驱动按钮」要成立,需要 grouped === true(因为 hidden 来自 !grouped)。
- 但 verbose 策略里 stepGrouping === "none",按 CHAT:2301 应得 grouped === false(即组头**不** hidden)。报告此处与 ③-2c 的推导**方向相反**。
- 除非"verbose 下根本不建组、组头 DOM 不存在",否则该句不成立。报告未给出该前提,属**未证成的支撑句**。真机核实项见真机第 6 项。

### ⑥-1 【最重要·关键挑错】方案 b 依赖的公开 seam **不存在**

报告第 145 行:「方案 b(推荐):插件借力官方已消费的图变化信号(**经 slots/store 间接感知官方 client-hmr 的状态发布**),自身仅在「自身 404(被禁用)」时保留低频兜底探测;彻底消掉 1.5s 轮询。」

逐条反证(证据见 ①1.2 的 ⑥-4-反证 1~4):

1. **官方 client-hmr 客户端 half 不发布任何东西**。dsh-client-hmr/lib/client.js 全文 90 行,inject = ["modules"](:51),只消费 ctx.modules.entries(:57),把 graph 交给 entries.sync(:59),**没有 exports 状态、没有 provide、没有 slot、没有 store 写入**。它自己就是这条 SSE 的**终点**,不是中转站。
2. **被消费的对象(官方的 modules 服务)没有可读的公开 roster**。client-modules/lib/client.js:868 'ctx.reflect.provide("modules", modules)' 暴露的是模块系统;其公开字段是 manifest/entries,而 graphRows(:522)是私有、**不在 d.ts 公开面**。第三方插件能拿到的最新 roster 只有 window.__DSH_BOOT__.entries——那是**页面启动时**的快照,不是"变化信号"。
3. **最接近的候选 entries.state 也不构成变化信号**。它只在 :317-325(reload)与 :381-384/:436-439(reconcile)发布 {syncing, failures};而 **reconcile 每次 sync 都发布**(:381、:436 无条件),但它发布的内容**不含 roster**。想用它反推"插件被启停"需要额外拿到 entries.manifest,而 manifest.modules 在 :108-173 的 parseBootManifest 里是 {id,url,rev,inject,external,initialUrl} —— **恰好是报告(以及现有看门狗)需要的 id 集合**。所以理论上存在一条**半公开**路径:ctx.get('modules').entries.manifest.modules.map(r=>r.id),state.subscribe 只当"有新快照可读"的触发器。
   - 但这条路径**不是**报告描述的"graph 变化信号/(官方)状态发布":① manifest 不在 d.ts 公开面(私有字段,我未在 lib/types/ 找到其声明);② state 的通知只带 {syncing, failures};③ 该 observable 的注释自述用途是"page diagnostics through the renderer's injected hook"(:216),而我在官方全部 package 中 grep entries.state **0 命中**,即**连它声称服务的官方消费者都不存在**,更谈不上面向第三方的契约。
   - 实操后果:走这条路 = 绑定在一条**无文档、无官方消费者、升级即可能消失**的私有字段上,比现状(自建探针路由 + 1.5s 轮询)的**鲁棒性更差**。
4. **报告点名的两个地方都没有**。ui-slots 与 client-store 两个包对 graph/hmr/clientModules/rebuilt 的 grep 均为 **0 命中**。

**结论:方案 b 按报告描述(经 slots/store 间接感知官方 client-hmr 的状态发布)不可实现。**若坚持"零新增连接"的目标,可行的只有:方案 a(拉长间隔,收益有限)、方案 c(自开第二条 EventSource,报告已列为不推荐但**技术上可行**——路由是公开 exact 路由,任何客户端插件都能订阅)、或"绑定 modules.entries.manifest + 私有 state 订阅"(见上,不推荐)。

### ⑥-2 报告漏掉的两条与方案 d 相关的代价

除 ①1.2 ⑥-5b 列出的竞争与重连语义外:
1. **entries.sync 是微任务包装**(client.js:59 'Promise.resolve().then(() => entries.sync(frame.graph))'),意味着官方对 graph 帧的处理**至少晚一个微任务**且**异步 reconcile**(client-modules:376-440 内有多次 await)。插件若在同一帧上同步 location.replace,几乎必然**先于**官方 reconcile 完成——报告第 147 行把"抢跑竞争"写成建议条款,但它其实是**方案 d 的确定性行为**。
2. **HMRHOST 的 graph 帧不含"谁被移除"的增量**,而是**全量 graph**(:118-121 'graph: ctx.clientModules.graph()')。报告第 146 行说「graph 帧本身携带 roster 变化(含自身移除),可用 sig 对比替代」——这一点成立且是好消息(插件可用与现 rosterSignature 同构的算法),但报告没有说明:要拿到"自身是否仍在图中",方案 d 必须**自行解析全量 graph**;而这一帧官方**已经在解析**(client.js:19-40 parsePluginsEventFrame 只校验信封,真正解析在 entries.sync)。这正是"重复消费"的具体形态。

### ⑥-3 报告对"6 条连接配额"的风险叙述方向可疑(非结论性,但会误导决策)

- 报告第 139 行把「1 条长连接(HTTP/1.1 占 6 条/域配额之一)」同时列为**迁移后的收益**(相比"每次短连接")与第 143 行**硬约束的理由**。
- 同一次迁移不可能既"只占 1 条"构成新增连接的风险、又作为收益。事实是:迁移**净增** 1 条常驻连接(从 0 条常驻变成 1 条),短连接本来就不是常驻配额占用。作为**收益**叙述是错的(方向应为"净增 1 条常驻"),作为**硬约束的理由**也只有"重复消费"这一半成立。

### ⑥-4 报告漏掉的"最大受益者"限定条件

报告第 148 行:「最大受益者:远程页面(LAN/手机)省掉每分钟 ~40 次请求 + ~400KB 流量」。这个结论依赖"看门狗在远程页面确实运行"——而 client.ts:355 'bootGraph: typeof window !== ''undefined'' ? (window as any).__DSH_BOOT__ : undefined' 与 roster-watch.ts:136-146 的基线来自 __DSH_BOOT__,在远程/非回环页面上 DSH 官方对 settings 走内存模式(client.ts:322-324 注释自述),但 __DSH_BOOT__ 与探针路由是否同样可用,报告未验证。这不影响 SSE 的收益方向,但"最大受益者"的量化缺少前置条件。

### ③-4 报告遗漏:legacyVerbose 有一个现成的、零风险的判别捷径未被提出

- 报告第 66 行把充分判别设计为「flow 内组全带 data-group-expanded-mode」**且**「turn-process 按钮恒展开+disabled」的组合信号,并解释了为什么单用后者会误伤 aborted/error(它们在 standard 下组仍是折叠模式、无该属性)。
- 但这个组合信号**已经是现有代码的一部分**:fold.ts:1028-1039 的 nativePassiveTurns 就是从 aria-expanded === ''true'' && disabled 推出的,而 fold.ts:820 的 observer attributeFilter **已经包含 data-group-expanded-mode**。也就是说,把"verbose 专属"从 nativePassive 里**分离出来**只需要在 fold.ts:1038 那一行**加一个 btn.closest(''[data-group-expanded-mode]'') 判定**,不需要新建 observer、不需要新谓词体系。报告把这一层说成"需新增判别设计",低估了现有基础设施的完备度。
- 反向风险:正如 ③-1 所述,verbose 下若组不存在,则 data-group-expanded-mode 无从查询 → 该捷径**在 verbose 下恰好失效**。"组合信号"里真正在 verbose 下可用的只有 turn-process 按钮那一半。这进一步说明真机第 6 项是问题③的**唯一先行阻塞项**。

---

## ④ 修复方向的可行性评估与风险

### 4.1 问题③(verbose 自研折叠)

| 报告给的修复要素 | 可行性 | 主要风险 |
|---|---|---|
| resolveFoldStrategy(flow) 在两策略间切换 | **可行**。observer 已观察两个谓词所需属性(fold.ts:820 含 data-group-expanded-mode、aria-expanded、hidden),每 pass 重判具备触发条件 | 误判成本极高:verbose 与 aborted/error 在**单看按钮**时不可区分(fold.ts:1038 现有谓词就会把二者并入同一集合)。报告已识别该风险,但**没有给出 verbose 的独立充分条件**——见 ③-1/③-3,verbose 下 data-group-expanded-mode 可能根本不存在 |
| 翻转走 switchFlow 全清再重放 | **部分可行**。switchFlow(fold.ts:1421-1457)确能全清 chip/display/segmentStates/blockExpanded/pendingAnims,并调用 restoreAllDisplays()(fold.ts:3024)+restoreTurnStatus | ⚠️ **两条豁免清不掉**:groupInert(750)、userOwnedGroups(753)是 WeakSet,不可枚举 → 翻转后旧元素上的豁免被 legacy 分支继承。**要真正"全清",必须先给这两者补一个可枚举的旁路账本(如并行 Map/Set),或改为"策略翻转时重建 controller"**。这一步的成本报告完全没算 |
| legacy 分支复用同一块分类器与 chip UI,只换驱动层 | **合理**。块级二级折叠路径(fold.ts:2158-2209 reconcileBlock、chip 逻辑)确实是 0.1.5 自研折叠的直接后裔 | 驱动层移除后,"最后一组恒展开"(fold.ts:1348 'if (partition.last !== null) this.driveGroups([partition.last], true)')与"组收起"这套机制整体失效——legacy 分支需要另一套"哪些行默认隐藏"的策略,报告用"复用同一块分类器"一笔带过 |
| 灰度第一步:半接管(只加 chip 不隐藏官方行) | **可行且是本次最稳的一步**。技术上只需跳过 fold.ts:1382-1385 的 hide 分支、保留 chip 创建 | 语义上空 chip 无折叠对象,需要定义"chip 展开态控制什么"。这一点报告没定义 |

**总评:可行性"部分成立"**。报告说的"改造量小-中"在**前提成立**(verbose 下确有可操作的 DOM 结构)时大致合理;但两个前提(verbose 组存在性、豁免全清)都未证成,其中第二个是**已确认的现实缺口**。

### 4.2 问题⑥(SSE 迁移)

| 方案 | 可行性 | 风险 |
|---|---|---|
| **方案 b(报告推荐)** | **不可行**(见 ⑥-1:无公开 seam;唯一近似路径绑定在私有字段 entries.manifest + 无消费者的 entries.state 上,鲁棒性低于现状) | 若照此实施,等于把"插件启停热生效"这一**功能性闭环**押在无契约内部字段上,是最差选择 |
| 方案 a(拉长间隔到 30s) | 可行、零风险 | 收益仅降流量;且**看门狗的时延语义变差**(现 1.5s → 30s,禁用插件后最多 30s 才自动刷新),报告自己也承认"收益有限" |
| 方案 c(自开 EventSource) | **技术上可行**(/plugins/events 是公开 exact 路由,无鉴权/无白名单,HMRHOST index.js:141-152) | 净增 1 条常驻连接;全量 graph 重复解析;与官方 entries.sync 同帧竞争(见 ⑥-2)。报告列为"不推荐"是**正确的** |
| 方案 d | 与 c 同源 | 同上 |
| "保底语义不能丢"(404 兜底) | 报告的处理是稳妥的 | 报告自己的真机第 11 项其实**大部分可静态判**(见第⑤节),不必阻塞 |

**总评:问题⑥在"方案 b 不可行"被确认后,报告的正向结论(「可行且净收益为正」)不再成立**。当前可选项只剩 a(低收益)/c(有代价)。鉴于⑥**不是缺陷而是优化**,建议整体**暂缓**。

---

## ⑤ 需真机验证清单与优先级建议的逐条评估

### 5.1 真机清单 11 项:哪些其实静态可判(属证据不足)

**明确"把可静态确认的推给了真机"的 5 项:**

| 项 | 为什么静态可判(证据) | 报告此处的问题 |
|---|---|---|
| **4** processHidden 时重试行 hidden 实况(决定 hideElement 是否被 isNativeProtected 拦截) | CHAT:1709 'processHidden = controllerInactive \|\| foldable && processMember && !processOpen';CHAT:1518-1527 TURN_PROCESS_INDEPENDENT_KINDS **不含** model-retry ⇒ model-retry 是 processMember ⇒ 收起时 processHidden=true ⇒ CHAT:1710 useSearchableHidden(true,...) ⇒ CHAT:1608 'element.setAttribute("hidden","until-found")'。插件侧 fold.ts:4046-4052 isNativeProtected 第一条实质性判据就是 'if (el.hasAttribute(''hidden'')) return true' ⇒ **必然拦截**。三跳全部有源码 | 报告自己在问题②④已推出该链条,却仍把最终一步推给真机。真机只能"确认",不能"决定" |
| **5** 0.2.0 设置 UI 实际档位数 | CHAT:12039-12042 'options: TRANSCRIPT_VIEW_MODES.map((id) => ({ id, label: t(LABELS[id]) }))';TRANSCRIPT_VIEW_MODES 定义在 dsh-client-ui-chat/lib/index.js:9-14(四项);CHAT:12022-12026 LABELS 四项 | **纯冗余**:报告 ③-1 已断言四档,清单第 5 项又要求真机确认同一事实 |
| **7** detailed 下当前回合组 vs 历史组的属性差异 | CHAT:2301 + 2354 即可完全确定(见 E1) | 不仅冗余,而且**报告给的预期方向是错的**,照此去测会把正确现象判成异常 |
| **8** 直播期新组出现后前一组 aria-expanded 是否恒 true | CHAT:1676 'const liveProcess = processPresentation !== void 0 && !processPresentation.turnClosed;' ⇒ 直播中 liveProcess=true;CHAT:1678 'alwaysOpen = liveProcess \|\| ...' ⇒ true;CHAT:1679 'processOpen = alwaysOpen \|\| ...' ⇒ true;CHAT:1688 processWindowReady = ... && foldCompleted && ... && (turnStarted \|\| turnClosed)(直播中 turnStarted=true)⇒ true;CHAT:1692 foldable = processWindowReady && (liveProcess \|\| ...) ⇒ true;CHAT:6227 'open = !foldable \|\| turnProcess.open' ⇒ true;CHAT:6251 'aria-expanded: hasContent ? open : void 0' ⇒ **"true"**;CHAT:6230 canCollapse = foldable && hasContent && !turnProcessAlwaysOpen(node),CHAT:1551-1556 直播中 status==="open" ⇒ alwaysOpen ⇒ canCollapse=false ⇒ CHAT:6250 disabled。**全链确定性推导** | 报告问题⑤把它当作待验证的"根因B",但结论在静态层已封闭 |
| **11** 插件被禁用后官方 SSE 的帧行为 | "插件卸载后 SSE 是否存活"**静态可判**:HMRHOST 的连接集合/路由注册/清理(:116-169)全部挂在 **client-hmr 自己**的 ctx.effect 上,与任何第三方插件无生命周期耦合。仅"模块图变化是否必然触发 onGraphChanged"这一半需要查 node 侧 clientModules | 报告把整项推给真机;实际上只有后半句需要真机或再查一个包 |

**"部分静态可判"(应拆成两半的)3 项:**

| 项 | 静态可判部分 | 必须真机部分 |
|---|---|---|
| **2** 多重试回合的顶层 DOM 交错序列 | "**必然**交错"已静态可证:断组器 CHAT:10633-10641 INDEPENDENT 含 model-retry,分组循环遇成员即 flush+单独 emit | 具体组数/行数的**数值**、真实序列 |
| **6** verbose 下组 DOM 实况 | CHAT:2354/2356/6227/6230/6250/6251 已确定"**若**组存在,则组头不 hidden、组带属性、组体无 hidden" | 组的**存在性与数量**(见 ③-1:全 bundle 未找到 stepGrouping===''none'' 的消费者);这是问题③的真正阻塞项 |
| **10** steering/aborted 回合行恒开时多段 last 累积 | fold.ts:1348 'if (partition.last !== null) this.driveGroups([partition.last], true)' 无段新旧门控 + fold.ts:1693-1713 groupPartitionOf 每段独立取 last + fold.ts:1726 'partition.total === 1' 早退 ⇒ 多段必然多 last | 视觉表现与用户可感知程度 |

**确实必须真机的 3 项:** 1(历史 live-chunk 回放,涉及宿主持久化/分页装配)、3(用户所见场景,人因)、9(userOwned/inert 命中率,运行期统计)。

**汇总判定:11 项中至少 5 项(4/5/7/8/11)属于"可静态确认却被推给真机",其中 #5/#7 是纯冗余、#8 是问题⑤的根因判定被不必要地延后。清单作为"动手前必须先过"的门禁,颗粒度偏粗。**

### 5.2 修复优先级排序评估

报告原排序:P1 ⑤ / P1 ②④ / P2 ① / P2 ⑥ / P3 ③。

**我的建议排序及理由:**

| 我的排序 | 事项 | 理由 |
|---|---|---|
| **1(=报告 P1)** | 问题②④ P3 三缺口 | 改动集中在 fold.ts:1131 区 / 1336 / 2297 区 三处分支 + chip 循环(fold.ts:1363-1385);**有现成夹具**(test/fold-017-safety.test.mjs 与 fold-chip-drive.test.mjs 已在覆盖 data-group-expanded-mode 与非折叠模式组,见 test/fold-017-safety.test.mjs:323-343、:781-805);无新增连接、无架构面改动;是④b 的前置。**风险/收益比最优,应排第一** |
| **2(=报告 P1)** | 问题⑤收敛 | 报告排第一的直觉合理(用户症状最痛),但它触及 driveGroups/groupPartitionOf 语义与 **G1 用户意图保护**(fold.ts:2067 'if (this.userOwnedGroups.has(group)) continue')、F4 语义变更(报告第 114 行自述"改变 F4 修复语义")。**风险高于②④,且与②④ 同改 fold.ts 的段/块驱动逻辑 → 应串行,后合入** |
| **3(=报告 P2)** | 问题① tps/ttft 自算 + 单测桩更新 | 口径可静态对齐(报告引的 CHAT:6923-6961/6883-6890),不依赖 DOM 结构;唯一缺口是真机第 1 项(历史回放覆盖)。**建议拆两步:先做自算与桩更新(可立即做),历史覆盖待真机后补** |
| **4(报告 P3,我建议保持最低但理由不同)** | 问题③ verbose legacy 分支 | 报告的理由是"先灰度、风险低";我的理由是**它有一个未解的前置阻塞**:verbose 下组的实际 DOM 形态(真机第 6 项)未定,在拿到之前 legacyVerbose 的驱动层设计无从谈起。此外它与问题⑤在"豁免治理"上**耦合**(见下)。保持最低优先级**正确** |
| **5(报告 P2,我建议末位暂缓)** | 问题⑥ SSE 迁移 | 报告的 P2 建立在"方案 b 可行且净收益为正"之上。**该前提已被证伪**(⑥-1)。剩余方案 a(收益有限)/c(净增常驻连接 + 同帧竞争)都不足以支撑一个 P2。且⑥**不是缺陷**,是优化。**建议降为"暂缓/仅记录"** |

**报告排序中未体现的三条依赖关系(应补):**

1. **②④ → ④b**:④b"重试行收入折叠"依赖②的 P3 三缺口(报告已提),所以二者本就该同批 —— 报告把②④合并为一个 P1 是**对的**。
2. **⑤根因C ↔ ③策略切换"全清"**:两者的解药是**同一个**——把 groupInert(fold.ts:750)/userOwnedGroups(fold.ts:753)从不可枚举的 WeakSet 改为**可枚举、可重置**的账本。报告把⑤的"豁免治理"列为修复方向第 3 条(第 116 行)、把③的"全清"列为风险②,却**没有指出它们是同一处改动**。合并设计可省一轮改动与一轮回归。
3. **②④ 与 ⑤ 共享 fold.ts 的段/块状态机**:同时改会互相掩盖回归。建议②④ 先合入并跑 'node test/run-all.mjs'(test/run-all.mjs:31-35 逐文件跑、失败汇总,可作门禁),再动⑤。

---

## ⑥ 我无法确认、需要真机的点(汇总)

1. **verbose 档下一个回合实际渲染出几个 [data-step-process]、组头是否带 hidden** —— 决定问题③整套设计的前提。本次全 bundle grep 未找到 stepGrouping === ''none'' 的组存在性消费者,静态**不可判**。(对应报告真机第 6 项;但报告对其余三项属性已可静态判。)
2. **ctx.modules(官方 client-modules 提供的服务)在插件侧是否可达** —— 我在 client-modules/lib/client.js:868 读到 ctx.reflect.provide("modules", modules),但**未在 client 侧 d.ts / 契约声明中找到 modules 服务的公开类型**;插件能否 ctx.get(''modules'') 并读到 entries.manifest,需在真机上试(若不可达,⑥-1 提到的"唯一近似路径"也不存在,方案 b 更加彻底地不可行)。**静态不可判。**
3. **插件被禁用时,node 侧 clientModules 是否触发 onGraphChanged** —— 需要查 dsh-client-modules/lib/index.js(host half)或真机;本次只确认了 HMRHOST 侧的广播与连接生命周期(与插件无关,确定性存活)。
4. **报告第 137/140 行的实测量化数字**(静止期 ~3.3KB/次 × 40 次/分 ≈ 130KB/分、graph 全量 ~31KB/74 模块、3 秒抓帧)—— 报告称"实测",本次为**只读静态复核**,无法复现该计量;**静态不可判,需真机**。这些数字是方案取舍的依据之一,建议在使用前复测。
5. **问题③ legacyVerbose 落地后的真实回归面** —— 组被插件隐藏后 React 是否清 style(报告风险④"React 清 style"),需真机。
6. **问题⑤根因A 修复(F4 语义变更)对既有用户预期的影响** —— 报告第 114 行自述需"保留 G1 保护",属行为面,需真机校准。
7. **真机清单第 1 项(历史回合 live-chunk 是否可回放)** —— 涉及宿主持久化/分页装配,静态不可判,且是问题①历史覆盖的唯一阻塞项。

---

## ⑦ 复核结论摘要

- **问题③:事实结论"部分成立"**。四档 POLICIES、verbose 四项取值、foldable 推导链、让路路径、旧实现考古(c8809e4)均**经核实成立**;但 **data-group-expanded-mode 的 detailed 子句方向写反**(E1),且报告第 66 行与第 182 行自相矛盾(E2),三处次级行号/归类有偏差(E3/E4/E5)。
- **问题③:修复方向"部分可行"**。"策略切换必须全清"**不完整**——groupInert/userOwnedGroups 是不可枚举 WeakSet,switchFlow 清不掉(③-2);legacy 分支的驱动层设计缺一个未证成的前提(verbose 下组的实际形态,③-1/③-3)。
- **问题⑥:事实结论"成立"**(HMRHOST/HMRCLIENT/500ms 三条逐行核实,零偏差);但 **"方案 b 可行且净收益为正"的结论不成立**——官方 client-hmr 客户端 half 不发布任何状态,slots/store 中不存在该 seam,方案 b 按报告描述不可实现(⑥-1)。方案 d 的代价被低估(⑥-2),6 连接配额的叙述方向可疑(⑥-3)。
- **真机清单**:11 项中至少 5 项(4/5/7/8/11)属"可静态确认却被推给真机",其中 #5/#7 纯冗余、#8 使问题⑤根因判定被不必要地延后;真正必须真机的只有 1/3/9 三项。
- **优先级建议**:②④ 应排第一(风险收益比最优、有现成夹具、无架构改动)、⑤ 排第二(触及 G1/F4 语义,与②④ 同改 fold.ts 应串行)、① 排第三、③ 保持最低但**理由是前置阻塞而非单纯灰度**、⑥ 应从 P2 **降为暂缓**(方案 b 已被证伪,且它不是缺陷)。报告未指出 ⑤根因C 与 ③"全清"共用同一处改动(豁免账本可枚举化)。
