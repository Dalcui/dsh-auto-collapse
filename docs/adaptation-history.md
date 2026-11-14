# DSH 宿主版本适配史

各 DSH 版本（0.1.2-rc.1 ~ 0.2.2-rc.1）适配的根因、修法与真机验收记录。处理「某版本宿主升级后行为异常」类问题时来查。
> 来源：自 [README.md](../README.md) §兼容性 拆出（0.3.7 文档渐进披露重构）

---

## 兼容性总则

- 兼容 DSH 0.1.1-rc.x / 0.1.2-alpha.x / 0.1.2-rc.1 / 0.1.7-rc.2 / 0.2.0-rc.2 / 0.2.1-rc.2 / 0.2.2-rc.1。host half 不静态 import `@deepseek-ai/dsh-settings` 里可能被移除的具名导出，运行时按能力选择三代契约：0.1.7+ 走 `SettingsForms`（`describe()` / `configure()`），0.1.2-alpha.3 ~ 0.1.6 走 `settings.installSection()`，更早用 `settings.register()` 复刻旧语义。0.1.7 的完整适配状态与未完成项见 [DSH_0.1.7_ADAPTATION.md](../DSH_0.1.7_ADAPTATION.md)。
- 0.1.2-rc.1 适配：回合 token 权威源迁到 `turn-tail.data.tokenUsage`（`uncachedInputTokens`，cache/reasoning 可选），`assistant-step.data.usage`（类型 `unknown`）仅作回退；`nodes` 从 `Map` 变为 `ChatNodeStore` 接口（仅用 `.get()`）；`connection.hostDescription` 已移除，shadow entry 不再声明 inject 面；locale NS 跟随内置 entry（rc.1 为 `chat`，旧版为 `conversation`）。
- 指标读取按快照形状自适应（tokenUsage 优先、usage 回退），不依赖版本字符串分支，同一份构建产物在升级前后的 DSH 上都能启用。
- 客户端依赖清单 `dsh.client.inject` 只保留当前版本真实存在的模块（`@deepseek-ai/dsh-client-ui-renderer` 提供 `slots` 服务、`@deepseek-ai/dsh-client-ui-settings` 提供 `configForms`）。
- rc.1 默认「对话显示」Compact 模式下，`Shift+点击` 原生 disclosure 行（即轮次指标行）同样可一键展开/收起所有折叠项；`Ctrl/Cmd+Shift+E` 快捷键也同时驱动原生行。

### DSH 0.2.2-rc.1 适配状态（**已完成**）

0.2.2 对**内置 assistant-step 的 entry 级注入面**做了一次破坏性调整：inject face 从
`() => ({ hooks: { presentation } })` 变为
`(sessionId) => ({ hooks: { presentation }, resolveFilePath, fileMentions })`，并把
`fileMentions` 从 ChatView kit 移除（改为只经 face 下发）。内置 `AssistantNodeView` 在
「已闭合回合的最终回复」上无守卫调用 `fileMentions(owner, …)`。

插件的指标注入依赖 shadow 一个 `assistant-step` 渲染器；旧实现只转发
`hooks.presentation`、且无参调用内置工厂 ⇒ shadow 渲染内置组件时 `fileMentions` 为
undefined ⇒ `TypeError: fileMentions is not a function` ⇒ SlotErrorBoundary 退市该条目 ⇒
**全部指标注入失效**（真机：`[data-dshcf-*]` 与 `.dshcf-native-metrics` 全 0；折叠主干
本身不受影响）。

修复（0.3.4）：

- `shadowInjectFace` 转发框架绑定期实参（sessionId）给内置工厂，并**整体透传**内置 face；
  仅对 `hooks` / `keyedHooks` 做防御清洗（非对象丢弃、只保留 WeakMap 合法键），
  `resolveFilePath` / `fileMentions` 等一级 prop 原样透传。旧版（face 只有
  `hooks.presentation`）输出与旧实现等价。
- 0.2.2 的 `RunningStatus` 新增 `data-holding` 隐藏占位（会话已停、回合未闭合）：运行判据
  改为 `[data-chat-running]:not([data-holding])`，避免已停止回合残留实时计时行。

真机验收（3080，DSH 0.2.2-rc.1）：

| 验收项 | 结果 |
|---|---|
| 注入器 shadow host（`data-dshcf-turn-metrics-host/session/seg`） | 74 / 74 / 74 |
| 原生行指标（`.dshcf-native-metrics`） | 2 条（如「65 次模型 · 20.2M 输入」） |
| `data-dshcf-turn-metrics` JSON | 正常（durationMs/toolCalls/modelCalls/inputTokens…） |
| 原生行展开 → 二级 chip | `.dshcf-chip` 出现、`[data-step-process]` 被驱动 |
| 控制台 | 无 `fileMentions` / `slot entry crashed` 报错 |
| 折叠主干 | 与 0.2.1 一致（未受本修复影响） |

**如实声明的边界**：`data-holding` 修复只消除「占位被误判为在跑」；holding 之后若仍有
未闭合尾段，插话段仍按临时态处理（既有 openTail 收敛条件，见 behavior-spec R12），
本版本不改变结算语义。

### DSH 0.2.1-rc.2 适配状态（**已完成**）

0.2.1 对**会话流的 DOM 结构**做了一次破坏性调整：会话列 `[data-chat-flow]` 的全部流子级
被包进一个扩展位 `<div data-slot="conversation.chat.flow" style="display:contents">`。
官方自己读取顶层行时同口径解包（`dsh-client-ui-chat` 0.2.1 源码两处）：

```js
(elements.column.querySelector(':scope > [data-slot="conversation.chat.flow"]') ?? elements.column).children
```

插件原先直接把列的子级当「流项」，在 0.2.1 上只能看到 `[加载更早, 扩展位]` 两项，后果是
**整段会话被当成一个巨型块**（实测：5 个回合只出 1 个 chip，摘要横跨全会话）、段的
`boundary`/`finalStep` 全空 → 段键 (turn/sessionId) 取不到 → **原生 turn-process 行上的
指标注入整体失效**（实测 `.dshcf-native-metrics` = 0）。

本轮修复（`src/fold.ts`，向后兼容 0.2.0 及更早）：

- **流内容解包**：新增 `flowContentOf()` / `flowContentRootOf()`，与官方 `:scope >` 同口径地取列的**直接子级**扩展位；无该扩展位（旧版 DSH）时回退列自身。`findFlowCandidates()` 返回解包后的内容根，`FoldManager` 每列一个 `FoldController` 的语义不变。
- **可见性判定沿祖先链回退**：扩展位是 `display:contents`（无布局盒、`rect` 全 0、`offsetParent` 为 null），旧 `isFlowVisible` 会把**所有**列判为不可见 → `findFlow()` 退化成「文档序第一个候选」→ 右侧栏子代理列重新失去服务。现沿祖先链最多 8 层找第一个有布局盒的元素再判定。
- **缓存键一致性**：`metricsHostListCache` / `flowSessionCache` / `flowStructureVersion` / `timeStartIndexCache` / `publishedSegCache` 一律以**流内容根**为键，与控制器绑定、`invalidateFlowIndexes` 的失效键**同一个对象**。否则会出现「存的是列、失效的是扩展位」——缓存永远命中不到失效事件，拿到过期的注入器 host 列表与段号代数。
- **`turn-trigger` 节点**（0.2.0 起既有，**非** 0.2.1 新增；0.2.0 的 `TURN_PROCESS_INDEPENDENT_KINDS` 已含它）：官方用它承载「收到任务消息 / 子任务状态更新」这类非人类输入回合的起点。插件把它当普通非边界节点处理，段仍由 `turn-tail` / 原生行闭合。⚠️ **如实声明**：桩测试场景 7 在「已解包」基线上**不能**单独区分 turn-trigger 处理的正确性（它在未解包版本下失败的原因是解包缺失），因此该场景属**行为快照**而非 turn-trigger 的鉴别性覆盖；真机上已观察到 turn-trigger 起头的回合各自收敛到自己的原生行与 chip。

真机验收（隔离实例 3082，DSH 0.2.1-rc.2，真实会话 5 回合 / 36 官方组 / 89 流项）：

| 验收项 | 结果 |
|---|---|
| 插件状态属性 `data-dshcf-state` | `active`（无 pass 异常） |
| 原生行指标 span | 4 条回合全部恢复（`17 次模型 · 24 次工具 · 11.2M 输入 …`） |
| 官方二分序列内的插件节点 | **0 个**（chip 全挂 turn-process 座位内） |
| 二分序列 `rect.top` 单调性 | 破坏计数 **0** |
| 展开原生行后的二级折叠 | chip 正常产出（`已折叠 16 个工具组 code ×12 · edit ×3 · thinking ×1`），覆盖组被收起、最后一组保持展开 |
| 设置卡片 | 插件页正常显示「dsh-auto-collapse 配置折叠行为与摘要栏显示指标」，无崩溃 |
| 回归测试 | `test/fold-flow-slot.test.mjs`（8 场景 18 断言）+ 全仓 36 个测试文件全绿 |

**测试鉴别力分工（如实声明，勿误解）**：把改动前产物与新测试组合实测——HEAD 版有 9 条断言失败，能区分「解包前/后」；
但**场景 3（多列可见性）** 在「只回退 `isFlowVisible`」的变体上仍全绿（夹具两列 rect 都 >0，旧实现也判可见），
即它**不鉴别**祖先链回退；**场景 6** 是唯一能鉴别「缓存键一致性」的场景（只回退缓存键改动 → 仅它失败）；
**场景 2/7** 只鉴别「解包」这一层，属行为快照。

### 插话（steering）进行中工况修复（2026-10-22，v0.3.1）

用户报告：**插话发送时，被插话轮次的非最后一条正文全被隐藏，且轮次指标行与次级工具折叠行位置颠倒**。

真机取证（DSH 0.2.1-rc.2；插话 = 运行中在输入框按 **Ctrl+Enter**，`mode:"steer"`）：

| 阶段 | 修复前 | 修复后 |
|---|---|---|
| 插话刚送达、模型仍在跑 | 段 A 中间正文 `display:none`；`dshcf-processed`（指标行）在段级 chip **下方** | 全部正文可见；只有一条实时行 `已工作 X秒 …`，位于 `turn-process` 座位之后、官方组之前 |
| 回合闭合（插话使官方 `alwaysOpen`） | 插件仍建 chip、驱动工具组收起、隐藏 `model-retry` 行 | **完全不介入**（不建 chip / 不驱动 / 不隐藏），指标仍注入原生行 |

根因两条：

1. **段边界闭合 ≠ 回合已结束**。插话是排队机制，`steering` 节点把进行中的回合切成段 A / 段 B，
   而旧实现把「段被 `steering` 收尾」直接当成「回合已完成」⇒ 立刻建一级行、隐藏 `middleSteps`、
   建段级 chip。但 chip 挂在 `turn-process` 座位内（回合顶部），于是指标行被挤到折叠行下方。
2. **0.2.1 原生行的展开态改用 `data-open`**（`"data-open": open || void 0`），`aria-expanded` 只在
   `hasContent` 时写；插话回合 `hasContent = !interleavedInput && …` 恒 false ⇒ 旧 passive 判据
   `aria-expanded==="true" && disabled` 恒假 ⇒ 插件在官方「恒展开不可折叠」的回合上继续介入。

修复（`src/fold.ts`）：

- 新增 `provisionalSegmentKeys()`：被 `steering` 收尾、且该回合**尚无结束证据**（无后续 `turn-tail` /
  下一回合 `user` / `terminated`）、且仍有未闭合段或宿主仍渲染 `[data-chat-running]` 的段 = **临时段**。
  临时段不建 `SegmentState` ⇒ 无一级行、无段级 chip、正文与状态行不被折叠；段内官方组仍按直播语义驱动。
- `syncLiveRows` 改为**按回合归属**：一个回合只保留一条实时行，所有者 = 该回合最后一个「有工作」的候选段。
  插话刚送达、段 B 尚无内容时所有者仍是段 A ⇒ 实时行原地不动（不闪断）；段 B 有内容后行随之落位。
- 新增 `nativeTurnRowOpen()`（`data-open` 优先、`aria-expanded` 兜底，0.1.2 ~ 0.2.1 全兼容），
  passive 判定与 `toggleExpandAll` 改用它；`MutationObserver` 的 `attributeFilter` 补 `data-open`。
- passive 段、以及「段转直播 / 段消失」路径都主动 `dropSegmentChip`——不再留孤儿折叠行。

验收：新增 `test/fold-steer-live.test.mjs`（10 场景 40 断言，含真实用户时序：先段 A、tick、再插话），
变异实测 11 组全部被杀（回退临时段判定 ⇒ 4 FAIL；回退 `data-open` ⇒ 2 FAIL；回退按回合归属 ⇒ 4 FAIL；
回退 passive chip 撤销 ⇒ 1 FAIL；删 settled 门 ⇒ 6 FAIL；回退 aria 兜底 ⇒ 1 FAIL；
删 passive 撤退时的组还原 ⇒ 1 FAIL）；全仓 37 个测试文件全绿；真机插话会话复测通过。
（注：其中「passive 撤退还原组」这一条已被 0.3.8 撤销——还原方向本身违反契约，见下节。）

### passive 回合工具组被强行展开的回归（2026-11-14，v0.3.8）

用户报告：**被插话发送 / 中断（aborted）的回合里，正文之间的工具调用记录不可折叠**。
真机 A/B：同一会话同一位置，禁用插件后组头可正常开合；启用插件后组保持全部展开。

根因（0.3.2 引入、0.3.7 仍在）：「插件完全不介入 passive 段」的收尾被实现成
`driveGroups(covered + last, true)`——把此前由插件驱动收起的官方组**全部翻成展开**。
两个放大因素：① passive 判定按回合号匹配，一个 aborted 回合会让该回合的**所有段**走该分支；
② 段状态在会话切换 / DOM 重挂后重建，收尾会重跑 ⇒ 每次切回会话又全展开，用户手动折叠保不住。
而官方 `ChatGroupSeat` 的组展开态是组件本地 `useDisclosure()`（无初始值 ⇒ 默认收起），
「撤退后组会永久停在收起态」的原始理由不成立——收起态正是宿主默认。

修复：passive 分支只 `dropSegmentChip`（一级行由 nativeManaged 分支移除），
**不调用任何 `driveGroups`**；删除 `SegmentState.passiveRestored` 字段。
验收：`test/fold-steer-live.test.mjs` 场景 G/G2 改为钉「不驱动」双向契约，新增场景 L
（passive 冷启动 + 用户手动开合）；变异实测——每 pass 无条件展开 ⇒ 5 FAIL、忠实 0.3.7
（`passiveRestored` 一次性门控）⇒ 6 FAIL、反向驱动收起 ⇒ 4 FAIL、只展开 covered ⇒ 5 FAIL；
全仓 38 个测试文件全绿。

### DSH 0.1.7-rc.2 适配状态（**已完成**）

0.1.7 对客户端契约做了三代不兼容改动。全部适配已落地：

- **加载期**：静态 inject 收敛为 `['slots']`、可选服务一律走 `ctx.get`、
  host 侧三代设置契约（`SettingsForms` → `installSection` → `register`）、
  运行期 `Config` schema（volatile）+ 引用对象 `deref`、设置卡迁移到 `plugins.item`、
  激活期异常隔离（任一异常降级为「本插件不生效 + 一条日志」，不拖垮 `dsh web`）。
- **折叠**（本轮核心）：把官方工具组 `div[data-step-process]` 当作**不透明容器**——
  组根不再被误当作折叠宿主（此前会导致**整组消失**等三类可见故障）；
  `[data-step-process]`/`-body`/`-content` 与任何带原生 `hidden` 的元素一律**只读不写**；
  二级折叠改为**驱动官方组标题按钮**；chip 改挂 `turn-process` 座位内部，
  **绝不落在 `div[data-chat-flow]` 的直接子级**（官方 `readVisibleTurn` 对它做二分）；
  状态词替换改为**结构判定 + 语言无关**；`reasoning` 分层 part 不再被判为正文；
  verbose（原生恒展开）下插件完全不介入；并清理老会话中旧版遗留的 `style.display`。
- **指标**：shadow entry 声明 `inject` 转发内置 hook source（方案 C），
  `usePresentation` 不再崩溃、回合指标恢复；原生 label 已显示的时长**去重**，
  并读官方 `data-turn-process-{messages,tool-calls,subagents}` 拿权威计数。

- **设置保存链路（2026-09-29/30 修复）**：修复「配置改完点保存，值落盘但运行态永远
  不更新（输入框回弹旧值，重启才生效）」。根因：本插件在 profile 里解析到的 schemastery
  **没有 `.volatile()`**，其 validate 不把 volatile 字段包成引用对象，而宿主 loader 的
  volatile-only 快路径在 `volatileEntries(fiber.config)` 为空时**静默返回**——保存被吞。
  修法（详见 `SAVE_ISSUE_ROOTCAUSE.md` 最终修复记录）：用 `Symbol.for('cosmokit.volatile.write')`
  自造协议等价 ref + 包装 `Config['~standard'].validate` 让 resolveConfig 两条路径都产出
  ref + `apply` 保留引用每次现读。**保存后即时生效，无需重启**；宿主若是有 volatile 语义的
  schemastery（≥3.18.2），包装自动退化为透传。
完整记录（含真机 DOM 事实、关键机制备忘、隔离验收步骤与验收标准）见
**[DSH_0.1.7_ADAPTATION.md](../DSH_0.1.7_ADAPTATION.md)**，
开发规格与决策记录见 **[ADAPTATION_PLAN_0.1.7.md](../ADAPTATION_PLAN_0.1.7.md)**，
真机 DOM 快照见 **[DOM_SNAPSHOT_0.1.7.md](../DOM_SNAPSHOT_0.1.7.md)**。

---

## English: compatibility bullets (verbatim from legacy README.en.md, before the 0.3.7 docs refactor)

- Works on DSH 0.1.1-rc.x, 0.1.2-alpha.x, 0.1.2-rc.1, 0.1.7-rc.2, 0.2.0-rc.2, 0.2.1-rc.2, and 0.2.2-rc.1. The host half no longer statically imports `settingsNamespace` / `installSettingsSection` from `@deepseek-ai/dsh-settings`; it resolves the `settings` service at runtime and picks the capability across three generations: `SettingsForms` (`describe()` / `configure()`) on 0.1.7+, `settings.installSection()` on 0.1.2-alpha.3 ~ 0.1.6, and `settings.register()` re-implementing the old semantics on older DSH. See [DSH_0.1.7_ADAPTATION.md](../DSH_0.1.7_ADAPTATION.md) for the full 0.1.7 adaptation status.
- 0.1.2-rc.1 adaptations: the authoritative turn token source moves to `turn-tail.data.tokenUsage` (`uncachedInputTokens`; cache/reasoning buckets optional) with `assistant-step.data.usage` (type `unknown`) only as fallback; `nodes` changes from `Map` to the `ChatNodeStore` interface (only `.get()` is used); `connection.hostDescription` is removed, so the shadow entry no longer declares an inject face; the locale namespace follows the built-in entry (`chat` on rc.1, `conversation` on older versions).
- 0.2.2-rc.1 adaptation (0.3.4): the built-in `assistant-step` entry-level inject face now carries `resolveFilePath` / `fileMentions` and takes `sessionId`; the metrics shadow renderer forwards the whole face verbatim (for older DSH the face is just `{ hooks: { presentation } }`, so output is unchanged). `[data-chat-running]` may carry `data-holding` (a hidden placeholder while a stopped turn is not yet closed) and is excluded from the running predicate.
- Metric reading adapts to the snapshot shape (tokenUsage first, usage fallback) without version-string branches — no per-version artifacts needed.
- The `dsh.client.inject` list keeps only modules that actually exist in the current version (`@deepseek-ai/dsh-client-ui-renderer` provides the `slots` service, `@deepseek-ai/dsh-client-ui-settings` provides `configForms`).
- With rc.1's default "Conversation display" Compact mode, `Shift+click` on the native disclosure row (the turn metrics row) also expands/collapses all folds, and the `Ctrl/Cmd+Shift+E` shortcut drives the native rows too.
