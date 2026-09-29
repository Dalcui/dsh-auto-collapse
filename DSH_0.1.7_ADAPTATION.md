# DSH 0.1.7 适配记录（**折叠与指标已完成**）

> 状态：**已完成**（2026-09-28）。
> 本轮按 `ADAPTATION_PLAN_0.1.7.md` 完成：根因修复（组根被当折叠宿主）、
> 在官方折叠基础上重建插件能力（段级 chip + 官方组驱动）、指标 shadow inject 转发（方案 C）、
> `keepLastRows` 软降级、四模式与谓词修正、状态词替换语言无关化。
>
> | 验证项 | 结果 |
> |---|---|
> | `node test/run-all.mjs` | **29 个测试文件全部通过** |
> | `npm run typecheck` | 零错误 |
> | 隔离实例（`auto-collapse-dev`，3082）21 条探针 | 通过（见 §7） |
> | 真机真会话（6 回合 / 97 官方组 / 208 工具行） | 无 B1/B2/B3 破坏；组根 `style.display` 恒空串 |
>
> **新增事实核对**：本文件 §3.1 曾记「data-step-process="true" [data-chat-group-key] [data-chat-turn]」，
> 真机复核**组根无 `data-chat-flow-kind`**（与 §3.1 的另一种说法一致），且**组根带 `data-chat-turn`**；
> 另 `data-group-expanded-mode` 在**折叠模式下不写**（属性语义与直觉相反，见 SPEC §4.3）。
> 详见 `DOM_SNAPSHOT_0.1.7.md`。

对应提交：393a792（"修复 0.1.7-rc.2 加载失败并适配新设置契约"）。

---

## 1. 为什么必须先修：0.1.7 会让整个 dsh web 起不来

插件原先只适配到 0.1.2-rc.1。0.1.7 对客户端契约做了三代不兼容改动，其中
export const inject = ['slots', 'settingsScope'] 里的 settingsScope 服务**已被删除**：

- 静态 inject 一个当前版本不存在的服务 → 该 fiber 永久停在 PENDING；
- 前端 boot 断言 VS() 只遍历 loader 顶层 entry，非 active 即抛
  web boot: N entries did not activate；
- 结果是**整页停在 "Failed to load plugins"**，而不是只有本插件失效。

DSH 对加载失败的插件**没有任何降级**。所以"适配"的第一要务是别把宿主拖下水。

---

## 2. 已完成（隔离实例实测通过）

| 接缝 | 0.1.7-rc.2 现状 | 本仓库处理 |
|---|---|---|
| inject: ['settingsScope'] | 服务已删除 → PENDING → boot 失败 | 收敛为 ['slots']；设置服务运行时按能力解析（configForms 优先，回退旧 settingsScope），新增 LateScope 迟绑定容器（优先级 / 幂等 / 形状校验 / dispose） |
| ctx.<service> 属性访问 | ctx 是**带守卫的 Proxy**，未声明服务名直接读抛 cannot get property "X" without inject | 可选服务一律走 ctx.get(name)；无 get 的旧版/单测回退直接属性访问（两条路径都兜错） |
| host settings.installSection / register | 双双删除 → SettingsForms（describe/configure/update/replace/mutate） | 三代契约能力选择；新版用 settings.describe() 读自身命名空间真值 + configure({auto:false}) |
| 设置表单来源 | 只认插件**导出的运行期 Config schema**；且只有带 .volatile() 标记的字段进入表单投影（volatileForm()） | export const Config = z.object({...})，5 字段全部 volatile；markVolatile() 对无该方法的老 schemastery 降级 |
| volatile 的值形状 | cordis 用 Config['~standard'].validate() 解析 patch 后，volatile 字段被包成 { get() } **引用对象**（默认值同样被包裹） | apply 开头统一 deref() |
| 设置卡 slot | settings.plugin.item 删除 → plugins.item（list slot，owner props {view:'summary'\|'page', form?:{state,mutate}}） | 新契约：page 视图直接交出表单本体，保存走一次原子 mutate(ops, revision)；旧 slot 仍注册（当前版本不派发即无害） |
| 指标 shadow 渲染器 | 内置 assistant-step 的 inject 面 {hooks:{presentation}} 需经框架 observableHook 包装才成为可调用的 usePresentation | 复刻不了该包装时**不注册 shadow**（保住 DSH 原生渲染，只丢指标） |
| 激活期异常 | 任一 entry 非 active 就整页停 | apply 装配体整体兜住：异常降级为"本插件不生效 + 一条日志" |

### 2.1 deref() 为什么是必须的（B1，最容易漏）

不解引用 volatile 引用对象会同时坏两件事：

1. sanitizeConfig() 只透传字符串/数字 → 带引用对象的 config 被整段丢弃 → roster 探针
   的 config 恒为 null → **R6 远程（LAN/手机）真值兜底静默失效**；
2. 旧版 installSection / register 分支把 entry 当 base 交回 schema 校验 →
   ValidationError: $.statusText expected string but got [object Object] → settings 子 fiber
   FAILED、命名空间永不注册（旧版 0.1.5 的 describe() 还会 structuredClone(base) 抛
   DataCloneError）。

### 2.2 usePresentation 崩溃（已止血，非最终解）

内置 assistant-step 注册时声明了 inject: () => ({ hooks: { presentation } })。槽位框架
materializeStandardBinding() 会把 hooks 隔间里每个 source 经 observableHook
(= bindSnapshotSelector) 包装，并以 standardHookPropName(name) = "use" + Name 挂成一级
prop（presentation → usePresentation）。

本插件的 shadow entry 优先级**低于内置**（内置未声明 priority → 默认 0，插件取"所有同 key
条目里最小的 priority 再 -1"，是动态算的、不是写死 -1；见 `registerShadow()`），
SlotCore 规则"最低者渲染"，于是我们抢走了渲染，再手动
React.createElement(builtin, props) 委托内置——但 props 里没有 usePresentation
（实测 shadow props 含 useSession/useChat/useTurnData/useDisclosure/... 但**不含**
usePresentation），于是 ReasoningRow 抛 usePresentation is not a function，
conversation.chat.node 条目整条崩溃（实测刷出 200+ 条错误、思考行消失）。

当时结论：StoredEntry.inject 上能拿到注册方的工厂（实测 inject() 返回 { hooks: ... }），
但 source **不是函数**，误判为"必须自己复刻 observableHook 才可用"；
复刻不了时 canShadowBuiltin() 返回 false，**干脆不注册 shadow**。

> 这是有意的降级：保住 DSH 原生渲染，只丢本插件的指标。
> **该结论已被推翻**——不需要自己复刻：给 shadow 自己的 register options 声明 `inject`
> 转发 source，框架就会替我们包装（**方案 C**，见 §3.2）。当前代码仍是"不注册 shadow"的
> 降级态，恢复指标是下一轮的事。

### 2.3 data-state="preparing" 被误判为已完成（已修）

DSH 的 toolview 把工具调用的**准备阶段**渲染成 `data-state="preparing"`，并且官方自己就按
`state === 'running' || state === 'preparing'` 判运行中（见 §4.6）。插件原先只认 `'running'`，
于是准备阶段的工具行被当成已完成行。

已修：`fold.ts` 新增 `isRunningState(state)`（`'running' | 'preparing'`），替换三处判定——
`deriveBlockInfo` 的 `runningTool`、`rowRunning`、以及段级 `runningNow`（终止判定）。
新增 `test/fold-preparing.test.mjs`（P1 preparing 应为运行中 / P2 running 不回归 / P3 ok 不得判为运行中），
并已验证"去掉修复即 FAIL"（`chip="已思考1 段思考"`）。

---

## 3. 本轮完成（原「未完成」项已全部落地）

### 3.0 完成清单（对照规格书 §7 W1/W2）

| 项 | 实现位置 | 说明 |
|---|---|---|
| W1-1 `findBlocks` 不把组根当 `block.host` | `fold.ts:isOfficialGroup` + `findBlocks` 的 `if (el.hasAttribute('data-step-process')) continue` | 组作为**不透明容器**：不收集其内部行、不作 host、不断开合并 |
| W1-2 §4.4 落地 | `ensureSegmentChip` / `segmentChipHost` | 段级 chip 挂 **turn-process 座位内部** → 不落 `column.children`（真机实测 `chipsInColumn=0`） |
| W1-3 `findFlow` 收窄 | `FLOW_SELECTOR` = `[data-chat-flow]:not([data-step-process-content]):not([data-chat-group-key])` + subagent 面板排除 + 去掉 `flows[0]` 盲回退 | 真机 `flowsTotal=98`（嵌套 97），收窄后恒取外层列 |
| W1-4 正确谓词 | `groupBodyVisible` / `groupCollapsibleMode` | 照抄 CHAT:2082 否定条件口径（属性存在 ⇔ **非**折叠模式） |
| W1-5 click 驱动 + 防护四件套 | `driveGroups` / `withMuting` / `releaseMuting` / `groupAttempts` / `groupInert` | 纯函数目标态 + `[hidden]`/`折叠模式`门禁 + 收敛记账 >3→inert + **muting 记录并延迟重放**（不丢弃，`finally` + 250ms 超时保险） |
| W1-6 焦点处置 | `driveGroups` 只驱动**收起**方向 | 采 §5.6 **首选方案**：放弃自动 click（`focus()` 副作用不可回滚） |
| W1-7 A1 时序 + G1 | `coveredGroupsOf`（排除最后组 + 必须非 outerHidden）/ `bindGroupGesture`（`isTrusted === true`）/ `userOwnedGroups` | 用户接管后插件永不驱动该组；组重挂 → WeakSet 自然失效 |
| W1-8 跨组聚合 | 组为不透明容器后天然成立 | 组与 `model-retry` 同处段内，段级 chip 聚合整段 |
| W1-9 移除 `keepLastRows` | `settings.ts` 删 UI 入口；`fold.ts` `keepRow=()=>false` / `keepRows=KEEP_NONE`；常量与 roster 字段保留 | 见下方**降级声明** |
| W1-10 verbose 不介入 | `nativePassiveTurns`（`aria-expanded==='true' && disabled`）/ `nativePassiveSegments` | 段级跳过：不建 chip、不恢复/隐藏任何行 |
| W1-11 `reasoning`/`response` part 感知 | `groupPartOf` / `isReasoningPart`，接入 `hasBodyContent` 与 `buildSegments` 的 bodySteps | 真机 reasoning 53 个（body 0 个）、response 45 个（body 45 个） |
| W1-12 `thinkSummary` 复用 `[data-disclosure-row]` | `thinkSummary` 改为优先 `toolSummary()` | `data-follow-end` 已移除（保留为旧版兜底） |
| W1-13 `replaceTurnStatus` 重构 | `STATUS_MARK` 属性 + `isTurnProcessAnnouncement` 结构门禁 + 内容门禁 + 同节点标记 + 幂等 | 中文界面生效；英文含 "Deep diving" 不再逐 pass 累加 |
| W1-14 observer `attributeFilter` | 补 `hidden` / `data-group-expanded-mode` / `data-chat-group-part` | 官方折叠只改 `hidden` 属性（不是 `display:none`） |
| W1-15 指标 | 读 `data-turn-process-messages`/ `-tool-calls`/ `-subagents`（`readNativeTurnCounts`）+ **duration 去重** | 原生 label 已给时长与类别；插件补 token/缓存/TTFT/tok·s/上下文增量 |
| W1-16 `click()` 适用条件守卫 | `toggleExpandAll` 内 `if (button.hasAttribute('disabled')) continue` | `disabled` = `!canCollapse`（CHAT:6185） |
| W1-17 清除老会话遗留 `style.display` | `cleanupLegacyResidue` + `pluginDirtyNodes` | 只动「已登记」或「原生受保护且 `display` 为 none/空」；**绝不碰** React 自己的 `display: contents` |
| W1-18 rebuild + d.ts | `npm run build` 全绿（`node --check` 守卫） | — |
| W2 方案 C | `src/turn-metrics.ts` 的 `shadowInjectFace` + register `inject` 转发 | 删除 `canShadowBuiltin`/`withBuiltinInject`/`standardHookPropName`，恢复指标渲染 |

> **W2 的一处关键修正（与规格书 §7 的伪代码不同）**：规格书写「source 必须是函数，
> 否则挡掉」。实现者核实源码后发现 **presentation source 的真实形状是 observable 对象
> `{getSnapshot, subscribe}`**（CHAT:12271 → CHAT:12049-12054），**不是函数**。
> 若照字面写 `typeof source === 'function'`，0.1.7 真机上会被判非法而**静默丢弃**。
> 因此守卫放宽为「对象（非 null）或函数」，仍显式挡掉 `undefined`（`observableHook`
> 会在 `WeakMap.set(undefined, …)` 抛 TypeError，且是**绑定期**就崩；
> 对照 `materializeStandardBinding`(renderer:646-657) **有**守卫，说明 entry 级 inject 面
> 缺守卫，不是框架惯例）。详见 `test/shadow-inject.test.mjs` 场景 C。

### 3.0.1 ⚠️ 降级声明（必须写进用户可见文档）

`keepLastRows`（设置卡片「进行中保留行数」）**已按规格书 §5.8 移除**（软降级）：
**用户可见层面彻底消失**（设置卡片不再有该项、不再生效），但保留
`DEFAULT_KEEP_LAST_ROWS` 常量与 roster 字段的读兼容（不破坏测试 `scopeMock` 与远程配置契约）。

**移除后「进行中最新 N 行保持可见」这一能力消失。**
原生组滚动窗口（`.O_Ebla_body{max-height:min(400px,50vh);overflow-y:auto}`）
**只能**替代「展开后防 70+ 行淹没」，**不能**替代「最新 N 行不被折叠」——六处差异：

1. 组**收起时根本没有滚动窗口**；
2. 保留对象不同（行 vs 滚动位置）；
3. 量纲不可互译（行数 vs 400px/50vh）；
4. 保留行在 chip **外** vs 在被折叠组**内**；
5. **跨组**尾 N vs **每组独立** scrollport（CHAT:2073）；
6. 折叠模式下 `follow.reset()`（CHAT:2082/:2099）。

### 3.0.2 如实记录的剩余风险（非本轮引入）

插件**一级行** `.dshcf-processed` 仍是外层 `div[data-chat-flow]`（= `elements.column`）
的直接子级，因此仍在官方 `readVisibleTurn`（CHAT:4589 `elements.column.children`）的
二分序列里。评估：它**无** `data-chat-turn`（`Number(null)=NaN` → 只推进 `low`、不改
`reading`），且 `rect.top` 随 DOM 序单调 → **不改变**读到的回合值。
`test/fold-017-safety.test.mjs` 的 E3/E4 显式钉住该前提（无 `data-chat-turn`、无
`data-chat-anchor-key`），未来若有人给它加属性会立刻失败。

---

## 4. 原「未完成」项的存档（**已全部落地**，保留供追溯）

### 3.1 折叠未适配原生 data-step-process 分层（**已修复**）

0.1.7 把"折叠工具卡"这件事**部分收进了官方实现**，插件面对的是两层原生折叠：

- **回合级** data-turn-process：button[data-turn-process="N"][data-turn-process-messages]
  [data-turn-process-tool-calls][data-turn-process-subagents][data-open][aria-expanded]，
  文案形如 深度求索中，用时28分2秒 / 用时 9分31秒；
- **工具组级** data-step-process：每个连续工具组一个，**默认折叠**。

> **存档注（修复前状态）**：当时插件在该 DOM 上产出为 0（chips=0、data-dshcf-turn=0），
> 但也不报错——FoldController 起来了、findBlocks 却收集不到可折叠块。
> **根因已由本轮定位并修复**：不是"收集不到"，而是组根被当成了 `block.host`
> （`callRowsIn` 是后代查询，会透过组根命中组内工具行）——详见规格书 §3.1 与
> `DOM_SNAPSHOT_0.1.7.md` §3 的真机证据。下面三条需求的处理方式：

1. 判定 data-step-process 组是否应被视为"已被原生折叠"而礼让（与现有 turn-process
   协同逻辑同思路），只在原生未覆盖处自建 chip；
2. data-step-process-body 用 hidden="until-found" 隐藏，插件内所有"可见性/高度"判定
   必须按此属性语义调整（offsetHeight === 0 不代表"无内容"）；
3. data-follow-end 已移除 → thinkSummary() 的实时摘要锚点失效（新 DOM 有
   [data-disclosure-row] 内 span.*_summaryText 可用，可直接复用 toolSummary() 的路径）；
   thinkRowRunning() 依赖的 [data-follow-end] 兜底同理（新 DOM 里 think 行**始终**
   带 data-state，兜底已无必要）。

### 3.2 指标 shadow 渲染器（**方案 C 已实施**，零新依赖、已核对源码）

- ~~**方案 A**：external `@deepseek-ai/dsh-client-ui-renderer` 后 require 它的 `observableHook`~~
  —— **已证伪**：该包只导出 `SlotRegistry/apply/inject`（`package.json` exports 只有
  `.` / `./invariant` / `./client`），`observableHook`/`bindSnapshotSelector` 是 bundle 内部函数
  **不导出**；只有 `standardHookPropName` 在 `dsh-client-ui-slots` 里导出。
- **方案 C（推荐）**：**给 shadow 自己的 register options 声明 `inject`**，把内置的 hook source
  原样转发出去，让框架自己去包装：

  ```js
  slotsService.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    priority,
    locale,
    inject: () => {
      const inner = builtinAssistantInject        // 内置 entry 的 inject 工厂
      if (inner === undefined) return {}
      const face = inner() ?? {}
      const src = face.hooks?.presentation
      // entry 级 inject 面**没有** undefined 守卫（见 §5）：传 undefined 会让
      // observableHook 在 WeakMap.set 处抛 TypeError，所以必须显式挡掉。
      return src === undefined ? {} : { hooks: { presentation: src } }
    },
  }, TurnMetricsNodeView)
  ```

  框架的 `bindInjectSources(face)` 会对 `face.hooks` 里每个 source 调 `observableHook(source)`，
  再用 `standardHookPropName` 挂成一级 prop——于是**我们自己的 props 里就有 `usePresentation`**，
  直接 `{...props}` 委托内置即可，`withBuiltinInject()` 那套手工转换与
  `canShadowBuiltin()` 的"不注册"降级都可以去掉。
- **方案 B（备选）**：不再 shadow `assistant-step`，改从 `conversation.chat.turnTail`
  （**session 作用域 list slot**）拿快照。已确认该 seat 的标准 props 含
  `useSession/useChat/useConversation/useInput`，但**不含** `useChatNode/useChatNodeProcess`
  （那是 chat entry 的 keyedHooks），指标需自己经 `useChat((s) => s.nodes)` 取。

---

## 4b. 真机 DOM 事实（0.1.7-rc.2，已实测，勿重新逆向）

> 完整快照见 **[DOM_SNAPSHOT_0.1.7.md](DOM_SNAPSHOT_0.1.7.md)**（含与规格书 §4.4 的一致性核对）。

以下均在真实的进行中/已完成会话上抓取。

### 4.1 会话层

    div.EvIC1a_column [data-chat-flow]
      div.EvIC1a_flowItem [data-chat-flow-kind="user"]
      div.EvIC1a_flowItem [data-chat-flow-kind="turn-process"]        ← 每回合一行
      div.O_Ebla_root [data-step-process="true"] [data-chat-group-key] [data-chat-turn]  ← 工具组（原生折叠）
      div.EvIC1a_flowItem [data-chat-flow-kind="assistant-step"] [data-chat-group-part="response"] [data-turn-process-member]
      div.EvIC1a_flowItem [data-chat-flow-kind="model-retry"] [data-turn-process-member]   ← 新 kind
      div.EvIC1a_flowItem [data-chat-flow-kind="turn-tail"]            ← 仍存在

- **data-chat-flow-kind 取值全集**（chatNode 产生的 kind + 其它包注册的 key）：

      assistant-step  command  compaction  context  manual-compaction  model-retry
      system-prompt   tool-call  turn-error  turn-max-tokens  turn-process  turn-tail
      unknown  user  steering  turn-trigger        ← 以上来自 dsh-client-ui-chat
      command-input                                  ← dsh-client-ui-goal
      workflow-run                                   ← dsh-client-ui-workflow-run

  其中 **fold.ts 直接依赖**的有：`STATUS_ROW_KINDS = {model-retry, turn-error, turn-max-tokens}`
  （状态装饰行判定）、`steering`（段边界）、`user`/`turn-tail`（段起止）。
  旧版还有别名 `turn-tail-timing`，`fold.ts` 需继续兼容。
- EvIC1a_root 带 data-chat-following-tail（跟随滚动锚点，**与旧 data-follow-end 无关**）。
- flowItem 上还会出现：`data-chat-flow-key` / `data-chat-node-key`（稳定 key）、
  `data-chat-paging-anchor`、`data-chat-group-part`、`data-turn-process-member`、
  `data-turn-process-hidden`、`data-turn-process-inline`、`data-turn-process-answer`。
- step-process 组上还有 `data-group-expanded-mode`。

### 4.2 原生工具组（step-process）

    div.O_Ebla_root [data-step-process="true"]
      div
        button.O_Ebla_title [data-process-activity="code"]        ← aria-expanded="false"（默认折叠）
          span.O_Ebla_leading
            span.O_Ebla_activityIcon [data-step-process-icon="true"]
            span.O_Ebla_chevron      [data-step-process-chevron="true"]
          span.O_Ebla_label  "运行了代码并执行了命令"               ← 本地化活动文案
      div.O_Ebla_body [data-step-process-body="true"]              ← hidden="until-found"，offsetHeight 0
        div.O_Ebla_content [data-step-process-content="true"] [data-chat-flow]
          div.EvIC1a_flowItem [data-chat-flow-kind="tool-call"] ...

- data-process-activity **全集**（chat 的 PROCESS_ICONS，14 个）：
  thinking / read / readImage / search / edit / write / commands / code / webSearch /
  webFetch / subagents / plan / questions / tools —— 决定行上图标；
- 文案是运行期本地化的（"已调用工具，运行了代码，执行了命令"），**不要按文案做判定**。

### 4.3 原生回合行（turn-process）

    div.EvIC1a_flowItem [data-chat-flow-kind="turn-process"]
      div [data-slot="conversation.chat.node"]
        span.TTCZqG_visuallyHidden "深度求索中"
        button.l_V-RG_root [data-open="true"] [data-turn-process="1"]
          [data-turn-process-messages="74"] [data-turn-process-tool-calls="142"] [data-turn-process-subagents="0"]
          span.l_V-RG_label "深度求索中，用时28分2秒"

- 已完成回合：data-open 缺省、aria-expanded="false"（折叠）；
- 文案含**时长**，但**不含 token 指标**——所以指标仍有插件自己的价值。

### 4.4 turn-tail（指标宿主，仍可用）

    div.TS9iAW_root [data-turn-tail="1"]
      div [data-slot="conversation.chat.turnTail"]

- **每个已闭合回合一个**；进行中的回合还没有（实测进行中会话 data-turn-tail 计数为 0，
  已完成后为 3）。所以"抓不到 data-turn-tail"通常只是回合未闭合，不是契约变更。

### 4.5 Think / 工具行

    div.lcKema_root [data-variant="think"] [data-state="ok"] [data-preview="true"]
      div
        div.lcKema_row [data-disclosure-row="true"] [data-expandable="true"]
          span.lcKema_leading (icon + chevron svg)
          span.lcKema_title "思考"
          span.lcKema_separator
          span.lcKema_summary > span.lcKema_summaryText "Let me start by ..."

    div.o3BgMG_root [data-variant="code"] [data-tool="run_code"] [data-state="ok"]
      div
        div.o3BgMG_row [data-disclosure-row="true"] [data-expandable="true"]
          ... span.o3BgMG_summary > span "List project root contents"

- **data-follow-end 已完全移除**（全文档计数 0）；think 行现在**始终**带 data-state
  （chat bundle 里是 "data-state": running ? "running" : "ok"）；
- think 行的结构与工具行**已同形**（都是 [data-disclosure-row] + leading/title/separator/summary），
  因此 toolSummary() 的取法可直接复用到 think；
- 新增 data-expandable="true"、data-preview、data-streaming。

### 4.6 data-state 取值（**曾误判，已按源码修正**）

以真实源码为准，不要只看页面上的取值统计：

- **工具行**（dsh-client-ui-tool 的 ToolRow）：

      const state = !done
        ? (block.phase === "preparing" ? "preparing" : "running")
        : (block.error?.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok");
      const running = state === "running" || state === "preparing";   // 官方口径

  合法取值 **preparing / running / stopped / error / ok**。**preparing 属于运行中**。
- **think 行**（dsh-client-ui-chat）：`"data-state": running ? "running" : "ok"` → **running / ok**。
- **ongoing**：**DSH 核心自己在用**——`dsh-client-ui-primitives/lib/index.js` 里出现 7 次，
  `dsh-client-ui-plugin-manager` 也发 ongoing/failed/off。我早先只在 dsh-client-ui-tool / -chat
  两个包里 grep 到 0 就断言"来自第三方"——**检索范围太窄，结论错**。它确实出现在 DSH 自己的
  UI 上，只是不在 tool/think **行**上。
- **idle**：`dsh-client-ui-open-in-app` 发 busy/idle；chat 里 `lcKema_iconIdle` 是 CSS class 名。
  同样不是 tool/think 行的 data-state。
- **chat 的 `data-variant="others"`（GenericCommandCard）**也有 `stateOf` 产出 running/error/ok——
  所以"chat 只会产出 running/ok"只对 **think 行**成立，别推广到整个 chat。
- 另注意 data-state 在 DSH 里也被用在**非行元素**上（svg 图标、`[data-state=running]` 样式钩子），
  按 data-state 选行时必须同时限定"是 tool/think 行"。

> **修正记录（两轮）**：
> 1. 最早写过"ongoing / idle / preparing 都来自第三方插件，不要改 rowState"——**preparing 是错的**，
>    它是工具行的准备阶段；插件原先只认 `'running'` 会把准备阶段的行误判成已完成
>    （实测症状：chip 标题退成「已思考1 段思考」而不是「正在运行」）。已用 `isRunningState()`
>    在 `fold.ts` 修正，`test/fold-preparing.test.mjs` 锁定（去掉修复即 FAIL）。
> 2. fact-check 又发现 **ongoing 也是 DSH 核心在用**，"来自第三方"同样不成立。
>    **教训与规则**：不要靠"某取值来自第三方"来豁免它，一律按"该取值会不会出现在 tool/think 行上"
>    判断。tool 行必须显式认 `preparing`；对未知态采取保守策略（当成"进行中"而非"已完成"）
>    比反过来安全——误判成已完成会把行折叠/计数错。

---

## 5. 关键机制备忘（省一次逆向）

- **客户端 ctx 守卫**：ctx.<service> 未在静态 inject 声明时抛
  cannot get property "X" without inject；ctx.get(name) 是官方可选服务入口。
  ctx.inject([name], cb) 的回调里子 ctx 已声明该 inject，可安全属性访问。
- **槽位 entry 形状**（StoredEntry）：component, options{key,id,order,label,priority},
  select?, inject?, children?, store?, locale?, registrant?。其中 inject 是**注册方声明的
  工厂**（实测 inject() 返回 { hooks: ... }）。
- **hooks 隔间物化**：standardHookPropName(name) = "use" + Name[0].toUpperCase() + Name.slice(1)；
  值经 observableHook(source) = bindSnapshotSelector(source) 包装。
  ⚠️ **两条路径的 undefined 行为不同**：
  - **标准绑定**（materializeStandardBinding，slot 级声明）：source 为 undefined 且非 optional 时抛 SlotAssemblyError；
  - **entry 级 inject 面**（bindInjectSources，注册时 `inject: () => ({hooks})`）：**没有** undefined 守卫，
    `observableHook(undefined)` 会在 `WeakMap.set(undefined)` 处抛 TypeError。
  所以走 §3.2 方案 C 时必须在 inject 工厂里显式挡掉 undefined source。
- **plugins.item**：list slot；label 为卡片标题（SlotLabel = string | (() => string)），
  locale 可直接省略；owner props {view:'summary'|'page', form?}。summary 渲染卡片一行说明，
  page 渲染配置表单本体（外层卡片 chrome 由插件页提供）。官方推荐用
  ctx.configForms.whileServed([NS], ...) 门禁，避免宿主没服务该命名空间时出现"点开即空白"的卡片。
- **SettingsForms.schema(entry)** 读的是 entry.fiber.runtime.Config，且要求有 toJSON
  ——所以必须导出真实 schema，纯 interface 会被 esbuild 擦除。
- **volatileForm(schema)**：object schema 只保留 volatile 子字段；一个都没有则返回
  undefined，该 entry **根本不进** describe()。

---

## 6. 隔离验证环境（不要用主 profile）

DSH 对加载失败的插件没有降级，任何改动都必须在隔离 profile 里先验证：

    # 从官方 web 模板建独立 profile（已建好：auto-collapse-dev）
    dsh --profile auto-collapse-dev --from-default-profile web --dump-config

    # 以 link 方式装本仓库（symlink，改完 npm run build 即生效，无需重装）
    dsh plugin --profile auto-collapse-dev add -w /Users/ch/Documents/Git/dsh-auto-collapse

    # 起独立实例（避开主实例的 3080/3081），作为受管后台任务跑
    dsh --profile auto-collapse-dev --port 3082 --no-open

验收探针（按顺序，全部要过）：

1. 启动输出里**没有** entries did not activate；
2. 浏览器里 document.querySelector('[data-dsh-boot]') 为 null（不是 "Failed to load plugins"）；
3. curl -s http://127.0.0.1:3082/dsh-auto-collapse/roster → 200，且 own:true、
   config 为 5 个**普通值**（不是 null，这直接验证 deref()）；
4. 打开一个**已完成**回合的真实会话：think/tool 行完整（data-variant="think" 计数 > 0）、
   控制台**无** usePresentation is not a function / slot entry crashed；
5. 折叠产出：document.querySelectorAll('.dshcf-chip') > 0、[data-dshcf-turn] > 0；
6. 回合指标：[data-dshcf-turn-metrics] > 0 且挂在 [data-turn-tail] 上
   —— **这是完成 §3.2（方案 C）之后的目标态**；当前降级态下指标功能关闭，
   该条以 §3.2 完成后为准；
7. 设置页：插件卡片出现在"插件"面板的**官方**分组，点开能读写 5 个字段。

> 注意：主实例（~/.dsh/profiles/web）里本 entry **保持 disabled: true**，
> 直到 §3 两项完成并过完上面 7 条。

---

## 7. 本轮新增的测试

- test/host-settings.test.mjs：用**真实 schemastery** 走 cordis 同款
  Config['~standard'].validate() 解析路径后喂给 apply，锁住 B1 回归
  （引用对象解引用 → config 不为 null）与三代 host 契约
  （installSection / register / SettingsForms）+ configure 抛错兜底。
- test/fold-preparing.test.mjs：`data-state="preparing"` 应等同运行中（DSH 官方口径），
  含 running 不回归与 ok 反向对照；已验证去掉修复即 FAIL。
- test/settings-card.test.mjs：两代 slot 注册、whileServed 门禁、
  cardSourceFromForm 的 field→path 翻译与 revision 栅栏、旧契约只读不谎报成功、
  卡片 summary/page/旧 disclosure 三种视图、原子提交与宿主拒绝时保留用户输入、
  迟绑定 scope 的优先级 / 幂等 / dispose / 形状校验 / 异常隔离。

两代 host 契约的离线单测是刻意补的——**此前 host half 零覆盖**，B1 正是从这个盲区溜过去的。

---

## 8. 验收结果（隔离实例 3082 + 真机真会话，2026-09-28）

### 8.1 自动化

| 项 | 结果 |
|---|---|
| node test/run-all.mjs | **29 个测试文件全部通过** |
| npm run typecheck | 零错误 |
| npm run build | 通过（host/client d.ts 守卫 + node --check 均 ok，lib/index.js 纯 JS） |
| 变异测试（回退关键修复看断言是否 FAIL） | 7 个关键修复**全部被杀死**；4 个存活项均为**有意的纵深守卫**（入口已先拦下、路径不可达），已在测试文件头部如实留档 |

### 8.2 隔离实例（auto-collapse-dev，端口 3082）

真机真会话 session-8ad27872（6 回合 / 97 官方组 / 208 工具行 / 53 think 行）：

| # | 验收项 | 实测 |
|---|---|---|
| 2 | [data-dsh-boot] 为 null（非 Failed to load plugins） | 通过 |
| 3 | roster 200 / own:true / config 为普通值（验证 deref） | 通过 |
| 4 | think 行 53 / 工具行 208 完整，无 usePresentation is not a function | 通过 |
| 5 | .dshcf-chip = 2（段级）、[data-dshcf-turn] = 98 | 通过 |
| 6 | [data-dshcf-turn-metrics] = 98 且 span 挂在 button[data-turn-process] 上 | 通过 |
| 7 | 设置卡片已无「进行中保留行数」（dshcf-keep-last-rows 不存在） | 通过 |
| 8 | 受保护元素（组三层 / 带 hidden）被写 display:none 的**数量为 0**；插件节点在组内**数量为 0** | 通过 |
| 9 | 组根 style.display 恒空串（**97/97**）、无 style 属性 | 通过 |
| 10 | 组内容流内无插件节点；操作作用于外层会话列 | 通过 |
| 11 | turn-process 公告（6 个）全部为 Deep sleeping...；另有 62 条 role=status（retry / turn-error / 取消）**原文未动** | 通过 |
| 13 | data-chat-group-part=reasoning 座位 53 个，未被判为正文 | 通过 |
| 14 | 段级 chip 计数与覆盖集一致（已折叠 11 / 4 个工具组） | 通过 |
| 15 | 组无内联 display | 通过 |
| 19 | 连续观测 5s，97 个组按钮的 aria-expanded **收敛不变**（无振荡） | 通过 |
| 20 | document.activeElement 不是组按钮（未抢焦点） | 通过 |
| 21 | **无任何 chip 是 div[data-chat-flow] 的直接子级**（2 个段级 chip 均挂在 turn-process 座位内）；chip 不带 data-chat-anchor-key / -paging-anchor / -flow-key / -node-key / -turn | 通过 |

> 采集方式：playwright-cli（chrome）。完整 DOM 事实见 DOM_SNAPSHOT_0.1.7.md。

### 8.3 已知非阻断项（如实记录）

1. **一级行 .dshcf-processed 仍是 column.children 成员**（既有设计，非本轮引入）。
   评估：它无 data-chat-turn（Number(null)=NaN，只推进 low、不改 reading），
   rect.top 随 DOM 序单调，故**不改变** readVisibleTurn 读到的回合值。
   测试的 E3/E4 已钉住该前提。
2. **-body / -content 两个 isNativeProtected 分支当前不可达**（组根分支先命中），
   属有意纵深；其单独失效无法被 CI 发现，已在测试文件头部留档。
3. 段级 chip 挂在 React 管理的座位内，React 重渲染该座位时会摘除它；
   插件每 pass 自愈重建（ensureSegmentChip 的 isConnected 检查），窗口期为一个 commit。
