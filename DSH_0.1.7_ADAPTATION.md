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

本插件的 shadow entry（priority -1，低于内置的 0，"最低者渲染"）抢走了渲染，再手动
React.createElement(builtin, props) 委托内置——但 props 里没有 usePresentation
（实测 shadow props 含 useSession/useChat/useTurnData/useDisclosure/... 但**不含**
usePresentation），于是 ReasoningRow 抛 usePresentation is not a function，
conversation.chat.node 条目整条崩溃（实测刷出 200+ 条错误、思考行消失）。

当前做法：StoredEntry.inject 上能拿到注册方的工厂（实测 inject() 返回
{ hooks: ... }），但 source **不是函数**，说明必须经 observableHook 包装才可用；
复刻不了时 canShadowBuiltin() 返回 false，**干脆不注册 shadow**。

> 这是有意的降级：保住 DSH 原生渲染，只丢本插件的指标。**最终解**见 §3.2。

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

### 3.2 指标 shadow 渲染器（最终解二选一）

- **方案 A（推荐）**：把 @deepseek-ai/dsh-client-ui-renderer 加入构建 external，运行期
  require 它的 observableHook / standardHookPropName，用与框架相同的包装产出
  usePresentation 再委托内置渲染；
- **方案 B**：不再 shadow assistant-step，改为在 turn-tail 那一侧找可注入的 seat
  拿 useSession/useChat 快照（需先确认 0.1.7 是否提供该类 seat）。

判断方案 A 是否可行的关键事实：客户端 bundle 是自包含 iife（当前只 external react），
而槽位框架内部就是用 require("@deepseek-ai/dsh-client-ui-slots") 拿这些 helper 的——
说明模块系统能给到，只是需要在 build.mjs 里显式声明 external。

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

- data-chat-flow-kind 取值：user / turn-process / assistant-step / tool-call /
  model-retry / turn-trigger / turn-tail / context / command / manual-compaction / compaction。
- EvIC1a_root 带 data-chat-following-tail（跟随滚动锚点，**与旧 data-follow-end 无关**）。
- data-chat-paging-anchor / data-chat-group-part / data-turn-process-member 为新增/变化属性。

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

- data-process-activity 取值实测有 code / read / tools 等，决定图标；
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
- **ongoing**：在 dsh-client-ui-tool 与 dsh-client-ui-chat 里**字面量总数为 0**，
  不是 DSH 核心产出的 data-state（来自其它第三方插件的 UI）。
- **idle**：只作为 CSS class 出现（如 `lcKema_iconIdle`），不是 data-state。
- 另注意 data-state 在 DSH 里也被用在**非行元素**上（svg 图标、`[data-state=running]` 样式钩子），
  按 data-state 选行时必须同时限定"是 tool/think 行"。

> 修正记录：本文档早先写过"ongoing / idle / preparing 都来自第三方插件，不要改 rowState"——
> 其中 **preparing 是错的**。插件原先只认 `'running'`，会把准备阶段的工具行误判成已完成
> （实测症状：chip 标题退成「已思考1 段思考」而不是「正在运行」）。已用 `isRunningState()`
> 在 `fold.ts` 修正，并由 `test/fold-preparing.test.mjs` 锁定（去掉修复即 FAIL）。

---

## 5. 关键机制备忘（省一次逆向）

- **客户端 ctx 守卫**：ctx.<service> 未在静态 inject 声明时抛
  cannot get property "X" without inject；ctx.get(name) 是官方可选服务入口。
  ctx.inject([name], cb) 的回调里子 ctx 已声明该 inject，可安全属性访问。
- **槽位 entry 形状**（StoredEntry）：component, options{key,id,order,label,priority},
  select?, inject?, children?, store?, locale?, registrant?。其中 inject 是**注册方声明的
  工厂**（实测 inject() 返回 { hooks: ... }）。
- **hooks 隔间物化**：standardHookPropName(name) = "use" + Name[0].toUpperCase() + Name.slice(1)；
  值经 observableHook(source) = bindSnapshotSelector(source) 包装；source 为
  undefined 且非 optional 时框架抛 SlotAssemblyError。
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
6. 回合指标：[data-dshcf-turn-metrics] > 0 且挂在 [data-turn-tail] 上；
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
