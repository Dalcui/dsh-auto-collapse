# 独立复核报告：问题① tokensPerSecond 恒为空

复核对象：`ISSUE_ROOTCAUSE_2026_09_30.md` 第 12-29 行（问题①全节）
证据基线（本机实测）：dsh=0.2.0-rc.2（`dsh-client-ui-chat\package.json` 与 `dsh\package.json` 均为 0.2.0-rc.2）
- CHAT = `C:\Users\wkyiw\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-ui-chat\lib\client.js`
- CONV = `...\dsh-client-ui-conversation\lib\client.js`
- CTRL = `...\dsh-api-session-controller\lib\client.js`
- HOST = bundle 根目录（292 个包，全量 grep 过 tokensPerSecond / ttftMs / assistant/live-chunk / sessionStats）
- 插件仓库 E:\Git\dsh-auto-collapse（`?? ISSUE_ROOTCAUSE_2026_09_30.md`，无其它未提交改动，本次复核全程只读）

---

## ① 逐条判定表

| # | 报告结论（问题①节） | 本次实测证据（文件:行号 + 关键片段） | 判定 |
|---|---|---|---|
| 1 | `tailData()`（CHAT:10414-10436）返回值仅 `{turn, seq, time, closing, branchUnavailable, tokenUsage?}` | CHAT:10414 `function tailData(context) {`；CHAT:10428-10435 返回字面量 `return { turn: end.event.data.turn, seq: end.event.seq, time: end.event.time, closing, branchUnavailable: closing === null || latestTranscriptSeq !== closing.finalNode.seq, ...tokenUsage === void 0 ? {} : { tokenUsage } };` | **成立**（行号 ±0） |
| 2 | `buildViewNode`（CHAT:10480-10483）直接透传该值为 data | CHAT:10480 `buildViewNode: (context) => {`；10481 `const data = turnLocation(context)?.data.get("turn-tail");`；10482 `return data === void 0 ? null : chatNode(context, "turn-tail", data.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.finalizedFollowup, data);`；CHAT:7211-7222 `function chatNode(context, kind, anchorSeq, data, options = {}) { return { key, kind, id, target:"chat", anchorSeq, location, visibility, data } }`（原样赋 data，无加工） | **成立**（行号 ±0） |
| 2b | 是否还有**其它**写入路径（别处 setData / Object.assign / patch 到节点 data） | bundle 全量 grep `tokensPerSecond` = 11 命中：CHAT:5529/5718（i18n 词典）、CHAT:7004/7058/7139（StatsPills 显示端，值由局部 `stats` 现算）、trajectory 包 4 条（i18n/显示）；**无一条写 data**。`ttftMs` 9 命中全为显示位或局部变量（CHAT:6886 定义、6928/6942/6943/6956 局部累加、7057 显示、7139 附近无）。turn-tail location data 的**唯一**写入点是 turnTailDefinition.buildLocationData（CHAT:10470-10479 `const value = tailData(context); return value === null ? null : { kind:"turn", turn: value.turn, key:"turn-tail", value }`），值域由 tailData 封闭；CONV:2511-2520（buildLocationData 只校验 kind/key/turn/step 后原样返回）、CONV:2521-2533 replaceLocationData、CONV:2535-2553 applyDirtyLocationData 均为**整体替换**，无字段级 merge/patch | **成立**（无第二条写入路径） |
| 3 | 插件 turn-metrics.ts:483 读 `n.data.tokensPerSecond`、:486 读 `n.data.ttftMs` | turn-metrics.ts:483 `const tps = num(n.data.tokensPerSecond)`；:486-488 `if (typeof n.data.ttftMs === 'number' && isFinite(n.data.ttftMs) && n.data.ttftMs > 0) { turnTailTtft = n.data.ttftMs }` | **成立**（行号 ±0，两处均为精确命中） |
| 3b | 除这两处是否还有其它取值路径 | 有，共 6 条：turn-metrics.ts:401-404（`billed.tokensPerSecond` 缺失时用 `acc.liveOutputTokens/(acc.liveDecodeMs/1e3)` 自算）、:574（`tokensPerSecond: coversTurn ? turnTailTps : undefined`）、:589-590（TURN_SCOPE_SEG 条目 + `timeToFirstToken: turnTailTtft`）、:576（`timeToFirstToken: index === 0 ? turnTailTtft : undefined`）；fold.ts:3159 / 3203 / 3226（published 白名单 / DOM 注入属性 / 文本 `tok/s` 兜底）；fold.ts:1906、1924、5348-5353；fold.ts:3160、3204、3308-3311（\`timeToFirstToken\` 字段的同名三条兜底；注意字面 \`ttftMs\` 在 src 内仅 5 处，全在 turn-metrics.ts:43/274/472/486/487）。**全部同源或降级兜底，无一条能绕过"权威源断供"** | **部分成立**（结论对，报告只列 2 条，遗漏 6 条同语义路径） |
| 4 | 「其他指标全部正常」= tokenUsage 未删 | CHAT:10427 `const tokenUsage = context.start?.event.type === "turn/start" ? deriveTurnTokenUsage(...) : void 0;`；CHAT:10434 `...tokenUsage === void 0 ? {} : { tokenUsage }`；CHAT:10277 deriveTurnTokenUsage 仍在；插件 turn-metrics.ts:489-490 读 `n.data.tokenUsage` | **成立** |
| 5 | fallback 断链边界 3 种场景 | 场景① 静态成立：CHAT:7529-7538 settleMessage `return { ...state, blocks, visibleBlocks, final: match, usage: event.data.usage }` —— **不写 firstTokenTime**；CHAT:7558 `firstTokenTime: state.firstTokenTime ?? null` → 无 delta 直接结算 ⇒ timing.firstTokenTime = null（且初始值为 void 0，CHAT:7424）。场景② 成立：CHAT:7569-7577 合成 interrupted 节点**不含 timing 字段**（`{ kind:"assistant", seq, time, turn, step, blocks, interrupted: true }`），插件 turn-metrics.ts:337 `typeof stepTiming === 'object'` 对 undefined 为 false ⇒ 正确跳过。场景③ 成立：CHAT:7579-7595 fallbackState$5 只从 `context.matches` 里 `assistant/live-chunk` 重建 state，无该事件则 state.firstTokenTime 为 undefined → finalNode（7556-7560）写 null | **部分成立**（三种都真实，但**边界不完整**，见下 5b） |
| 5b | （报告未写）第 4 类断链场景 | CHAT:7451-7456 `function resetForRetry(state) { return { ...initialState(state.turn, state.step), firstTokenTime: state.firstTokenTime } }`；CHAT:7647-7652 assistantDefinition.update 在 `llm/retry` 时 `return resetForRetry(context.state)`；CHAT:7510-7513 updateChunk 的 `'usage'` 分支是**唯一不设置 firstTokenTime 的提前返回**（`case "usage": return { ...state, usage: chunk.usage }`）。若某 step 在首个 token delta 之前先收到 usage chunk 并随后触发 llm/retry ⇒ firstTokenTime 被重置为 void 0，而结算走 settleMessage（不重建）⇒ timing.firstTokenTime = null。**注意**：窗口重放路径（fallbackState$5，7579-7595）是从 matches[0] **重头重放全部 live-chunk**，会重建 firstTokenTime —— 同一情形在 replay 下不断链、在 incremental 下断链 | **报告遗漏**（静态成立；两条路径的切换点静态不完全可判） |
| 6 | 「isTokenDelta 把 reasoning-delta 非空也判 true ⇒ 深度推理模型不会因此断链」 | CHAT:7406-7413 `function isTokenDelta(chunk) { switch (chunk.type) { case "text-delta": case "reasoning-delta": return chunk.text !== ""; case "tool-call-delta": return chunk.argumentsDelta !== "" || chunk.name !== void 0; default: return false } }`；写入点 CHAT:7526 `...firstToken && state.firstTokenTime === void 0 ? { firstTokenTime: time } : {}` | **成立**（方向正确）；补注：判定是 `text !== ""`，**空文本 reasoning-delta 不写**，且受 5b 的重置影响 |
| 7 | 单测桩漂移（test/metrics-unit.test.mjs） | test/metrics-unit.test.mjs:158-160 注释 `// rc.1 turn-tail：权威聚合 + tokensPerSecond 仍在。fixture 与内置 deriveTurnTokenUsage 不变量一致`；:161 `mk('tt','turn-tail',1,{ data:{ tokensPerSecond: 42, tokenUsage:{...} } })`；:173 `assert(m.tokensPerSecond === 42, 'tokensPerSecond 仍在 turn-tail data 上', ...)`；:185 `mk('tt3','turn-tail',1,{ data:{ tokensPerSecond: 7 } })`；:456-459 `mk/tail + data:{ tokensPerSecond: 42.5 }` + `assert(withTail.tokensPerSecond === 42.5, 'turn-tail 权威值优先于推导值')` | **成立**（行号精确，桩以 rc.1 形状为真机假设） |
| 8 | deriveStats / assistantStepReading 口径：decodeMs=completedTime−firstTokenTime、decodeTokens=usage.outputTokens、null timing=该步不累计 | CHAT:6883-6890 `function assistantStepReading(node){ const timing=node.timing; return { ttftMs: timing!==void 0 && timing.stepStartTime!==null && timing.firstTokenTime!==null ? Math.max(0, timing.firstTokenTime-timing.stepStartTime):null, decodeMs: timing!==void 0 && timing.firstTokenTime!==null ? Math.max(0, timing.completedTime-timing.firstTokenTime):null, outputTokens: usageOutputTokens(node.usage) } }`；CHAT:6923-6961 deriveStats：6937 `if (node.kind !== "assistant") continue`、6941-6945 `const reading = assistantStepReading(node); if (reading.ttftMs !== null) { ttftMs += ...; ttftSteps += 1 }`、6946-6949 `if (reading.decodeMs !== null && reading.outputTokens !== null) { decodeMs += ...; decodeTokens += ... }`、6958-6959 输出 decodeMs/decodeTokens | **成立**（行号 ±0；6971 行 tps 公式见 CHAT:7004/7139 `stats.decodeTokens/(stats.decodeMs/1e3)`） |
| 9 | ttft 自算 = acc.firstTokenTime − acc.firstStepStart，**已采集**，与官方 CHAT:6886 同口径，归属持首分组 | 采集点 turn-metrics.ts:311-316（firstTokenTime，取 min）、:317-322（`const stepStart = typeof stepTiming?.stepStartTime === 'number' ...`，取 min）；官方同字段来源 CHAT:7556-7560 `timing:{ stepStartTime: context.start?.event.time ?? null, firstTokenTime: state.firstTokenTime ?? null, completedTime: event.time }`，其中 context.start 来自 assistantDefinition.match 的 `step/start` 分支（CHAT:7628-7632）与 start（7643-7646 `initialState(match.event.data.turn, match.event.data.step)`） | **公式口径成立、数据链路不成立**：插件产物 `timeToFirstToken` 只来自 `billed.timeToFirstToken`（:416），billed 只来自 turnTailTtft（:576/:590）；firstTokenTime/firstStepStart **仅用于分组计时切分**（:550-556），从不进入输出。即"归首分组"的骨架已在（:576 `index === 0`），**缺的是把自算值接进 :576** |
| 10 | 「这解释了其他指标全部正常」 | CHAT:6913 注释 `the FALLBACK for assemblies without the sessionStats projection`；CHAT:7135-7136 `const projected = useProjection("sessionStats"); const stats = useMemo(() => projected ?? deriveStats(settledNodes), ...)` | **成立**（补充：官方 detail 的 tps 在有 projection 时走 whole-log，见 ③-3） |

**小结**：报告问题①的**主结论（权威源断供、显示恒空）完全成立且证据可复现**；断链边界的**清单不完整**；修复方向的**公式口径正确**，但"已采集/同口径/归属"三处表述在**多 step 与 TURN_SCOPE 归属**上站不住。

---

## ② 报告中的事实错误或行号偏差清单

抽查报告给出的全部 CHAT 行号，**偏差均为 0**，无实质性行号错误：

| 报告行号 | 实测 | 偏差 |
|---|---|---|
| CHAT:10414-10436 | tailData 定义 10414 → 10436（闭合 `}`） | 0 |
| CHAT:10480-10483 | buildViewNode 10480 → 10483（10482 为 chatNode 调用） | 0 |
| CHAT:7517-7526 | 7517 `const firstToken = isTokenDelta(chunk)`，7526 写 firstTokenTime | 0 |
| CHAT:7406-7413 | isTokenDelta 定义 | 0 |
| CHAT:7569-7577 | interrupted 合成节点返回块 | 0 |
| CHAT:7579-7595 | fallbackState$5 | 0 |
| CHAT:7529-7538 | settleMessage | 0 |
| CHAT:6923-6961 / 6883-6890 | deriveStats / assistantStepReading | 0 |
| turn-metrics.ts:483 / :486 | `n.data.tokensPerSecond` / `n.data.ttftMs` | 0 |

**表述性错误（非行号）3 处**：
1. 报告写「fallback 断链边界（turn-metrics.ts:311-350 + 401-403）」——:311 是 firstTokenTime 采集的起始行，但该函数（accumulateNode）的 timing 采集区实际是 **:309-322**，decode 累计区是 **:331-350**；:311 起会让读者以为整个区间都在做 timing。偏差：下界 +2（无害）。
2. 报告写「acc.firstTokenTime − acc.firstStepStart（turn-metrics.ts:311-322 **已采集**）」——采集成立，但**该采集产物不进入任何输出**（见 ①-9），"已采集"会让实施者以为只需改一行调用点。**这是最容易被读成"已就绪"的误导。**
3. 报告写「ttft 自算……**与官方 CHAT:6886 同口径**」——仅对**单 step 分组**成立。官方是**逐 step** 计算 ttft 并对全部 step 求和/平均（CHAT:6942-6945 累加、CHAT:7057 显示平均 `stats.ttftMs / stats.ttftSteps`）；插件是「分组内最早 token − 分组内最早 step 起点」的**区间**口径。同一段里有 ≥2 个 step 时两者数值必然不同。
4. 附带（非问题①正文）：报告称"tokenUsage（跨 attempt 聚合）未删"——成立，但该聚合语义（CHAT:10236-10264 aggregateAttempts：input/output/total 全部求和、cache/reasoning 桶"任一缺失整体置 undefined"）与插件 fallback 的自算 tps（per-step 单次 output）**分子口径不同**；若两者混用（保留 tokenUsage 覆盖 output + 新增自算 tps）会得到「跨 attempt 的 output ÷ 单 attempt 的 decode 时长」的假高值。报告未提示。

---

## ③ 报告遗漏的反证或反例

1. **第 4 类断链场景（重试重置）**：见 ①-5b。报告把断链的写入点统一归到"CHAT:7517-7526 首个 token delta"，但 0.2.0-rc.2 有**两套 firstTokenTime 语义**——incremental（updateChunk + resetForRetry 只保留旧值、settleMessage 不重建）与 replay（fallbackState$5 从 matches[0] 重头重放）。报告的"唯一未决点：持久化是否保留 live-chunk 事件"只覆盖了 replay 面，漏了 incremental 面的 retry 覆盖。
2. **实际暴露面被高估**：默认摘要字段串不含 tokensPerSecond（src/locales.ts:17 `DEFAULT_SUMMARY_FIELDS_STRING = 'duration,modelCalls(次模型),toolCalls(次工具),inputTokens(输入),cacheReadTokens(命中),cacheHitRate(命中率),outputTokens(输出),contextDelta(上下文)'`），线上 profile 显式覆盖为 `duration,modelCalls(次模型),inputTokens(输入),cacheHitRate(),outputTokens(输出),tokensPerSecond(t/s),contextDelta()`（\`C:\Users\wkyiw\.dsh\profiles\web\cordis.patch.yml\`:481）。即用户可见的恒空只有 **tps 一项**；timeToFirstToken 属"配了才可见"的字段（报告标题写"含 timeToFirstToken 同源失效"虽正确，但两者可见性不同，优先级判断应据此下调）。
3. **"官方同口径"的权威实现不是 deriveStats**：bundle 内 `dsh-session-stats`-lib-types-projection.js:66-167 提供 `sessionStats` 投影（whole-log：`step/start` → `assistant/message`，首 token 取 `assistantStreamFirstTokenTime(event.data.stream)`，projection.js:91-98/104-120），CHAT:7135-7136 优先用它、deriveStats 只是**无 projection 时的窗口兜底**。因此：
   - 官方 detail 里的 tps 是**整个会话**（跨回合、跨分页/压缩稳定）；插件能做到的是**单回合/单分组**。报告写"改用官方 deriveStats 同口径自算"得到的数字与官方面板**不可比**，这个口径差必须在实施说明里写明，否则会引出"数值对不上"的新一轮误判。
   - 官方权威口径的首 token 来自**持久事件的 stream**（`assistant/attempt`），而 CHAT 窗口口径来自 **client-only transient live-chunk**（CTRL:1410-1425 / 1472-1487 构造，`type:"transient"`、seq 为 `durableCursor+1-1/(n+1)` 的分数）。两者在正常情况下应同值，但"同口径"的强表述不严谨。
4. **桩漂移的影响面被夸大**：test/metrics-unit.test.mjs 中真正依赖"权威 tps 存在"的只有 :173、:185（tt/tt3 两个 fixture）、:457-459（withTail）；而 :373-470 整块**已经是 0.2.0 形状**（:382-383 注释"真实形状：timing 挂在 finalNode 上，不在 data 顶层"、:387 `finalNode:{ timing:{ stepStartTime: first-500, firstTokenTime: first, completedTime: done } }`），覆盖 :397-398、:405、:416-417、:433-435、:442-443、:450、:468-469 共 8 条断言。报告"单测为什么是绿的"叙述把 3 个 case 的漂移写成了整体绿的原因。
5. **注释/文档同源 stale**：fold.ts:5436-5438 `/** tok/s 紧凑显示…rc.1 的 turn-tail.data.tokensPerSecond 是原始浮点（如 34.8775521404277）…`，behavior-spec.md:160-161、README.md:45-46 均以 rc.1 字段为前提。这些不在报告"同步更新单测桩"的范围内，但同属"以 rc.1 为真机"的漂移面，只更新测试桩仍会留下错误文档。
6. **报告未指出该问题已部分自愈**：turn-metrics.ts:399-404 的 live 推导（:401-403）与 fold.ts 的文本兜底（:3223-3226 `/(\d+(?:\.\d+)?)\s*tok\/s/`）已经是"没有权威字段也能显示"的机制（测试 :373-470 覆盖）。即"恒为空"成立的前提是"回合内无已 settled 的 assistant-step 且无 tok/s 文本"，报告把机制缺口描述成"显示恒空"偏重。

---

## ④ 修复方向的可行性评估与风险

**总体判定：方向正确、整体可行，但按报告原文直接实施会引入 3 个新缺陷，必须补 4 项设计。**

可行部分（已核实可直接复用）：
- 累计量**基本够用**：`accumulateNode` 已按"单个 step 的 finalNode.timing"取 firstTokenTime/completedTime（:309-322、:337-350），与官方 assistantStepReading 的 per-node 口径**一致**；`liveDecodeMs/liveOutputTokens` 的语义（:347-348）与官方 decodeMs/decodeTokens（CHAT:6946-6949）**逐字等价**，含"completed > firstToken 严格大于"对官方 `Math.max(0,...)` 的保守化（官方允许 0 时长步贡献 outputTokens；插件把整步排除 —— 差异方向是插件更保守，不会虚高）。
- 分组隔离**够用**：段级分组各自累计（:479-508），多分组回合的整回合条目按段合并（:529-545，含 :540-541 合并 liveDecodeMs/liveOutputTokens）——这一条报告说对了。
- 归属**骨架已在**：:572-577 的 `index === 0 ? ... : undefined` 就是"归属持首分组"，替换数据源即可。

必须补的设计（报告缺失）：

1. **【漏洞·最严重】多 step 分组的 ttft 口径**：官方 ttft 是**每 step 一个**（CHAT:6942-6945 逐 step 累加 + 7057 除以 ttftSteps 显示平均）；报告的公式 `firstTokenTime − firstStepStart` 在分组内 ≥2 个 step 时给的是**区间往返**，不是"平均 ttft"。同一段里"step1（无 token delta，firstTokenTime=null）+ step2（正常）"这类常见组合，官方平均只算 step2，插件区间会把 step1 的 start 也算进起点 ⇒ 数值偏大。**修法**：要么逐 step 计算 ttft 后取平均（与官方一致），要么在分组条目上改用"首个**有效** step 的 firstTokenTime − 该 step 自己的 stepStartTime"。
2. **【漏洞】TURN_SCOPE_SEG 缺输入**：turnAcc 的合并（:529-545）明确**不合并** firstTokenTime/firstStepStart（:542-543 注释"只服务于分组计时切分…无需合并"）。ttft 自算一旦上线，整回合作用域条目（:587-591）拿不到起点 ⇒ 原生折叠指标行（compact 模式）仍显示不出 ttft。必须补 turnAcc 的 min 合并。
3. **【漏洞】多 attempt 口径混用**：官方 deriveStats 的 decodeTokens 是 **per-step 的 `node.usage.outputTokens`**（CHAT:6888 走 `usageOutputTokens(node.usage)`，node.usage 来自 `assistant/message` 的 settled usage，CHAT:7555），而 turn-tail 的 tokenUsage 是**跨 attempt 求和**（CHAT:10238-10240）。插件在 coversTurn 时用 tokenUsage 覆盖 output（:376-397），此时若 tps 走自算（per-step output / per-step decode），则出现的 output 字段与 tps 分子**不同源**（"输出 250"却按"单次 100"算速率）。必须显式选边并在 UI/注释里声明；最稳的是 tps 一律用 acc.liveOutputTokens（与官方 deriveStats 完全一致），显示字段保持 tokenUsage。
4. **【风险】优先级与降级顺序**：现有 :401-403 是"billed 缺失才自算"；改造后应变为"自算优先、billed 仅作兼容兜底"，否则线上（含 0.3.0 部署版，见下）在 0.2.0 下永远走不到自算分支就会被 tokenUsage 覆盖路径误导。
5. **【风险·低】不需要动的手段**：报告未提但实施者可能想到的"读官方 StatsPills 的 `[data-composer-stats]` 面板数字"（CHAT:6998-7064 TimePill，DOM 上是 whole-log 会话级）会带来跨回合污染，插件已有文本兜底路径（fold.ts:3223-3226）正是这个坑，**不要扩大它**。

**副作用评估**：新增自算不引入新的 DOM 写入、不改 React 控制面、不新增观察者；性能上复用已有的一趟 accumulateNode（无新增复杂度）；主要风险是**数值口径**而非稳定性。唯一需要回归的是 metrics-unit.test.mjs 里 :161/:185/:457 三个 rc.1 形状桩，以及 fold-metrics.test.mjs:217-247、fold-regression.test.mjs:1299 的文本兜底用例（后者依赖 `34.877 tok/s` 文本，不受影响）。

**部署面提醒（静态可判）**：线上 profile 加载的是 \`C:\Users\wkyiw\.dsh\profiles\web\node_modules\dsh-auto-collapse\`（version 0.3.0，client.js 内 `tokensPerSecond/ttftMs` 19 处命中与 src 一一对应，含 :242-244 的 fallback 与 :292-295 的陈旧读取）——即当前运行的代码**同时**含"读死字段"和"自算兜底"。改 src 后必须重新 build（build.mjs 产出 lib/，test/run-all.mjs:25 会把 build 作为前置）+ 部署到该目录才生效。

---

## ⑤ 无法静态确认、需要真机验证的点

| # | 待验证项 | 为什么静态不可判 | 影响 |
|---|---|---|---|
| 1 | live-chunk 是否随会话持久化；prepend 历史页是否携带 live-chunk entry | `assistant/live-chunk` 全 bundle 只在 CHAT（消费）与 CTRL（作为 `type:"transient"` entry 的 event 类型构造）出现，**没有任何持久化/读取代码**；transient 是 client-only（CONV:README.zh.md:34 明确"外层 type 区分持久事件与 Client-only transient event"），但"服务端是否另存一份"无从在客户端 bundle 判定 | 决定断链场景③（历史回合窗口重放）的真实发生率 |
| 2 | 重挂/重建时走 `replayContexts`（重放）还是 `acceptMatch` incremental 增量更新 | 触发点分散在 CONV:1966（append→replayContexts）、2199（starting→replayContext）、2002（settleAssistant→replayContexts）、2027（prepend→replayContexts）与 subscribe 路径；我只静态确认了"两条路径对 firstTokenTime 的处理不同"（7414-7456 vs 7579-7595），**未确认实际时序上哪条先发生** | 决定第 4 类断链（①-5b）是否真实可触发；也可能被 replay 覆盖而永不显形 |
| 3 | 真实会话里"同段多 step / 同 step 多 attempt / interrupted 与 settled 并存"的组合及其分组切分实况 | DOM/节点形状与官方分组算法运行时行为，静态只能推演 | 决定 ④-1/④-2/④-3 三个漏洞的实际影响面 |
| 4 | 历史回合（分页/compaction 后）插件拿到的 `nodes` 里是否仍有带 timing 的 assistant-step | 需真机抓 `useChat` 快照 | 决定自算对历史回合的覆盖率（即报告"需真机验证清单 #1"） |
| 5 | 线上摘要栏的实际渲染（tps/ttft 槽位是否真的空） | 需真机 DOM | 验证"恒为空"结论的现象面（本次只证实了字段断供） |

---

## 附：复核方法（可复现）
- 全量 grep：`tokensPerSecond`（bundle 11 命中 / src+test 48 命中）、`ttftMs`、`tailData`、`buildViewNode`（CHAT 26 命中）、`firstTokenTime`（CHAT 6 命中）、`assistant/live-chunk`、`sessionStats`（bundle 53 命中 → 定位 dsh-session-stats）。
- 关键读取区间：CHAT 6870-6979、6980-7065、7100-7189、7211-7222、7380-7619、7620-7739、8670-8711、9545-9604、10230-10329、10395-10515、12270-12330；CONV 1982-2006、2180-2324、2420-2501、2500-2553、2960-3004；CTRL 1390-1543。插件：turn-metrics.ts 230-429、429-603、1030-1109；fold.ts 1880-1939、3120-3264、3260-3319、5330-5455；test/metrics-unit.test.mjs 1-40、140-209、365-470。
- 未做任何写操作（唯一新增文件为本报告）；未运行 build/test（避免改动 lib/ 产物与仓库状态）。
