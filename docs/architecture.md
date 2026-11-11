# 架构与模块地图

符号级模块地图（改行为先按符号定位）、client ↔ host 数据流、条款↔实现↔测试三向映射、关键机制。跨模块改动与新人上手必读。
> 来源：自 [README.md](../README.md) §开发 拆出，末尾英文 key mechanisms 段逐字自 [README.en.md](../README.en.md)（0.3.7 文档渐进披露重构）

---

## 项目结构（符号级模块地图）

改某个行为时先来这里按符号名定位（再 grep 符号名到行）：

```
src/index.ts         host half（node 侧）：默认值常量（DEFAULT_STATUS_TEXT / DEFAULT_SUMMARY_FIELDS /
                    DEFAULT_CODE_DESCRIPTION / DEFAULT_KEEP_LAST_ROWS / DEFAULT_KEEP_LAST_BODY_STEPS）、
                    markVolatile（运行时 Config schema 的 volatile 标记；schemastery 无
                    .volatile() 时退到 .extra('volatile', true) 兜底——缺了它整个配置页不出现）、
                    createVolatileRef / withVolatileValidate（P5：自造 cosmokit volatile 协议 ref
                    并包装 ~standard.validate，使 resolveConfig 两条路径都产 ref——否则宿主
                    loader 的 volatile-only 快路径会静默吞掉保存，值落盘但运行态不更新）、
                    settings 命名空间注册（installSettingsSection：新 installSection / 旧 register 能力选择）、
                    roster 探针路由（ROSTER_ROUTE:57 / rosterSignatureOf / createRosterHandler）
src/client.ts        浏览器入口：apply() 组装 FoldController + 指标注入器 + roster 看门狗 + 设置卡片；
                    inject 面 ['slots']（设置服务运行时按能力解析：configForms / settingsScope）；卸载清理链逐项防御（HMR 可逆）
src/fold.ts          核心折叠状态机 FoldController：flowContentOf / flowContentRootOf（0.2.1
                    流扩展位解包：列子级 [data-slot=conversation.chat.flow] → 流内容根；
                    findFlowCandidates 返回内容根，所有以流为键的缓存与失效同键）·
                    driveGroupOnce（组驱动：展开走官方 beforematch
                    揭示通道、回退 click + focus 中和）/ groupPartitionOf（covered=chip 代表、last=恒展开）/ 
                    findBlocks（块识别）/ buildSegments（段协调 +
                    进行中尾行保留序列 sysRowOrder）/ pass 的分组作用域 groupScopeOf·coversTurnOf（按
                    折叠指标行所在位置分割分组：原生行→整回合 / 自建行→所属段）/
                    ensureChip（chip 创建/摆放）/ updateChip（chip 内容刷新/状态与图标同步）/
                    动画账本（ANIM_DURATION_MS=180ms:46、ANIM_EASING:47、pendingAnims）/
                    状态持久化（persistedSegmentExpanded / persistSegmentExpanded）/
                    extractTurnMetrics（指标提取）/ markDirty（正文缓存定向失效）/
                    onKeydown（Ctrl/Cmd+Shift+E）
src/turn-metrics.ts  回合指标注入器：buildTurnGroupMetrics（分组级批次聚合：段作用域 + 整回合作用域
                    TURN_SCOPE_SEG，一趟 O(回合节点数)）/ computeTurnMetrics（单作用域外壳）/
                    computeSegOrdinal（段序号）/ cachedTurnMetrics（帧级缓存按 sessionId:turn 存全部分组，
                    METRICS_CACHE_MAX:512）/ cachedSegOrdinal（段号缓存）/
                    publishTurnMetrics·readTurnMetrics·readPreviousTurnLastInput
                    （sessionId:turn:分组作用域 存储，MAX_PUBLISHED_KEYS_PER_SESSION:128）/
                    TurnMetricsNodeView（shadow 渲染器，发布两种作用域 + 写
                    data-dshcf-turn-metrics / data-dshcf-turn-scope-metrics）/ installTurnMetricsInjector·
                    disposeTurnMetricsInjector（安装/卸载）
src/roster-watch.ts  启停热生效看门狗：rosterSignature / shouldReloadRoster / installRosterWatchdog
                    （1.5s 轮询 + 3s 防风暴 + 404 恢复信号；共享常量见 roster-constants.ts）
src/roster-constants.ts  roster 共享常量：ROSTER_ROUTE:9 / OWN_CLIENT_ID / rosterSignature
                    （client 侧权威源；host 侧 src/index.ts 镜像，两侧单测锁定一致）
src/settings.ts      设置卡片：AUTO_COLLAPSE_NS / DEFAULT_STATUS_TEXT:7 / statusTextProvider·
                    summaryFieldsProvider·codeDescriptionProvider·keepLastRowsProvider·
                    keepLastBodyStepsProvider / setupSettingsCard
src/locales.ts       默认值权威源：SUMMARY_FIELDS / DEFAULT_SUMMARY_FIELDS_STRING:17 /
                    AUTO_COLLAPSE_NS:25 / DEFAULT_CODE_DESCRIPTION / DEFAULT_KEEP_LAST_ROWS /
                    DEFAULT_KEEP_LAST_BODY_STEPS
build.mjs            esbuild 双产物构建：client（iife + __ModuleLoader__ banner）+
                    host（src/index.ts 去类型编译为纯 JS）+ 双 node --check 语法守卫 +
                    d.ts 导出面守卫（metafile 对比手工 lib/types 声明）
deploy.mjs          安全部署：--verify 只读校验 / DSH_WEB_COOKIE 登录态 / 合并路由字节包含校验 / 失败回滚
cordis.patch.yml    profile 树挂载
test/                fake-dom.mjs 共享桩 + run-all.mjs（glob 收集）驱动的 38 个测试文件（36 个 *.test.mjs + 2 个 adversarial-*）
                    （fold-chip-drive = chip 驱动行为锁；host-volatile = volatile 路径强锁；
                    host-volatile-ref = P5 保存链路行为锁，V0 有鉴别力、V1/V2/V5 为行为快照）
```

## client ↔ host 架构与数据流

- **host**（lib/index.js，由 src/index.ts 编译）：向 DSH 注册 settings 命名空间 `dsh-auto-collapse`（schema 默认值）与 `/dsh-auto-collapse/roster` 探针路由（只返回 clientModules 模块图签名与自身在列，不枚举插件清单）。
- **client**（lib/client.js，src/client.ts 打包）：经 inject 面取 `slots`（shadow 渲染器注册）；设置读写经运行时能力解析的 scope（0.1.7+ 为 `configForms.get(ns)`，旧版为 `settingsScope.bind`）。
- **指标数据流**：React 会话快照（order/nodes/turnTimings）→ TurnMetricsNodeView（slots shadow，priority -1）→ buildTurnGroupMetrics 按分组聚合（段作用域 + 整回合作用域，同一趟派生）→ publishTurnMetrics 写模块级 Map + DOM `data-dshcf-turn-metrics`（段作用域）/ `data-dshcf-turn-scope-metrics`（整回合作用域）属性 → fold.ts extractTurnMetrics 按**折叠指标行作用域**取值展示。
- **配置数据流**：设置卡片编辑 → scope 写入（0.1.7+ 走 `form.mutate` 原子提交）→ host schema 校验落盘 → scope 订阅回调 → FoldController.refresh() 重读 provider。
- **启停数据流**：roster 探针（host）→ 浏览器 1.5s 轮询 → 签名变化 / 自身路由 404 → 带缓存穿透参数重载页面。

## 条款 ↔ 实现 ↔ 测试（三向映射，按 behavior-spec 条款域）

| 条款域（behavior-spec） | 实现（src） | 测试（test） |
| --- | --- | --- |
| 一级回合完成收起 / 展开还原 / 停止还原 | fold.ts FoldController.pass / syncProcessedRow | fold-regression（场景 1/7）、fold-record、fold-round2 |
| 二级 chip 跨类别合并与计数 | fold.ts findBlocks / updateChip | fold-regression（场景 2/3/11/12）、fold-issue-round4 |
| 指标聚合（sessionId:turn:segOrdinal 隔离） | turn-metrics.ts computeTurnMetrics / publishTurnMetrics | metrics-unit、fold-metrics |
| 指标注入器安装 / 卸载（HMR 可逆） | turn-metrics.ts installTurnMetricsInjector / disposeTurnMetricsInjector | turn-metrics-injector |
| 动画 180ms 与动画账本 | fold.ts ANIM_DURATION_MS / pendingAnims | fold-animation |
| 重试 / 异常终止折叠 | fold.ts model-retry·终止判定 | fold-retry、fold-issue-round3 |
| keepLastRows / keepLastBodySteps | fold.ts keepTrailing / keepLastBodySteps | fold-keep-last-rows、fold-keep-last-bodies |
| 原生 compact 模式协同 | fold.ts syncNativeDisclosure | fold-native-compact |
| 组驱动（beforematch 通道 / 最后一组展开） | fold.ts driveGroupOnce / groupPartitionOf | fold-chip-drive（D1/D2/D2b） |
| 块外状态行收入 chip 折叠 | fold.ts pass 的段级 chip 循环 | fold-chip-drive（D3/D4） |
| host Config volatile 标记（3.18.1 兜底） | src/index.ts markVolatile | host-volatile（V/W 段） |
| 保存链路 volatile ref（P5：resolveConfig 双路径产 ref + apply 现读） | src/index.ts createVolatileRef / withVolatileValidate | host-volatile-ref（V0 强锁） |
| 展开态 localStorage 持久化 | fold.ts persistSegmentExpanded | fold-persist |
| 正文缓存定向失效 | fold.ts markDirty / bodyTextCache | fold-regression（场景 10b/10c/10d） |
| roster 启停热生效 | roster-watch.ts installRosterWatchdog | roster-watch、host-roster |
| 乱序挂载最终收敛 | fold.ts pass 全量重建 | adversarial-race、adversarial-session |
| **0.2.1 流扩展位解包 / 缓存键一致性** | fold.ts flowContentOf、flowContentRootOf、isFlowVisible | fold-flow-slot（8 场景；场景 6 专测缓存键，场景 8 专测组内同名 slot） |


## 关键机制

- **块识别**（`findBlocks`）：顶层节点按 tool-call、command/manual-compaction、context、thinking 和正文分类；user/steering/turn-tail 是不可跨越的硬边界。
- **segment 协调**：每轮根据当前 DOM 顺序重建 segment；最后一个含文本或媒体的 `assistant-step` 是 final，其余正文是中间过程。稳定 flow/key 复用展开状态，不依赖一次性 mutation 事件。
- **时长**：流式回合按 segment 分别记录 running 起点；历史回合从官方时长或 `timeStart`/turn-tail 解析。格式 `X秒` / `X分Y秒`，整分省略秒位。
- **React 共存与可逆性**：节点替换后按稳定 key 重新绑定；一级行被移除会按原展开状态重建；所有 inline `display` 在首次改写前保存并精确恢复。
- **插件启停热生效**：node half 暴露 `/dsh-auto-collapse/roster` 探针（可选注入 webServer，只返回 clientModules 模块图 id 集合的签名与自身是否在列，避免 LAN 无鉴权枚举插件清单）；浏览器 half 每 1.5s 轮询对比基线，签名变化（任意客户端插件启停）或自身路由 404 时带缓存穿透参数自动重载页面；sessionStorage 时间戳 + 3s 最小间隔防重载风暴。插件被禁用后旧页面会在 ~3s 内刷新并移除折叠效果；重新启用本插件时，仍持有旧 bundle 的页面自动恢复，其余页面手动刷新一次。

---

## English: key mechanisms (verbatim from legacy README.en.md; 最新模块地图以上方中文版为准，旧英文 layout 清单因已过时被弃用)

### Key mechanisms

- **Block recognition** (`findBlocks`): top-level nodes are classified as tool calls, command/manual-compaction cards, contexts, thinking, or body content; user/steering/turn-tail nodes are hard boundaries.
- **Segment reconciliation**: every pass rebuilds segments from current DOM order. The last `assistant-step` containing text or media is final; earlier bodies are intermediate work. Stable flow/node keys preserve UI state without one-shot mutation bookkeeping.
- **Duration**: streaming segments each track their own first running observation; historical segments parse official duration or the `timeStart`/turn-tail range. Whole minutes omit the seconds field.
- **React coexistence and reversibility**: replaced nodes rebind by stable key, removed level-one rows rebuild with their expansion state, and every inline `display` value is saved before mutation and restored exactly.
