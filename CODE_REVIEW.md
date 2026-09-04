# dsh-auto-collapse 代码深度审查报告

> 审查方式：只读审查（未修改任何源码）。五大维度由 agent team 并行执行，模型统一为 modelscope `deepseek-ai/DeepSeek-V4-Pro-0813`。
> 审查范围：src/fold.ts（3724 行）、src/turn-metrics.ts、src/settings.ts、src/client.ts、src/index.ts、src/locales.ts、lib/、behavior-spec.md、build.mjs、deploy.mjs、test/*.mjs（15 个）。
> 审查维度分工：bug-hunter（功能正确性/bug）、perf-reviewer（性能）、resilience-reviewer（降级与健壮性）、spec-reviewer（对照 behavior-spec 符合度）、practices-reviewer（最佳实践/工程质量）。

---

## 一、结论总览

**总体评价：核心折叠状态机与显示/动画账本逻辑自洽、工程防御意识强（账本式自愈、写入守卫防自激、能力检测齐全、注释详实），安全（XSS）维度优秀，降级链完整。未发现 P0 崩溃级 / 数据损坏级缺陷。主要问题集中在「指标注入器增强链的兜底缺失」「指标归属（turn/seg）边界」「每 pass 全量 DOM 扫描的性能」与「工程可维护性」四类。**

问题分级统计（去重后）：

| 级别 | 数量 | 说明 |
|------|------|------|
| P0 崩溃/数据损坏 | 0 | 无 |
| P1 核心功能失效 | 1 | 指标注入器兜底缺失可能致最终正文消失 |
| P2 正确性 bug / 数据错误 | 2 确认 + 14 隐患 | 设置保存竞态、指标归属边界、性能、工程 |
| P3 低危 / 改进项 | 约 15 | 内存、可访问性、类型、配置、死代码 |

---

## 二、确认的 Bug（P2）

### B1 设置保存竞态会静默丢改（settings.ts）
- **位置**：src/settings.ts:252-274（save()），尤其 263-273 的 setFieldsPending(null)/setCodePending(null)/setStatusPending(null)。
- **复现**：编辑 summaryFields 为 abc，再编辑 statusText 为 X，点保存。save() 闭包捕获点击时刻的 pending={abc}。在 `await scope.set('statusText','X')` 未返回的窗口内，用户把 summaryFields 改成 def；随后 save 仍用旧值 {abc} 执行 `await scope.set('summaryFields','abc')` 并 setFieldsPending(null) 覆盖掉 {def}，def 被丢弃、存入旧值 abc，UI 无报错。
- **根因**：save 用渲染期闭包直读 pending，await 期间不校验 pending 是否已变；且保存中 input/select 仅 `disabled=!writable`（settings.ts:325/347/367），未在 saving 期间禁用。
- **影响**：用户修改静默丢失（不崩溃），scope.set 越慢窗口越大。
- **建议**：保存前对每个 pending 取最新值再 set(null)，或 saving 期间禁用字段，或 set(null) 改函数式更新并比对。

### B2 findTurnTail 把 user/steering 边界误当 turn-tail 解析（fold.ts）
- **位置**：src/fold.ts:2231-2242（findTurnTail），调用点 790（parseTurnDuration）、806-807（extractTurnMetrics）。
- **复现**：回合停止/中断且无 turn-tail 时，buildSegments 用下一个 user/steering 元素作该段 boundary（fold.ts:2712-2721）。findTurnTail 见 boundary!==null 直接返回，不校验 data-chat-flow-kind 是否为 turn-tail，于是 parseTurnDuration/extractTurnMetrics 把 user 消息文本当 turn-tail 解析（用时/token/终止标签都在错误元素上兜底）。
- **影响**：模块级 Map（权威源）在时无感；仅在注入值缺失时 duration/usage/termination 才错（如 user 文本碰巧含 token 数字或「已停止」）。正常有 turn-tail 的回合不受影响。
- **建议**：findTurnTail 对 boundary 校验 data-chat-flow-kind 含 turn-tail 才返回，否则走 finalStep 后向查找或返回 null。

---

## 三、高危问题（P1）

### G1 指标注入器可达路径存在无兜底分支，可能致「模型最终正文整体消失」
- **位置**：src/turn-metrics.ts:257-267（builtinAssistant）、259（slotsService.entries() 无 try/catch）、305-316（TurnMetricsNodeView 委托渲染）。
- **问题**：TurnMetricsNodeView 是 assistant-step 的 shadow 渲染器，其 `builtinAssistant` 在找不到内置 assistant-step（priority===0）组件时返回 null，此时该 step（含模型最终正文）**整体不再渲染**，且没有「保留原生内容」的兜底渲染分支；`slotsService.entries()` 也无 try/catch。
- **影响**：一旦内置渲染器 key/priority 因宿主版本变化而异（或 slots 短暂不可用），模型输出正文会消失——这是全项目唯一可能直接造成用户可见内容丢失的隐患。
- **建议**：builtinAssistant 找不到目标时回退到「原样直渲 props.node 内容」或直接返回 null 但不劫持该渲染（回退到不做 shadow 的原始渲染），并给 slotsService.entries() 加 try/catch。

---

## 四、中危问题（P2 隐患）

### 4.1 健壮性

#### G2 注入器注册无 try/catch 且早于核心折叠启动，抛错会连累整个插件
- **位置**：src/client.ts:40、src/turn-metrics.ts:325。
- **问题**：installTurnMetricsInjector 的 ctx.inject(['slots','connection']) 同步执行，无任何异常捕获，且早于 FoldController.start()。此处抛错会让核心折叠功能一并失效。
- **建议**：把注入器安装包进 try/catch，失败时仅跳过指标功能，不影响折叠主链路。

### 4.2 指标归属正确性（turn/seg 边界）

#### H1 segOrdinal 双源独立实现，历史截断/异常数据下折叠读取与注入器发布错位
- **位置**：src/fold.ts:2625-2741（buildSegments 按 DOM flow 的 steering 项计数）vs src/turn-metrics.ts:232-253（computeSegOrdinal 按会话 order 的 steering 计数）。
- **问题**：fold 用 segment.segOrdinal 查按 computeSegOrdinal 发布的 Map（fold.ts:805/1054/2227）。窗口分页截断使 DOM steering 项少于会话 order，或 steering 两侧归到不同 turn 时，两套 seq 不一致 → 段 B 取到段 A 聚合值。另 fold.ts:2227 的 `segment.segOrdinal ?? segOrdinal ?? 0` 中 segment.segOrdinal 恒为 number，data-dshcf-seg 兜底实为死代码。

#### H2 computeTurnMetrics 聚合循环与 targetSeg 循环对 steering/turn 处理顺序不一致
- **位置**：src/turn-metrics.ts:150-205（聚合 loop：154 先 `if(n.kind==='steering'){seg++;continue}` 后 159 回合归零，且 continue 跳过归零）vs 124-138（targetSeg loop：先归零、再 key 命中、再 steering++）。
- **问题**：steering 节点携带与上一节点不同 location.turn，或 steering 紧邻回合切换时，两循环 seg 渐行渐远 → 段指标漏计/多计。

#### H3 turnNumber 无 loc.turn 空指针保护
- **位置**：src/turn-metrics.ts:223-227，`return loc.turn.turn` 未判 loc.turn 非空（computeTurnMetrics 内部有 !loc.turn 防护（166），但 turnNumber 没有）。
- **问题**：某 turn/step 节点缺 location.turn 时（数据异常/运行态节点），渲染组件内抛 TypeError，打断 shadow 渲染。

#### H4 tool-call 被 loc.kind 过滤条件排除时 toolCalls 漏计
- **位置**：src/turn-metrics.ts:166 在 169 `n.kind==='tool-call'` 之前用 `(loc.kind!=='turn' && loc.kind!=='step' || !loc.turn) continue`。
- **问题**：若 DSH 中 tool-call 节点 location.kind 非 turn/step（或未定义），会被 continue 跳过，toolCalls 不累计（若 tool-call 归属确为 step 则无此问题，需实测确认）。

#### H5 完成态插话段（seg>0）耗时未按段切分，复用回合级 durationMs
- **位置**：src/fold.ts:816；src/turn-metrics.ts:113-120（durationMs 仅由 turnTimings 回合级给出，96-98 注释自认段级无独立计时源）。
- **问题**：同一回合被 steering 切分多段都完成后，段 A、段 B 均显示整回合耗时，不符 spec 第六节「各段各自显示耗时」。（bug-hunter 与 spec-reviewer 双确认）

### 4.3 性能（perf-reviewer）

#### 性能问题 1：splitThinkByBody 每 pass 全量 TreeWalker 无缓存
- **位置**：src/fold.ts:2862（调用点）、2915-2947（实现）。
- **量化**：findBlocks 每 pass 重建，对每个含 think 行的消息用 createTreeWalker(SHOW_TEXT) 走全子树 + 逐文本节点 closest()。该函数不进 bodyTextCache 也不进 dirty 失效体系。流式 rAF 合并后约 60 次/秒 pass，成本 ≈ O(会话全部 reasoning+输出文本节点数) × 60Hz，随会话长度线性且持续。
- **建议**：按消息元素缓存分段结果（WeakMap），由 markDirty 定向失效。

#### 性能问题 2：findBlocks 每 pass 对每消息 3 次子树 querySelectorAll
- **位置**：src/fold.ts:2808-2809、2982-3015。
- **量化**：N 条消息 × 每条子树扫描（[data-variant=think]/[data-chat-call-id]/[data-variant=others][data-state]）× 60 次/秒；callRowsIn 内还有逐行 closest。

#### 性能问题 3：markDirty 未排除插件 chip 子树，chip 自写入误触正文缓存失效（2×pass）
- **位置**：src/fold.ts:670-690、2967-2978。
- **量化**：流式中 updateChip 写 title/summary.textContent 产生 childList mutation，落在插件 chip 内 → markDirty 加入 dirtyMessages → 下一 pass 对宿主消息整棵子树重做 TreeWalker。虽写守卫防无限振荡，但缓存被过度失效，削弱流式主力场景缓存命中。
- **建议**：markDirty 向上归位时跳过 .dshcf-chip/.dshcf-processed/.dshcf-processing/.dshcf-merged-think/.dshcf-merged-body 子树。

#### 性能问题 4：extractTurnMetrics 兜底路径含 querySelectorAll('*') 全树 + 逐元素 textContent
- **位置**：src/fold.ts:2123（'*' 全扫）、2124-2128。
- **量化**：全文件单点最重原语（flow 数千元素 × 每元素 textContent 聚合），被 attempts<20 重试门控（fold.ts:797）。建议替换为窄选择器 + 叶子短路。

#### 性能问题 5：TurnMetricsNodeView 每步渲染约 3 次 O(order) 全遍历，长会话二次方放大
- **位置**：src/turn-metrics.ts:282-289（useMemo 双计算）、102-220、232-253。
- **量化**：每个 assistant-step shadow 订阅 4 个 selector；宿主 store 流式替换 order/nodes 引用时每 token 让 N 个 step 重渲染，每次合计约 3 次全 order 遍历，单回合累计 O(order²)。
- **建议**：合并单次遍历 + 模块级缓存；已完成回合由单一组件计算共享。

### 4.4 工程可维护性（practices-reviewer）

- **fold.ts 3724 行单文件**：FoldController（1500+ 行）+ 纯函数区（findBlocks/buildSegments/指标渲染/图标 path/常量）全堆一个文件，建议按状态机/块分割/指标渲染/图标资产拆分。
- **locales.ts i18n 整套死代码**：t()/getLocale()/ZH/EN 字典/formatTokens()/SUMMARY_FIELDS 无任何 import 方；fold.ts 自建 getLocale() 硬编码中英、settings.ts UI 全硬编码中文，**EN 文案永不生效**。（practices + spec 双确认）
- **测试全走 fake-dom，无真实 DOM/React 集成测试**：15 个测试通过 eval 真实 bundle + fake-dom 桩 DOM 驱动，核心脆弱点「React 重渲染清掉手动样式/chip」无真机覆盖（详见第九节）。

---

## 五、低危问题与隐患（P3）

按主题归纳（均已定位到 file:line，三方交叉确认）：

1. **metricsByTurn 模块级 Map 永不清理 + 线性扫描**（turn-metrics.ts:41/44-51/61-84/297）：publish 的 delete 分支（metrics===null）是死代码（渲染器从不传 null），跨会话/多 subagent 长期运行内存无界增长；readPreviousTurnLastInput 每次前缀全 Map 遍历 O(n)。（三方确认）
2. **指标注入器 shadow 注册无卸载撤销**（turn-metrics.ts:256/324-352；client.ts 清理链未调用）。（resilience）
3. **start() 的 injectStyle() 在 try/catch 外且 catch rethrow；document.head 无 null 检测**（fold.ts:616/641、3671；settings.ts:159）。（resilience + practices）
4. **跨会话 localStorage 展开状态硬编码 sessionId='default' 无隔离**（fold.ts:828/963/973/1004）：键形如 dshcf:expanded:default:<segmentKey>，跨会话展开状态不隔离，与 spec 第十节「按 sessionId 隔离」不一致，正确性依赖 segmentKey 全局唯一。（三方确认）
5. **codeDescription 用 z.string() 而非 z.enum**（index.ts:18）：非法值靠运行时白名单 fold.ts:3258 归一，schema 层不校验。（practices + resilience）
6. **可访问性**：折叠 chip 缺 aria-label（fold.ts:1350 建 chip 无 aria-label，3365 只写 title）；装饰性 SVG 未加 aria-hidden（createChevronIcon/createCommandIcon/createThinkIcon/createContextIcon/createWriteIcon，对照 settings.ts:167 ChevronIcon 有）；reduced-motion 漏掉 .dshcf-processing .dshcf-live-dot 呼吸点（fold.ts:306-313）。（practices）
7. **状态提示词用英文「Deep diving」字面量定位**（fold.ts:3686/3699）：宿主 i18n 或文案微调即静默失效，建议用更稳选择器或多文案白名单。（practices）
8. **一级行「已处理/耗时」前缀缺失**（fold.ts:3514 完成态返回裸时长；locales.ts:22-23 的 summary.duration/summary.elapsed 为死代码）：与 spec 二.19/四.52 描述不一致。（spec）
9. **「未填写渲染全部指标」存在两条路径 + 顺序漂移**（fold.ts:3488 兜底 12 字段硬编码顺序与 spec 八.98 清单不一致，contextDelta 提前；用户清空 summaryFields 得到 12 字段、不清空得 8 字段默认，反直觉）。（spec + bug-hunter）
10. **图标扫描无跨调用缓存**（findNativeThinkSvg/findNativeContextSvg/findNativeWriteSvg，fold.ts:2348-2355/2457-2466/2496-2504）：仅 createCommandIcon 有 cachedNativeCommandSvg，每次 kind 切换/新建 merged-think 行都做 document.querySelectorAll。（perf）
11. **metricsAttempts=20 上限或致 contextDelta 永不补算**（fold.ts:797）：上一回合末输入晚于 20 次 pass 才到达时 contextDelta 永久缺失（规范允许缺失不显示，影响小）。（bug-hunter）
12. **readPreviousTurnLastInput 用 lastIndexOf(':') 切 turn:seg**（turn-metrics.ts:71-83）：sessionId 含 ':' 时仍取末段、实际安全，仅怪异 id 才错，低风险备案。（bug-hunter）
13. **deploy.mjs 命令行匹配脆弱**（deploy.mjs:93-99 isExpectedDshWeb 靠 expectedDir+lib/bin.js 或 /lib/bin.js/ 正则 + \bweb\b 相与）：同机第二个 DSH profile 或路径含 web 的进程可能误判；且本项目记忆记录该脚本在本登录态环境下实际不可用。（practices + 项目记忆）
14. **死代码/冗余**：src/index.ts:41-43 onChange 为 void current 占位、current 只被 setSource 赋值从不读取；buildMetricsSummary 硬编码默认字段序（fold.ts:3488）实为死分支（summaryFieldsProvider 恒非空）；segmentMetricsKeys 的 data-dshcf-seg 兜底死代码（fold.ts:2227）；settings.ts injectCardStyle 注入后清理函数不删除样式节点（对比 fold.ts stop() 会 removeStyle）；默认值三处重复（DEFAULT_STATUS_TEXT / DEFAULT_SUMMARY_FIELDS_STRING）。（多方）

---

## 六、behavior-spec 自身问题（spec-reviewer）

1. **八.96 自相矛盾**：「未填写时按规范顺序渲染全部可用指标」与紧随的「默认：8 字段」冲突——字段清单（八.98）有 12 项，「全部可用」应含 reasoningTokens/cacheWriteTokens/timeToFirstToken/tokensPerSecond，但明确给出的默认只有 8 项。
2. **一级行前缀口径不一**：二.19/四.52 描述一级行为「已处理 X秒 / 耗时 X秒」，八.96 默认 duration（无展示名→裸值）则不含前缀；实现取后者，却遗留 locales.ts「已处理/耗时」文案未接线。
3. **终止标签口径不一**：四.54 只对「停止态」追加「已停止」，八.100 说「停止/中断」追加「已停止/已中断」；而 turn-error/turn-max-tokens 触发一级行但未规定是否应有终止标签（实现也无标签，fold.ts:2703 仅 hasStoppedRow→'aborted'）。

---

## 七、降级措施盘点（正面）

resilience-reviewer 确认以下降级链完整无缺口：
- **图标降级链**：command/think/context/write 四类图标均「克隆原生 SVG → 硬编码原生 path 兜底」，无缺口（fold.ts:2318-2527）。
- **数据源四级降级**：指标读取「模块 Map → DOM 属性 → data-usage → 文本正则」逐级回退，触发条件清晰（fold.ts:2009-2141）。
- **环境能力检测齐全**：无 WAAPI、prefers-reduced-motion、后台 tab rAF 挂起（setTimeout 兜底）、localStorage 不可用、getSelection 缺失、document 缺失等均 typeof/能力检测（fold.ts:702-712/1772-1777/2271-2287）。
- **异常自愈 + 完整卸载**：runPass try/catch 不杀协调器；JSON.parse 三处全 try/catch + isFinite 校验；switchFlow(null)+restoreAllDisplays+restoreTurnStatus+removeStyle 覆盖清理还原。
- **极端工况覆盖**：异常终止（stopped/aborted/turn-error/turn-max-tokens）、无 think/tool 纯文本回合、正文迟到、历史分批加载、steering 分段、subagent 会话切换均有处理。
- **核心折叠不依赖 slots/settingsScope**：两者缺失不影响折叠主功能（client.ts:25/40-45）。

---

## 八、工程良好实践（正面）

- **安全（XSS）优秀**：全仓 src 无 innerHTML/insertAdjacentHTML/outerHTML，全部 textContent/createElement/createElementNS；三处 JSON.parse（fold.ts:1117/2042/2079）均 try/catch 且注入数值经 typeof number + isFinite 校验，宿主 data-usage/data-dshcf-turn-metrics 不当 HTML 解析。无确认漏洞。
- **写守卫防自激**：updateChip 值不变不写 textContent、replaceTurnStatus 的 node.data 守卫，杜绝「写→mutation→pass」无限振荡。
- **账本式自愈**：originalDisplay(WeakMap)+controlledDisplay(Set)+desiredHidden 三角关系、pendingAnims(Map) 身份守卫（onfinish/oncancel 即时清账），hideElement/restoreElement 冲突仲裁，错误不沉默（console.error + data-dshcf-state 标记）。
- **双调度互斥**：rAF + 60ms setTimeout 通过 raf!==0 守卫保证只跑一次，后台 tab 不假死（schedule，fold.ts:692-712）。
- **静止态不碰 layout**：updateChip 仅在 running 时读写 scrollLeft/scrollWidth/clientWidth。
- **switchFlow 清理彻底无泄漏**：chips/segmentStates/blockExpanded/runningSince/mergedThinks/liveRows/bodyTextCache/dirtyMessages/pendingAnims 全部 cancel/clear。
- **指标提取 20 次重试上限**（fold.ts:797）防每 pass 全树重扫。
- **注释质量高且与代码同步**：非显然决策（动画节奏/间距钉住/竞态/自愈）均有解释，多处标注「评审实证/评审 P0」。

---

## 九、测试覆盖盲区

- **测试运行机制**：run-all.mjs 先 build.mjs 产出 lib/client.js，再 eval 真实 bundle + fake-dom.mjs 桩 DOM 驱动 FoldController；非真实浏览器 React 集成测试。
- **无真实 DOM/React 集成覆盖**：TurnMetricsNodeView（shadow React 渲染器）未经真实 React 挂载验证（metrics-unit 仅测纯 computeTurnMetrics）；「React 重渲染清空手动样式/摘走 chip」这一核心脆弱点无真机覆盖。
- **fake-dom 与真实 DOM 语义偏差**：adversarial-race.mjs 需自行补丁 Node.DOCUMENT_POSITION_* 覆盖 fake-dom 的 compareDocumentPosition；offsetParent/getBoundingClientRect 固定真值、el.animate 缺省（动画时序实际未测）。布局/动画/时序缺陷在桩下不可见。
- **缺关键路径测试**：跨会话 localStorage 展开持久化、reduced-motion/WAAPI 降级、prefers-reduced-motion CSS 断言均无。
- **debug-blocks.mjs 与 _flash.mjs 未纳入 run-all.mjs 列表**（不进 CI）。

---

## 十、修复优先级建议（综合五维）

1. **（最高）G1 注入器兜底**：builtinAssistant 找不到内置组件时回退原生渲染，避免最终正文消失 + slotsService.entries() 加 try/catch。
2. **B1 设置保存竞态**：补最新值校验或 saving 期间禁用字段，杜绝静默丢改。
3. **G2 注入器注册隔离**：installTurnMetricsInjector 包 try/catch，失败不连累折叠主链路。
4. **统一 segOrdinal + turn/seg 边界**（H1/H2/H3/H4/H5）：三处 steering/回合归零逻辑抽成单一函数，turnNumber 补空指针防护，tool-call 归属核实，插话段完成态耗时补段级计时源。
5. **性能收敛**：splitThinkByBody/行集合扫描建立 dirty 驱动缓存；markDirty 排除插件自有子树；窄化 extractTurnMetrics 的 '*' 全扫；TurnMetricsNodeView 合并单次遍历 + 缓存。
6. **可维护性**：拆分 fold.ts 3724 行单文件；统一/接线 i18n（t() 与 EN 字典）并清理死代码；codeDescription 改 z.enum；metricsByTurn 增加会话级清理；跨会话 localStorage 传真实 sessionId。
7. **测试补盲**：新增真实 DOM/React 集成测试与跨会话持久化测试。

---

## 十一、附录：captain 客观事实核查（只读）

- `tsc --noEmit`（typecheck）通过，exit code 0。
- git 工作区干净（唯一未跟踪项为本次审查团队的 .agent-teams/，非源码）；HEAD=007acc5。
- 全仓 src 无 merge 冲突残留标记（<<<<<<< / ======= / >>>>>>>）、无 TODO/FIXME/HACK、无 debugger。
- 全仓 src 无 innerHTML 注入；仅 2 处 `as any`（turn-metrics.ts:283/287 的 useSession selector 强转）、1 处有意的 console.error（fold.ts:740 错误上报）。
- lib/ 下 4 个文件（client.js 167KB iife bundle、index.js 1.6KB、2 个 d.ts）均随源码提交进 git，package.json files 字段仅含 lib + cordis.patch.yml。

---

_本报告仅作审查记录，未修改任何项目源码。_