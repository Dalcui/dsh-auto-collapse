# DSH 0.1.7 适配记录（折叠与指标尚未完成）

> 状态：**进行中**。0.1.7-rc.2 上「插件能加载、不破坏界面」的部分已完成并实测通过；
> **折叠与回合指标两项核心功能尚未适配新 DOM**，因此 ~/.dsh/profiles/web/cordis.patch.yml
> 里该 entry 仍为 disabled: true。本文记录已完成项、未完成项、真机 DOM 事实与验收标准，
> 供下一轮直接接手（无需重新逆向）。

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

## 3. 未完成

### 3.1 折叠未适配原生 data-step-process 分层（主要工作）

0.1.7 把"折叠工具卡"这件事**部分收进了官方实现**，插件面对的是两层原生折叠：

- **回合级** data-turn-process：button[data-turn-process="N"][data-turn-process-messages]
  [data-turn-process-tool-calls][data-turn-process-subagents][data-open][aria-expanded]，
  文案形如 深度求索中，用时28分2秒 / 用时 9分31秒；
- **工具组级** data-step-process：每个连续工具组一个，**默认折叠**。

插件当前在该 DOM 上**产出为 0**（实测 chips=0、data-dshcf-turn=0），但也不报错——
即 FoldController 起来了、findBlocks 却收集不到可折叠块。需要：

1. 判定 data-step-process 组是否应被视为"已被原生折叠"而礼让（与现有 turn-process
   协同逻辑同思路），只在原生未覆盖处自建 chip；
2. data-step-process-body 用 hidden="until-found" 隐藏，插件内所有"可见性/高度"判定
   必须按此属性语义调整（offsetHeight === 0 不代表"无内容"）；
3. data-follow-end 已移除 → thinkSummary() 的实时摘要锚点失效（新 DOM 有
   [data-disclosure-row] 内 span.*_summaryText 可用，可直接复用 toolSummary() 的路径）；
   thinkRowRunning() 依赖的 [data-follow-end] 兜底同理（新 DOM 里 think 行**始终**
   带 data-state，兜底已无必要）。

### 3.2 指标 shadow 渲染器（**方案 C：零新依赖，已核对源码**）

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

## 4. 真机 DOM 事实（0.1.7-rc.2，已实测，勿重新逆向）

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
