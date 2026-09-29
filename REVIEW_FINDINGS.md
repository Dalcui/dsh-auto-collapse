# dsh-auto-collapse 全维度审查报告（REVIEW_FINDINGS）

> 审查方式：6 名审查 subagent（全部 nova/deepseek-v4-flash），只读审查，未改动任何文件。
> 审查范围：README/文档、src 全部源码、test 全部测试、构建/部署/CI 工程化、安全与健壮性。
> 实测：`node test/run-all.mjs` exit 0 全部通过（20 个测试文件，约 766 条断言）。
> 结论速览：🔴 6 项 ｜ 🟡 约 20 项 ｜ 🟢 约 20 项 ｜ 💡 约 17 项。文档定位能力：文件名级可定位，符号级缺失。

---

## 🔴 严重问题（6 项）

### R1. 指标注入器无 HMR/卸载清理路径，shadow entry 随每次 HMR 累积
- 位置：src/client.ts:69-74（effect cleanup 缺项）、src/turn-metrics.ts:360（shadowDispose 无清理出口）、src/turn-metrics.ts:537-557（installTurnMetricsInjector 返回 void）
- 问题：client.ts 的 cleanup 只处理 watchdog/scope/settings card/controller.stop()，没有 turn-metrics 的卸载调用；registerShadow() 返回的 disposer 存在模块级 shadowDispose 里，全项目无任何路径调用它。
- 理由：宿主 slots 服务不随插件 bundle 重建而重置，每次 HMR stop→start 都会在宿主 slots 留下一个 assistant-step shadow entry（priority -1）。registerShadow（turn-metrics.ts:371-381）检测到已存在同 key 的负 priority shadow 后会再降一档（-2、-3…），每 HMR 一次就叠一层。旧 shadow 的渲染器闭包引用旧 bundle 模块，继续发布指标到旧 Map、重复写 DOM 属性，只增不减，渲染开销线性叠加。与本项目核心需求「HMR 可逆还原」直接冲突。
- 建议：让 installTurnMetricsInjector 返回卸载函数（在 slots.inject 返回的 disposer 与 shadowDispose 之上再包一层），client.ts 的 cleanup 里与 offWatchdog/offScope 并列调用；修复后实测一轮 HMR 验证 slots entries 数量不增长。
- 来源：核心代码审查🔴-1；behavior-spec 审查🟢-7 交叉印证。

### R2. 流式时指标聚合每帧 O(S×N) 全量重算，长会话卡死风险
- 位置：src/turn-metrics.ts:141-313（主循环 195-262 遍历整个 order）、src/turn-metrics.ts:499-502（useMemo 依赖）
- 问题：TurnMetricsNodeView 是 shadow 渲染器，覆盖每一个 assistant-step 节点；流式输出时新 token 使快照 order/nodes 引用变化，useMemo 失效，每帧每个可见 assistant-step 都重新遍历全量 order 做回合聚合。可见 step 数 S、order 节点数 N 时每帧 O(S×N)，S≈N 即 O(N²)。
- 理由：DSH 真实会话（尤其 subagent 长任务）order 可达数千节点；每帧数百万次迭代叠加 fold.ts 的全量扫描，running 流式期间会明显掉帧，损害折叠实时更新的核心体验；且每个 step 都在重复计算同一回合的相同聚合结果。
- 建议：按 (turn, segOrdinal) 缓存聚合结果、仅该回合相关节点变化时重算；或聚合上提为每回合一次；至少对 running 中计算加节流。
- 来源：核心代码审查🔴-2。

### R3. deploy.mjs 与现网 DSH 契约全面失配，部署必然失败并自动回滚
- 位置：deploy.mjs:212、214-216、217-218
- 问题（实测）：首页中本插件引用已为合并路由 /plugins/??dsh-auto-collapse/client.js&rev=2a9a8340e7a6（分隔符 &）：行 212 正则要求 ?rev=，实测 match=null（首页 client.js?rev= 出现 0 次、&rev= 出现 56 次）；行 214-216 fetch 的单插件 URL /plugins/dsh-auto-collapse/client.js?rev= 实测 HTTP 404（合并路由才 200）；行 217-218 hash 基准存疑：服务端 bundle sha 5d4ddaed83d8 vs 本地 lib/client.js sha c943154f6b03 已不一致。整个 [5/5] 验证必然失败→回滚→部署不可用。
- 修复：正则放宽为 [?&]rev= 或解析 __DSH_BOOT__ JSON 取 url/rev；bundle 拉取改用合并路由；hash 对比前先实测 DSH 是否原样返回文件字节。
- 来源：工程化审查🔴-1（实测）。

### R4. host half（lib/index.js）双源手工维护，无内容一致性守卫
- 位置：build.mjs:5（注释称静态文件无需构建）、build.mjs:16-27（只构建 src/client.ts）、package.json:38（prepack 只跑 build.mjs）
- 问题：src/index.ts（178 行 TS）与 lib/index.js（164 行去类型 JS）靠手工同步；node --check 守卫（build.mjs:48-58）只查语法不查与 src 的语义一致性；lib/types/*.d.ts 同为手工维护（tsconfig 无 declaration）。改 src 忘同步 lib 时构建/部署/CI 全绿灯，线上 host 跑旧逻辑。
- 修复：build.mjs 增加 esbuild 任务把 src/index.ts 编译为 lib/index.js（format esm、platform node、external schemastery、target es2020），prepack 同时重建两者；可选加构建产物与已提交 lib/ 的 diff 守卫。
- 来源：工程化审查🔴-2；安全审查🟡-2 独立印证。

### R5. behavior-spec 自称「唯一权威来源」但三种文体混杂，无法裁决特性 vs bug
- 位置：behavior-spec.md:3（自称「需求与行为的唯一权威来源」）
- 问题：正文混入实现细节（:64 data-tool/data-sample 回退、:119 sessionId:turn:segOrdinal 存储键、:121 runningSince 兜底、:113 图标克隆方案），规范/验收/实现记录三种文体未分层，读者无法判断「边界行为是特性还是 bug」。
- 建议：拆分三文体或加标签；实现细节指向源码行号。
- 来源：behavior-spec 审查🔴-1。

### R6. behavior-spec 引用的对照基准断链
- 位置：behavior-spec.md:15（引用 codex-ui-reference.md）
- 问题：glob 确认全仓不存在该文件，「唯一权威」的设计依据断链。
- 建议：补文件或移除引用并说明设计依据去向。
- 来源：behavior-spec 审查🔴-2。

---

## 🟡 中等问题（按主题聚类）

### 代码正确性 / 性能

- **M1. 折叠主链路 controller.start() 无容错包裹**：src/client.ts:54。apply() 内指标注入器与看门狗均有 try/catch 并注释「失败只丢此功能」，核心 controller.start() 反而没有；FoldController.start() 内部 catch 后 re-throw（fold.ts:670-673）。异常冒泡到 cordis effect 会拖垮整个插件（含设置卡片/watchdog），与文件内「故障隔离 G2」既定原则相悖。建议同模式包 try/catch，确需报告则在 refresh 中重试。
- **M2. markDirty 循环内提前 return，定向失效被架空**：src/fold.ts:711-721。observer 观察整个 document.body，一批 records 常同时含 flow 内与 flow 外记录；markDirty 遇到第一条 flow 外记录就 return，丢弃本批已标记的 flow 内消息并重建 bodyTextCache。flow 外任何 UI 更新都会让正文缓存整批作废，定向失效形同虚设。建议 flow 外记录 continue 跳过，仅 flow 整体替换走全量分支。
- **M3. metricsByTurn Map 只增不减 + 全表扫描**：src/turn-metrics.ts:51（Map）、71-94（readPreviousTurnLastInput 线性扫描）。grep 确认全项目无 publishTurnMetrics(..., null) 调用，Map 永不清理；每会话每回合每段一条记录，长期运行无限增长，查询退化为线性。建议按会话/回合上限裁剪（LRU 或保留最近 N 回合）+ 维护 turn→末段索引。
- **M4. completed 段每 pass 触发多次全 flow 扫描**：src/fold.ts:806（[data-turn-process]）、2214-2217（data-dshcf-turn-metrics）、2292-2324（compareDocumentPosition + querySelectorAll('*')）、3677-3690（findTurnStart 扫 [class*=timeStart]）。长会话几十上百个 completed 段时每帧重复 N×全 flow 扫描。建议 flow 一次性索引缓存（引用+变化代际）或指标计算仅状态变化时触发。
- **M5. localStorage 展开态固定 'default' 命名空间，跨会话串扰**：src/fold.ts:884、1050、1060、1098（全传 'default'）、2471-2487。与函数签名按会话隔离的语义不符；A 会话收起的轮次会在 B 会话同样结构的轮次上也收起。turn-metrics 侧已按 sessionId 隔离，此处口径不一致。建议从 flow 内注入器的 data-dshcf-session 读真实会话 id，无法确定时加不持久化兜底。
- **M6. 默认值 4 处重复定义且顺序不一致**：DEFAULT_STATUS_TEXT：index.ts:9 / settings.ts:7 / fold.ts:41；DEFAULT_SUMMARY_FIELDS 串：index.ts:10 / locales.ts:15；字段数组：locales.ts:13 / fold.ts:3761（顺序还与 index.ts:10 不同：toolCalls/modelCalls 颠倒、cacheHitRate 位置不同）；KEEP_LAST_ROWS/BODY_STEPS：index.ts:12-13 / locales.ts:19-22 / fold.ts:43-46。建议以 locales.ts 为唯一权威源，其余 import；fold.ts 默认数组从 DEFAULT_SUMMARY_FIELDS 派生。
- **M7. locales.ts 整套 i18n 框架是 dead code**：src/locales.ts:24-103。grep 确认 t() 与 formatTokens 在 src 内零调用；fold.ts 内联硬编码中英文，双份文案平行宇宙。建议二选一：文案迁入 locales 词典统一出口；或删除未用部分并在文件头注明现状。
- **M8. roster 签名算法与 endpoint 路径双写**：src/index.ts:52-54（rosterSignatureOf）vs src/roster-watch.ts:34-36（rosterSignature）；index.ts:48（ROSTER_ROUTE）vs roster-watch.ts:71（DEFAULT_ENDPOINT）。一侧漂移会导致看门狗永久判定变化反复重载页面，或 404 被误判为自身被禁用。建议共享常量模块 + 单测断言两侧签名函数对同一输入输出一致。
- **M9. roster 轮询 fetch 无超时**：src/roster-watch.ts:180。未设 AbortSignal.timeout；TCP 挂起时 await 永不 resolve，tick 既不 catch 也不 schedule，轮询链断裂——探针恰是服务异常时的最后防线。建议 signal: AbortSignal.timeout(pollMs)。
- **M10. FiberState 魔法数字跨版本漂移风险**：src/index.ts:114-119（FIBER_DISPOSED=4 / FIBER_UNLOADING=5）。cordis 枚举被硬编码，版本升级调整枚举顺序时 isUnloading 判定反转。建议能力探测或集中一处 + 版本注释 + 启动期自检日志。
- **M11. StatusTextCard 巨型组件 5 组重复模式**：src/settings.ts:197-508（单组件 310+ 行）。五个字段的 pending/dirty/overridden 模式几乎逐字复制，新增字段要同步 5 处。建议抽 useFieldEditor hook 收敛 + save 用字段声明数组统一循环。

### 工程化 / 部署

- **M12. run-all.mjs 硬编码测试清单**：test/run-all.mjs:6-27。新增 *.test.mjs 不会自动纳入；_flash.mjs（含真实可失败的检查）与 debug-blocks.mjs（0 断言）被 git 跟踪但不执行；:35 首个失败即 exit，前面的失败掩盖后面的失败。建议改 glob 收集 + 失败后跑完其余文件汇总。
- **M13. CI 不显式构建、查不出 lib 漂移**：.github/workflows/ci.yml:19-20。build 只是 test 的副作用（run-all 内部调 build.mjs），run-all 一改守卫就丢；CI 不检查 git diff，提交的 lib 与 src 漂移永远测不出。建议显式加 npm run build + git diff --exit-code -- lib/。
- **M14. npm files 白名单缺 assets/**：package.json:40-43。README.md:15 引用 assets/screenshot.png，发布后包页图片 404。建议 files 加 assets 或改外链。
- **M15. deploy fetch 无登录态支持**：deploy.mjs:104-105、205-218、275。启用登录时首页返回登录页→校验失败→回滚路径同样受阻。建议支持 cookie/令牌注入或检测登录页特征给出明确报错。

### 文档

- **M16. README.en.md 严重滞后**：缺 7 个特性条目（轮次保留 N 条/过渡动画/状态标签/交互感知/状态持久化/ARIA/双语，对应 README.md:26,31,41,42,44,45,46）；结构表缺 settings.ts、locales.ts（en:76-88）；指标表述过时（en:37 仍写 node.data.usage，中文已更新 tokenUsage 优先）；兼容性缺 rc.1 适配（en:70-72）。
- **M17. README 与 behavior-spec 无互链、双源漂移**：README 全文无 behavior-spec 链接，而后者自称「唯一权威来源」；README.md:27 有 spec 没有的条款（无被折叠行时不显示空 chip），特性列表与 spec 二/三/四节逐条重叠、无单向引用，漂移必然。
- **M18. dsh-alpha.3_4.md 过时未标注**：修复方向 1、2 已在 turn-metrics.ts:12-18 落地，方向 3 被 README:80 的「形状自适应不依赖版本分支」取代；无「已解决」标记易被误读为当前缺陷。建议归档标注。
- **M19. 模块地图过简**：README.md:86-100 每文件一句话，无关键导出/常量/行号，无 client vs host 架构与注入器数据流说明（数据流散落在 40、47 行各一句）。index.ts 实为配置 schema 默认值 + roster 探针所在地，文档未提。改「动画时长」需 grep "180" 才能找到 fold.ts:49 ANIM_DURATION_MS。

### 测试套件盲区（测试审查 🔴 级，归入中等修复计划）

- **T1. 注入器（React shadow 集成层）整条零测试**：被测 src/turn-metrics.ts:350-557。TurnMetricsNodeView / registerShadow / resolveBuiltinAssistant / ensureCorrectLocale / locale 自纠这些最易碎的集成代码，20 个测试全部通过手工放置 data-dshcf-* 属性模拟注入器产物，注入器本身零执行。建议最小 React 桩测 shadow 渲染器，或把 useMemo 之前的纯函数纳入 metrics-unit。
- **T2. localStorage 持久化「静默空跑」**：src/fold.ts:2471-2487 全 try/catch；fake-dom.mjs:532-617 未提供 localStorage。每次点击行调用 persistSegmentExpanded 抛 ReferenceError 被静默吞掉——「点击→写 localStorage→重载恢复」这一真实用户功能从未被执行过。建议 installDomGlobals 加最小 localStorage 桩 + 展开/收起持久化恢复测试。
- **T3. fake-dom 的 MutationObserver 只记录不重放**：fake-dom.mjs:555-570。真实 observer 的 attributeFilter/subtree 过滤语义在桩里不生效，env.tick() 发空 records，所有测试走「空批次全量失效」兜底（fold.ts:704-710），细粒度定向失效仅 fold-regression 场景 10b 单独测过。真机上 attributeFilter 写错 = 折叠自愈失效，套件测不出来。建议给桩补 record 重放钩子。
- **T4. fold-behavior.test.mjs 在套件内但 0 断言永远通过**：test/fold-behavior.test.mjs:1-227。唯一失败路径是 eval 抛异常，价值仅 bundle 冒烟。建议转真断言或移出清单。
- **T5. compareDocumentPosition 三套语义不一致实现**：fake-dom.mjs:248-272（单一 bit）vs adversarial-race.mjs:24-36、adversarial-session.mjs:23-35（组合位）。真实 DOM 包含关系成立时同时带顺序位；靠被测代码只查单 bit 才不露馅。建议修成真 DOM 语义并删除两份重复实现。
- **T6. fake-dom 的 dataset 与 attributes 不同步**：fake-dom.mjs:300-306。真 DOM 的 dataset 赋值同步到 data-* 属性，桩里不会；潜在行为分叉点。建议 dataset 桥接到 attributes Map。
- **T7. 覆盖盲区 8 条**：①data-selected 详情联动自动展开（fold.ts:1434）零测试；②快捷键输入框守卫（fold.ts:622-626）与 event.repeat 守卫（:620）——所有 keydown 测试不带 target；③reportError 路径（fold.ts:764-772）无测试；④metricsAttempts 20 次重试上限（fold.ts:855-857）无测试；⑤contextDelta 为负只测正增量；⑥parseTurnDuration 新时间格式（fold.ts:3659-3665）只测旧格式；⑦roster-watch 默认实现（__DSH_BOOT__ 基线/defaultStorage/defaultReload）全部被注入替代、默认路径零覆盖；⑧HMR 热替换后旧 observer 不泄漏无测。
- **T8. 16 份测试样板复制粘贴无共享 harness**：boot()/seat()/register()/assert() 在 13+ 文件逐字复制；assert 与 check 两种签名参数顺序相反；document._all 注册 hack 漏一次就查询不到新节点（假绿/假红风险）；已出现 drift（fold-reconcile 的 seat 多一个 data-chat-flow-key 属性）。建议抽 test/harness.mjs。

---

## 🟢 轻微问题

### 安全审查
- roster-watch.ts:163 tryReload() 中 reload() 调用不在 try/catch（默认实现安全，注入实现抛错会 unhandledrejection）。
- fold.ts:768 异常消息截断 500 字符写入 style 元素 data 属性（无执行风险，console.error 已足够）。
- client.ts:69-74 卸载清理链无防御：任一清理抛错中断后续清理，建议逐项 try/catch。

### 核心代码
- fold.ts:855/736/1653 魔法数字 20 / 60 / 36 无注释来源，建议提为命名常量。
- getLocale 双实现：locales.ts:5-10 vs fold.ts:3720-3724，返回类型还不一致。
- turn-metrics 段号计算逻辑双实现：turn-metrics.ts:163-177 vs 327-348，漂移会导致段归属不一致。
- index.ts:155-161 死变量 current 与 :172-174 空操作 onChange（遗留骨架，误导读者以为 host 有通知链路）。
- settings.ts:185/198、turn-metrics.ts:450/468 每次渲染 require('react')，建议模块顶层缓存。
- turn-metrics.ts:457-459 builtinAssistant 的 setTimeout 无清理。
- fold.ts:563/1059-1060 二级展开态 blockExpanded 不持久化，与一级持久化不一致。
- fold.ts:2297-2323 extractTurnMetrics 文本兜底来源只判 BEFORE 不判最近距离，中断/插话场景可能跨回合串扰。

### behavior-spec / 注释
- fold.ts 注释密度 10.3% vs 其余三文件 28.4-36.8%，核心 4013 行大文件注释投入不成比例（抽查头部 160 行质量高）。
- turn-metrics.ts:350-362 模块级可变单例无清理路径（与 R1 同源）。
- behavior-spec 无 TOC / R 代号反向索引（122 行 10 节无目录）。

### 工程化
- deploy.mjs:245 extraFiles 缺失目标时静默 continue，无提示。
- build.mjs:48-58 守卫只查 lib/index.js，不查 client.js 的 banner/footer 拼接结果。
- lib/types/client/index.d.ts 的 FoldClientCtx 比 src/client.ts:44-48 少 slots?/settingsScope? 字段。
- src/external.d.ts 与 node_modules 真实 schemastery（3.18.1 自带类型）重复，注释与实际不符。

### 测试
- fold-keep-last-bodies.test.mjs:199 assert(think !== undefined) 恒真空断言；fold-record.test.mjs:134 labelA.includes('1') 过弱。
- adversarial-race.mjs:88-91 verdict() 定义后从未调用；_flash.mjs:4 相对路径依赖 CWD。
- assert(cond,label,extra) 与 check(name,cond,detail) 两种签名并存；文件按轮次/issue 命名而非功能域，fold-issue-round4 塞了 4 个主题。

---

## 💡 建议

### 安全
- 补 window unhandledrejection 兜底监听（与 reportError 模式一致，卸载时移除）。
- 补 XSS 防回归测试：注入 <img onerror> 断言 chip 内无元素（当前 textContent 架构天然通过，防未来改 innerHTML 回归）。

### 核心代码
- external.d.ts 声明比实际 API 窄，后续调用 description/required 等会 TS 报错；host 侧边界 API 保持 index.ts:57-58 的最小结构化类型风格。
- fold.ts 动画账本（pendingAnims + 身份守卫）是审查中质量最高的部分，建议提炼为可复用工具函数。
- 性能修复优先级：先修 M2（markDirty return）与 R2（指标聚合缓存），改动小收益最大。

### 文档
- README 特性条目行内标注实现位置（如「实现：fold.ts ANIM_DURATION_MS:49」）。
- 指标字段链路点破：默认字段串在 index.ts:10，计算在 turn-metrics.ts，UI 在 settings.ts。
- 【快速定位专项缺失清单】①条款↔源码函数级映射；②条款↔测试矩阵（spec R1-R9 与测试 P1-x 目前靠猜）；③实现状态标记（spec:56/:94 是好样板但仅两处）；④术语表（PTC/steering/segOrdinal/contextDelta 等）；⑤DOM data-* 契约清单附录（client.ts:14-17 只列部分）；⑥排障笔记归档约定。

### 工程化
- deploy 增加 --dry-run/确认；verifyServedBundle 解析 __DSH_BOOT__ url 而非硬编码路由前缀。
- .gitignore 补 *.tgz / .DS_Store / Thumbs.db / .vscode/ / .idea/。
- build.mjs:17 写死 entryPoints，可改目录扫描；CI 触发可加 paths 过滤。

### 测试
- run-all.mjs 顶部补「测试文件 → 被测 src 模块/行为」注释映射表，降低「改 X 跑哪个测试」的查找成本。
- fake-dom selector 对 > / + / ~ / :has 等不支持的组合器直接抛 unsupported，宁可 fail 不要静默错（div > span 当前会被按后代解析）。

---

## ✅ 亮点（审查员一致认可）

- **XSS 架构免疫**：src 与 lib 全部 0 处 innerHTML/insertAdjacentHTML/outerHTML/document.write/dangerouslySetInnerHTML；chip 全走 createElement + textContent；无 on* 内联事件。
- localStorage 读写、三处 JSON.parse 全部 try/catch；host 探针固定 exact path、响应仅 {sig,own}、500 不回显细节、设置 schema 用 z.string()/z.natural() 校验。
- 无第三方请求、无隐私外发；唯一 fetch 为同源 roster 探针。
- 特性声明抽查 6/6 与源码一致（data-tool 回退、keepLastBodySteps 默认 1、180ms 动画、Ctrl/Cmd+Shift+E、roster 1.5s 轮询、tokenUsage 权威口径）。
- fold.ts 动画账本 + dispose 链（冲突仲裁、onfinish/oncancel 双清账、switchFlow 全量 cancel）是质量标杆。
- 测试断言密度高（约 766 条）、行为级断言为主；metrics-unit 计费口径矩阵测试与 roster-watch 依赖注入 harness 是亮点；40 组确定性乱序挂载、假时钟、observer 订阅契约断言体现防自欺自觉。
- 代码注释详尽，防御决策（G2 隔离、防自激、双版本兼容）均有设计说明。

---

## 🎯 文档定位能力专项结论（用户核心关切）

**当前水平：文件名级 ✅，符号级 ❌。**

- ✅ 能快速定位到文件：README 结构表 + 各测试文件头注释质量都不错。
- ❌ 不能定位到符号：改动画时长要 grep "180" 才能找到 fold.ts:49 的 ANIM_DURATION_MS；改指标字段是 index.ts:10 → settings.ts:214 → turn-metrics.ts 三段链路，文档只给了字段名没给链路。
- ❌ 缺三样东西：符号级模块地图（文件+关键导出+行号）、client↔host 架构数据流小节、条款↔代码↔测试三向映射矩阵。

## 修复优先级

1. **P0 立即**：R3 deploy 失配（部署已不可用）→ R4 双源守卫 → R1 HMR 泄漏。
2. **P1 短期**：R2/M2/M3/M4 性能族 → T1-T3 测试盲区补桩 → M9 fetch 超时。
3. **P2 文档**：R5/R6 behavior-spec 整改 → M16 同步 en 版 → M19 升级模块地图 + 三向映射矩阵。
4. **P3 清理**：M6 默认值收敛 → M7 dead code → M8/M5 双实现合并 → M11/M12 样板收敛。

---

*报告生成：6 名 nova/deepseek-v4-flash 审查 subagent 并行审查 + 主代理去重汇总。全程只读，未修改任何文件。*
