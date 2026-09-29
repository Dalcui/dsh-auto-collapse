# dsh-auto-collapse × DSH 0.1.7 适配开发规格书
> **本文档是开发的唯一入口**。新会话读完本文即可开工，无需重新逆向 DSH。
> | 项 | 值 |
> |---|---|
> | 目标版本 | DSH **0.1.7-rc.2**（本机 `npm ls -g` 确认） |
> | 仓库 | `E:\Git\dsh-auto-collapse`，分支 `main` |
> | 基座提交 | `de45d90`（已 merge `dalcui/main`） |
> | 唯一 remote | **`dalcui`**（`origin` 已移除，勿推上游） |
> | 插件版本 | `package.json` 0.3.0 |
> | 当前状态 | 插件在 `~/.dsh/profiles/web/cordis.patch.yml` 里 **`disabled: true`** |
---

## 0. 新会话开工清单（照做即可）

```bash
# 1. 确认版本与基线
dsh --version                       # 应为 0.1.7-rc.2
cd E:\Git\dsh-auto-collapse && git log --oneline -1   # 应为 de45d90 或其后

# 2. 先修既有红测（§2.4），恢复全绿基线
node test/run-all.mjs               # 当前预期：test/host-settings.test.mjs FAIL

# 3. 读本文档 §3（根因）→ §4（官方契约）→ §5（目标形态）→ §7（改动清单）

# 4. 起隔离实例做真机验证（T0.1）
dsh --profile auto-collapse-dev --port 3082 --no-open
```

**动手顺序**：`T0.2 修红测` → `T0.1 真机快照` → `W1/W2/W3` → `T2.1 跑 21 条探针` → `T2.2 独立审查` → 恢复 enabled。

**头号注意**：本插件在 0.1.7 上会**破坏官方折叠**（§3.1 三类破坏，含「整组消失」）。
改任何折叠相关代码前，先读 §4.2 硬约束与 §4.4 挂载点结论。
---

## 1. 一句话目标

让插件在 DSH 0.1.7 上**不破坏官方折叠**的前提下恢复工作：
1. 修掉「插件把官方 `data-step-process` 组根当成自己的折叠宿主」这一根因（当前会造成 3 类破坏，见 §3）；
2. 在**官方折叠基础上**重建插件能力：跨组聚合 chip、回合指标、状态词替换；
3. 移除 `keepLastRows` 设置项（软降级）；
4. 全绿后恢复 `web` profile 的 `enabled`。
**为什么必须改**：0.1.7 客户端契约有三代不兼容变更，插件旧逻辑在真机上产生**整组消失**等可见故障（§3.1），
且宿主对加载失败的插件**没有降级**（会整页 `Failed to load plugins`）。
---

## 2. 环境与工作流（必读）

### 2.1 关键路径

```
仓库            E:\Git\dsh-auto-collapse
插件源码        src/fold.ts（4436 行，核心）、src/turn-metrics.ts、src/client.ts
                src/settings.ts、src/index.ts（host half）、src/locales.ts
测试桩          test/fake-dom.mjs  ← 可在 Node 里直跑真实 lib/client.js
DSH 客户端包    C:\Users\wkyiw\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\
                dsh-client-ui-chat / -conversation / -slots / -renderer / -tool / -primitives
# 下文所有 `CHAT:x-y` 均指 dsh-client-ui-chat\lib\client.js 的行号；`fold.ts:x` 指本仓库 src/fold.ts
```

### 2.2 构建与测试

```bash
npm run build      # src/*.ts → lib/*.js（lib/ 才是 dsh web 实际加载的产物，改完必须 build）
npm test           # node test/run-all.mjs：先 build，再跑全部 *.test.mjs + adversarial-*
npm run typecheck  # tsc --noEmit
npm run check      # typecheck + test
```
⚠️ **铁律**：`lib/index.js` 必须是**纯 JS**（任何 TS 类型注解会让 `dsh web` 启动失败）。
`build.mjs` 已加 `node --check` 守卫与 d.ts 导出面守卫，勿绕过。

### 2.3 隔离验证（**不要用主 profile**）

```bash
# 隔离实例端口 3082，避开主实例 3080/3081
dsh --profile auto-collapse-dev --port 3082 --no-open
```
> 主实例（`~/.dsh/profiles/web`）里本插件**保持 `disabled: true`**，直到 §6 全部验收通过。

### 2.4 已知的既有红测（**先修它**）

```
node test/run-all.mjs  →  test/host-settings.test.mjs  FAIL
```
**根因**：仓库本地 `@deepseek-ai/schemastery` 是 **3.18.1**（**无** `.volatile()`），
而 DSH 运行时是 **3.18.4**（有，且把 volatile 字段包成 `{ get() }` 引用对象）。
实测：3.18.1 不包裹、3.18.4 包裹 → 测试断言 `statusText 是引用对象` 在本地必然失败。
**修法（二选一）**：
- 让测试 import DSH 的 schemastery 实例（`.../dsh/node_modules/@deepseek-ai/schemastery`）；
- 或对「无 `.volatile()`」的版本**跳过**该断言（保留 3.18.4 下的完整断言）。
**注意**：这是**既存问题**，不是本次适配引入，但会让「全绿」验收基线不可用，**必须先修**。
---

## 3. 根因：为什么现在坏了

### 3.1 一个根因，三类破坏

`findBlocks`（fold.ts:3319-3475）遍历 `flowItems(flow)`（= `flow.children`，fold.ts:3017-3025）。
0.1.7 把一个回合的工具调用**包进了官方组**：
```
div[data-chat-flow]                              ← 外层会话列（CHAT:5166）
  div[data-step-process=true]                    ← 官方组根（★无 data-chat-flow-kind）
    div[data-step-process-body=true]             ← hidden="until-found"（组收起时）
      div[data-step-process-content=true][data-chat-flow]   ← 组内容流（CHAT:2376）
        div[data-chat-flow-kind="tool-call"] ...
```
组根**没有** `data-chat-flow-kind`（kind=null 跳过各分支），但 `callRowsIn` 是**后代查询**
（`el.querySelectorAll('[data-chat-call-id]')`，fold.ts:3562-3570）→ 命中组内工具行 →
`isToolPile=true`（fold.ts:3379）→ **fold.ts:3401-3404 `run = makeBlock(el)`，组根成了 `block.host`**。
由这一个根因派生三类破坏（**均已隔离桩实测复现**）：

| # | 破坏 | 触发路径 | 实测现象 |
|---|---|---|---|
| **B1** | 插件对**官方组根**写内联 `style.display` | 无原生行 | 组根 `display:none` → **整组（含官方标题）消失** |
| **B2** | chip 被 `prepend` 进**官方组容器内部** | 原生行展开 | chip 成为组根**第一个子元素**，排在官方标题按钮**之前** |
| **B3** | 插件自己把工具行写成 `display:none` 且展开后未还原 | 两条路径 | 用户点开插件一级行后**工具卡仍不可见** |
**为什么是永久性的**：组根 JSX **没有 `style` prop**（CHAT:2343-2352）→ React **永不清除**插件写的
`style.display`。对比：`button[data-turn-process]` 的 children 由 React 管理，所以插件插的指标 span 能自愈。
**违反面清单**（写代码时逐个改）：
```
fold.ts:1530   hostFade = this.hideElement(block.host, ...)          ← 写组根 display
fold.ts:1579   this.restoreElement(block.host, animate)
fold.ts:1607   this.restoreElement(block.host, hostAnimate)
fold.ts:1716   block.host.prepend(chip)                              ← 往原生组根插节点
fold.ts:1734   retainDisplayControl(block.host, desiredHidden)        ← 把组根纳入插件账本
fold.ts:1304   button.insertBefore(span, ...)                         ← 往原生 button 插 span（例外，见 §4.2）
```

### 3.2 另外三处 0.1.7 契约变更

**(1) `[data-chat-flow]` 嵌套 → 选择器双命中**
官方在 `data-step-process-content` 上**又挂了一个** `data-chat-flow`（CHAT:2376）。
`findFlow()`（fold.ts:2992-2998）取**第一个可见**的：外层恒在文档序前 → 可见时必然取外层（**不是侥幸**）；
真正的脆弱点是**外层不可见时回退 `flows[0]`**（fold.ts:2997）→ 可能选中组内容流 → 语义崩。
另：`findFlow` 是**全局**查找，**未排除 subagent 子会话面板**（`dsh-client-ui-subagent` 存在）。
官方自己的收窄写法（可直接借鉴，CHAT:4557 / 4551）：
```js
"[data-chat-flow-key]:not([data-chat-group-key]):not([data-chat-flow-kind='turn-process'])" +
  ":not(:empty):not([hidden]):not([hidden] *)"
```
**(2) `data-follow-end` 已移除**（全树 grep **0 命中**，被 `data-chat-following-tail` 取代）。
think 行现在**恒有** `data-state`，且结构与工具行**同形**：
```
div[data-variant=think][data-state] > div[data-disclosure-row=true]
  > (leading, title, separator, summary>span.*_summaryText)
```
→ `thinkSummary()`（fold.ts:3635-3642）应改为直接复用 `toolSummary()`（fold.ts:3649-3671）的 `[data-disclosure-row]` 路径。
**(3) 状态词替换在中文界面静默失效**：`replaceTurnStatus()`（fold.ts:4392-4421）匹配字面量 `"Deep diving"`，
而 0.1.7 中文 `chat.deepDiving` = **「深度求索中」**（CHAT:5352），英文才是 `"Deep diving..."`（CHAT:5541）。
**中文界面下门禁从第一步就命中不了 → 根本不发生替换**。
补充（英文界面下的**真断裂**）：当用户把 `statusText` 设成含 `Deep diving` 的值时**逐 pass 累加**
（实测 `'Deep diving custom'` → `'custom custom'` → `'custom custom custom'`…）。

### 3.3 verbose 模式：插件**介入且破坏**（待修 bug）

```
verbose ⇒ foldCompletedTurns:false（CHAT:12037）+ stepGrouping:'none'（CHAT:12038）
       ⇒ processWindowReady=false（CHAT:1688）⇒ foldable=false（CHAT:1692）
       ⇒ CHAT:6149 open = !foldable || open = TRUE
       ⇒ CHAT:6186 aria-expanded="true"  +  CHAT:6185 disabled
       ⇒ fold.ts:876 命中 nativeOpenTurns ⇒ fold.ts:1067 nativeCollapsed=false
       ⇒ 走完整二级折叠路径 ⇒ 在组根内建 chip
```
**实测**（正确取值 `aria-expanded="true"`）：`chip=1`、`chip.parentNode === 组根`。
> ⚠️ 踩坑提醒：若探针给按钮设 `aria-expanded=""`（空串）会得到 `chip=0` 的**假象**。真实值是 `"true"`。
**目标行为**：verbose 下插件**完全不介入**（原生已全展开，插件无折叠可做）。
---

## 4. 官方折叠契约（实现依据，勿再逆向）

### 4.1 三层折叠

| 层级 | 触发条件 | 隐藏机制 | 归属 |
|---|---|---|---|
| 整回合过程 | `processHidden = foldable && processMember && !processOpen`（CHAT:1709） | flowItem 上 `hidden="until-found"` | 原生 |
| 工具组 | `grouped && !open`（CHAT:2323）；`grouped = stepGrouping==='collapsed' \|\| (==='history' && turn open)`（CHAT:2299） | `data-step-process-body` 上 `hidden="until-found"` | 原生 |
| 二级行（chip） | 插件决定 | 插件写 | **插件** |
**四模式 policy**（CHAT:12013-12042）：

| `transcriptView` | 中文 | `foldCompletedTurns` | `stepGrouping` | 组折叠 |
|---|---|---|---|---|
| `compact` | 简洁 | true | `collapsed` | 是（**用户当前设置**） |
| `standard` | 标准 | true | `collapsed` | 是（代码默认） |
| `detailed` | 详细 | true | `history` | 历史是、运行中否 |
| `verbose` | 完全展开 | **false** | **none** | 否（且原生行 `aria-expanded="true"`） |

### 4.2 硬约束（**全新约束**——全源码检索 `hasAttribute('hidden')` / `[hidden]` / `data-step-process` /

`data-group-expanded-mode` / `data-chat-group-key` **各 0 命中**，即现有代码一条都没实现）
1. **凡带原生 `hidden`、或 `[data-step-process]`/`-body`/`-content` 的元素：只读不写** ——
   不写 `style.display`，不 `prepend`/`insertBefore` 任何节点；
2. **唯一显式例外**：`button[data-turn-process]` 内**追加**指标 span（fold.ts:1304）。
   它的 children 由 React 管理，重渲染会清掉 → 插在每 pass 重建，**这是既有实现与测试覆盖的行为，保留**；
3. `findFlow()` 必须排除组内容流 **+ subagent 子会话面板**；
4. **chip 门禁**用 §4.3 的正确谓词；
5. **chip 属性分两类**（**最关键，写错会破坏官方滚动**）：
   | 类别 | 属性 | 原因 |
   |---|---|---|
   | **绝不带** | `data-chat-anchor-key` | CHAT:4527 与 `capturePosition`（CHAT:4549-4557）的锚点选择键；chip 会被选中但无对应语义 → **滚动位置记忆错乱** |
   | **绝不带** | `data-chat-paging-anchor` | CHAT:4645 `beginPaging` 的选择键 |
   | **绝不带** | `data-chat-flow-key` / `data-chat-node-key` | 被 CHAT:4557 的 `[data-chat-flow-key]:not([data-chat-group-key])` 选中 |
   | **保留** | `data-dshcf-block-key` | 插件自有命名空间，官方选择器不匹配 |
   （**不再需要** `data-chat-turn` —— 见 §4.4 的挂载点修正。）

### 4.3 两个必须写对的谓词

```ts
// ❌ 错误写法（曾用过）：data-group-expanded-mode 存在 ⇔ !grouped（【非】折叠模式），与「用户展开」无关
// ✅ 正确（照抄官方口径 CHAT:2082，注意它在【否定】条件里）：
groupBodyVisible(group)     = body.closest('[hidden], [data-group-expanded-mode]') === null  // chip 门禁
groupCollapsibleMode(group) = !group.hasAttribute('data-group-expanded-mode')                // 是否处于折叠模式
```
错误谓词在 **outerHidden 历史组**场景（body 无 hidden、无该属性）**返回 true → 门禁被绕过**，
恰好触发它本该拦的「chip 谎报折叠了 N 个」问题。
**其他易错点**：
- 组**标题外层 div** 是 `hidden={!grouped}`（CHAT:2354）——**非折叠模式才隐藏标题**，别拿它判折叠；
- 折叠**不是 `display:none`**：`useSearchableHidden`（CHAT:1606-1627）有焦点保护 + `beforematch` reveal，
  被隐藏内容**真实存在于 DOM**，Ctrl+F 可命中；
- 类名是构建期哈希（`EvIC1a_` / `O_Ebla_` / `lcKema_`），**只能依赖 `data-*`**；
- `data-turn-process-member`/`-hidden`/`-answer`（flowItem 上）与 `button[data-turn-process="回合号"]` 是**两套属性**。

### 4.4 chip 挂载点（★ 已拍板：短期方案）

**背景**：官方 `readVisibleTurn`（CHAT:4582-4605）对 `elements.column.children`（**外层 `[data-chat-flow]`**，CHAT:5164-5166）做**二分**：
```js
const rows = elements.column.children;
while (low < high) {
  const row = rows[middle];
  if (row.getBoundingClientRect().top > line) high = middle;    // ← 依赖 rect.top 单调
  else { const turn = Number(row.getAttribute("data-chat-turn"));
         if (Number.isSafeInteger(turn)) reading = turn; low = middle + 1; }
}
```
插件节点若成为 `column.children` 成员：**值**上无 `data-chat-turn`（`Number(null)=NaN`）；
**几何**上 chip 收起时 `display:none` → `rect.top=0` → **破坏单调** → 可能返回**错误回合**
（TurnNavigator 高亮 / 自动滚动全偏）。
**实测三条 chip 挂载路径**（我逐条验证过）：

| 路径 | chip 父节点 | 是 `column.children`？ | 影响 |
|---|---|---|---|
| `mount='inside'`（多数场景） | 组根 / flowItem | ❌ 否 | 不影响 |
| `mount='before'` + seat 自带 `data-chat-call-id` | flowItem | ❌ 否 | 不影响 |
| **`mount='before'` + context 注入块** | **`div[data-chat-flow]`** | ✅ **是** | **影响** ★ |
→ **唯一触发路径 = context 注入块走 flow 级挂载**（fold.ts:3416，`isContext` 时 `mount='before'`）。
**★ 已定方案（用户拍板 (a) 短期方案）**：
**把 context 注入块的 chip 也改为 `mount='inside'`**，使**所有 chip 都不落在 `column.children`**。
**但有一个实现陷阱必须解决**：context 块的 `host` **自身就是被折叠的 row**
（fold.ts:3415 `run.rows.push(el)`，host 在 rows 里）——若简单把 chip 放进 host 内部，
host 被 `display:none` 时 **chip 会一起消失**（实测确认：`ctx1/ctx2` display 均为 `none`）。
**正确做法**：为 context 块引入**独立的 chip 容器**（一个插件自建的 `div`），把它作为
`column.children` 的**兄弟**、但**不占用二分序列**——即该容器必须 `position:absolute`（脱离文档流），
或改为挂在 **context flowItem 内部、且不随 host 隐藏**的位置（需要一个不被 `hideElement` 命中的子节点）。
⚠️ **开工第一步就要把这条落地方式定下来并写测试**（两个候选的取舍见 §5 W1-1 的说明）。
---

## 5. 目标形态

### 5.1 职责划分

| 层级 | 归属 | 插件职责 |
|---|---|---|
| 整回合过程隐藏 | 原生 | **完全礼让**：不写任何 `style` 到带 `hidden` 的原生节点；只把指标写进原生行 |
| 工具组折叠 | 原生 | **不碰组根**；组作为不透明容器 |
| 二级折叠 chip | 插件 | chip 覆盖**除最后一组外**的全部内容；最后一组恒展开 |
| 一级折叠（「已处理」行） | 插件（极窄） | ⚠️ `aborted`/`error` 时 `turnProcessAlwaysOpen` 返回 true（CHAT:1558-1563）⇒ 原生行恒展开但**仍由原生管理**，插件**不建**自建行。自建行只剩「老会话 / 无 turn-process 节点」 |
| 回合指标 | 插件 | 挂 `button[data-turn-process]`（主）；自建行（回退） |

### 5.2 原生能替代多少插件能力（决策依据）

**能替代**：折叠成一行 ✅（组标题 + `processTitle` 本地化文案，CHAT:1820-1836）；
折叠态显示进行中工作 ✅（但**不含**具体命令/路径）；「展开后防 70+ 行淹没」✅
（`.O_Ebla_body{max-height:min(400px,50vh);overflow-y:auto}`，CHAT:2160 + 自动跟随 + fade 遮罩）；逐个展开 ✅。
**不能替代、必须插件补**：

| 能力 | 原生为何不够 |
|---|---|
| **跨组聚合** | 原生无跨组概念。`INDEPENDENT` 集含 `model-retry`（CHAT:10565-10573），rebuild 命中即 `flush(true)`（CHAT:10718-10723）→ **每遇一条重试行就切断当前组**。实测「组→retry→组→retry→组」= **官方组数 3**（确实碎片化）。插件当前能合并成 1 个 chip（`Read ×6 · 2 次重试`） |
| **回合指标** | 原生行只有时长（CHAT:6169）与类别（CHAT:1820-1836），**完全无** token/缓存/TTFT/tok·s/上下文增量 |
| **状态词替换** | 原生文案 i18n 固定，且当前中文界面已失效（§3.2） |
| 三级合并思考行 | 原生无此概念 |
> 「最新几条不折叠」的等价性：原生滚动窗口**不能**完全替代（六处差异：① 组**收起时根本没有滚动窗口**；
> ② 保留对象不同（行 vs 滚动位置）；③ 量纲不可互译（行数 vs 400px/50vh）；④ 保留行在 chip 外 vs 在被折叠组内；
> ⑤ **跨组**尾 N vs **每组独立** scrollport，CHAT:2073；⑥ 折叠模式下 `follow.reset()`，CHAT:2082/:2099）。

### 5.3 【决策 A1】chip 的覆盖范围与时序

**chip 覆盖「除最后一组外」的全部内容，最后一组恒展开。**两条必需限定（否则会与「自动展开最后一组」**对同一组下相反目标 → 振荡**）：
1. 覆盖集必须**显式排除「最后组」**；
2. 「最后组」必须限定为 **非 `outerHidden`** 的组（否则被 CHAT:2313-2319 的 effect 反冲 → 死循环，见 §5.4）。
**每 pass 流程**：
```
1. 收集本段的官方组（按 DOM 顺序）
2. 最后组 = 最后一个「非 outerHidden」的组  → 目标态「展开」
3. 其余组                                → 目标态「收起」，由 chip 代表
4. 有组被收起 → 在【第一个被收起的组之前】建/更新 chip（挂载点见 §4.4）
```

### 5.4 【核心机制】用原生按钮驱动折叠（不再写 `display`）

**chip 的开合 = 驱动被覆盖组的原生标题按钮**：
```js
chip 收起 → 对覆盖到的每个组：确保 button[data-process-activity].aria-expanded === 'false'
chip 展开 → 对覆盖到的每个组：确保 aria-expanded === 'true'
驱动方式：读 aria-expanded → 不等于目标才 button.click()（幂等，§5.6 有完整防护）
```
**依据**：组标题是 `button[data-process-activity]`（CHAT:2257-2266），`aria-expanded` 可读（CHAT:2260）、
`onClick` 可驱动（CHAT:2263-2266）。**两处限定**：
- 该按钮的父层是 `hidden={!grouped}`（CHAT:2354）→ `grouped=false` 时按钮**不可见、`offsetParent=null`**；
- `data-process-activity` 的值（`read`/`code`/…）**逐帧变**（CHAT:2247-2256）→ **只能按属性存在性选择，绝不能用值做标识**。
⚠️ **`click()` 的适用条件**（**不要**把它推广到 turn-process 行）：
turn-process 行是**受控**的 —— `CHAT:1679 processOpen = alwaysOpen || processEntry`，
`CHAT:1681 setOpen` 在 `alwaysOpen` 时是 **no-op**，按钮 `CHAT:6185 disabled`。
→ 对 **running / aborted / error** 回合，对原生行的 `click()` **完全无效**。只有 `!alwaysOpen && canCollapse` 时才可驱动。

### 5.5 【P0】click() 驱动的振荡/死循环防护四件套（**缺一不可**）

三条真实的互相触发路径：

| # | 路径 | 说明 |
|---|---|---|
| **c1** | **三值振荡** | 目标态若由 DOM 反推（chip 收起要 false、自动展开要 true 作用于同一组）→ A→B→A 永不收敛，每 rAF 一次 |
| **c2** | **真死循环** 🔴 | `CHAT:2313-2319` 的 `useEffect` 在 `outerHidden` 时 `setOpen(false)`；`CHAT:2305` **已闭合历史回合 `outerHidden` 恒 true** → click 展开 → effect 收起 → mutation → pass → 又 click，**永不收敛** |
| **c3** | **二次自激** | `toggle`→`initialize`（CHAT:2328）+ `useProcessScroll` 主动 `scrollTo`（CHAT:2082-2094）→ **异步** scroll 事件 → `onScroll→sync→setEdges` → 再重渲染 → 再 mutation |
**防护四件套**：
1. **纯函数目标态**：目标态必须是 `f(chipExpanded, groupKey)` 的**纯函数**，**禁止**从组自身的 `aria-expanded` 反推；
2. **门禁优先**：click 前先判 `group.closest('[hidden]') === null`（不满足则跳过）；
3. **收敛记账**：写后回读，同一组累计 `attempts > 3` 仍未达目标 → 标记 **inert**、永不再驱动；
4. **muting（★ 必须按下面的写法，否则插件假死）**：
   ❌ ~~click 期间置 `muting=true`，observer 回调直接丢弃~~ ——
   `fold.ts:667-687` 只有**一个** body 级 observer（`characterData:true` + `attributeFilter` 含 `aria-expanded`），
   它是流式正文更新、用户操作、React 重渲染的**唯一**变更来源；整批丢弃会**丢掉同批次里的真实变化**，
   且若异常未清 muting 则插件**永久失聪**。
   ✅ **正确做法：记录并延迟重放**：
   ```js
   置 muting → 执行 click → 期间的 records 存入暂存队列（【不丢弃】）
   → finally 清 muting（含超时保险）
   → 对队列跑 shouldSchedule 二次判定（fold.ts:707-716），只补一次 schedule
   ```
   绝不做无条件 `return` 丢弃；必须 `try/finally` 保证清除。
⚠️ **如实声明**：muting 是**同步窗口**，**盖不住 c3 的异步 scroll mutation**
（scroll 经 `events.onScroll → sync` 异步到达，CHAT:2107）→ **c3 只能靠第 3 条收敛记账事后兜底**。

### 5.6 【P0】click() 的焦点副作用（**首选放弃自动 click**）

`CHAT:2263-2266 onClick = event.currentTarget.focus() + toggle()` → **pass 内自动 click 会常态化抢走用户焦点**。
⚠️ **`focus()` 的副作用不可回滚**（如实声明）：
- 会派发 **blur（旧元素）+ focus（新元素）事件**，下游监听器**已经执行**，无法回滚；
- 会**把元素滚动到可视区**，该滚动无法回滚；
- 用户正聚焦输入框时，blur 会**打断 IME 组合输入**；
- **恢复 `activeElement` 本身又产生第二次 focus + 滚动** → 不是零和回滚，而是**双倍抖动**。
**首选方案**：**放弃自动 click** ——「自动展开最后一组」降级为**不自动驱动**，由用户点击展开
（这是唯一真正零副作用的方案）。
**若坚持自动驱动**：focus 前记录 `scrollTop`、恢复 `activeElement` 后回写 `scrollTop`，
并对 `input`/`textarea`/`contenteditable` 目标**直接跳过该 pass**（沿用 fold.ts:641-643 的同款守卫口径）。
> ❌ 不要引用 `fold.ts:2684` 作为「保存/恢复 activeElement 的先例」——该处只是**只读** `activeElement`，
> 全 `src/` 下 `.focus(` **0 命中**，不存在先例。

### 5.7 【配套 A1】G1：用户手势接管

**问题**：「最后组恒展开」是插件的强制意图，会**覆盖用户手动收起**（用户点收起 → 插件下一 pass 又展开 → 关不掉）。
**规则**：
1. 监听组标题按钮的 `click`，**只有 `event.isTrusted === true`**（真实用户手势）才计入
   —— 插件合成 `click()` 是 `isTrusted === false`，天然可区分（插件已有同款口径：fold.ts:1282）；
2. 被用户操作过的组记入 `WeakSet<HTMLElement>`，此后**插件永不驱动该组**；
3. **解除**：组元素被 React 重挂（新元素 → WeakSet 自然失效）→ 新一轮可重新接管；
4. **与四件套的关系**：G1 只解决「用户意图 vs 插件强制」，**不覆盖 c2**（那是 React 自己的 effect）——
   两者**必须并存**，不可相互替代。

### 5.8 【决策 B-移除】移除 `keepLastRows`（**软降级**）

**口径（已定稿，无歧义）**：**用户可见层面彻底移除**（设置卡片不再有该项、不再生效），
但**保留 `DEFAULT_KEEP_LAST_ROWS` 常量与 roster 字段的读兼容**（仅为不破坏测试的 `scopeMock` 与远程配置契约）。
⚠️ **必须写进 README/`behavior-spec.md` 的降级声明**：
移除后**「进行中最新 N 行保持可见」这一能力消失**。原生组滚动窗口**只能**替代
「展开后防 70+ 行淹没」，**不能**替代「最新 N 行不被折叠」（原因见 §5.2 的六处差异）。
**影响面（已实测清点，**比预想大得多，务必按此排期**）**：
```
src/  6 个文件:
  src/index.ts          12 处  schema 字段、deref、sanitizeConfig、Config 导出
  src/settings.ts       14 处  keepLastRowsProvider、diffScope 比较项(:120)、卡片读写(:423-541)
  src/fold.ts           15 处  provider 字段/构造参数、keepTrailing(:1050-1055)、
                               reconcileBlock 的 2 个参数(:1480-1481)、keepRow(:1559)
  src/client.ts          2 处  构造 FoldController 传参(:337) 与 import(:22)
  src/locales.ts         1 处  export const DEFAULT_KEEP_LAST_ROWS = 3
  src/roster-constants.ts 2 处 roster 载荷字段与白名单校验
test/ 18 个文件、约 60 处:
  fold-keep-last-rows.test.mjs 11   ← 专门测此项
  remote-config.test.mjs       14   ← 远程配置契约含该字段
  host-settings.test.mjs        8   ← 与 §2.4 红测同一文件
  settings-card.test.mjs        4
  fold-retry / fold-native-compact 等 14 个文件  各 1-4（多为 boot 的 scopeMock 字段）
```
**降风险实现方式（务必按此做，否则 18 个测试文件全要改）**：
1. **保留** `DEFAULT_KEEP_LAST_ROWS` 与 roster 字段（继续读、继续透传，只是**不再有 UI 入口、不再生效**）
   → 18 个测试的 `scopeMock` 字段与 roster 断言**多数无需改动**；
2. `fold.ts` 侧把 `keepTrailing` / `keepRow` 改为**恒空**（`keepRows = KEEP_NONE`、`keepRow = () => false`），
   **不删** `reconcileBlock` 的参数（签名不变 → 改动面最小）；
3. `settings.ts` 只删**设置卡片的那一行**（UI 入口）；
4. **`lib/types/*.d.ts`（手工维护）与 README/`behavior-spec.md` 同步说明该项已移除**；
5. **改完必须 `npm run build`**（`lib/` 才是 dsh web 实际加载的产物）。

### 5.9 【决策 C1】指标去重

**已核实的事实**：`data-turn-process-tool-calls` / `-messages` / `-subagents`（CHAT:6182-6184）
**全 DSH 树各 1 命中（就是设置处本身），无任何消费者、不在 UI 显示**；
原生可见文案只有时长（CHAT:6169）与类别（CHAT:1820-1836），**均不含计数**。
→ **不存在「与原生重复显示」的风险**（我此前的判断有误）。真正的取舍是：
1. **补** token / 缓存命中 / TTFT / tok·s / 上下文增量（原生完全没有）✅；
2. **保留**插件现有的工具/消息/子代理计数（原生不显示，**不是冗余**）；
3. 真正要避免的是**自建一级行与原生行在同一次 pass 双写**
   （`syncNativeDisclosure` fold.ts:1269-1308 与 `placeProcessedRow` fold.ts:1310-1343 的互斥）；
4. **额外收益**：插件可直接**读**这三个属性拿权威计数，**无需自己数 DOM**（可简化 `deriveBlockInfo`）。

### 5.10 【P0】verbose 下不介入（修 §3.3 的 bug）

**目标**：verbose 模式下插件**完全不介入**（原生已全展开，插件无折叠可做）。
**判定依据**（不要用 settings 快照，用 DOM 实况）：
```
原生行 button[data-turn-process] 满足「aria-expanded === 'true' 且 disabled」⇒ 原生不可折叠 ⇒ 插件不介入
（对应 CHAT:6185 disabled = !canCollapse，CHAT:6186 aria-expanded = hasContent ? open : undefined）
```
---

## 6. 验收标准（隔离 profile，**逐条必过**）

### 6.1 基础 7 条

1. 启动输出**无** `entries did not activate`；
2. `document.querySelector('[data-dsh-boot]')` 为 **null**（不是 Failed to load plugins）；
3. `GET http://127.0.0.1:3082/dsh-auto-collapse/roster` → **200**、`own:true`、
   `config` 为**普通值**（不是 `null`——这直接验证 volatile 解引用 deref()）；
4. 打开**已完成**回合的真实会话：think/tool 行完整（`[data-variant="think"]` > 0）、
   控制台**无** `usePresentation is not a function` / `slot entry crashed`；
5. 折叠产出：`.dshcf-chip` > 0、`[data-dshcf-turn]` > 0；
6. 回合指标：`[data-dshcf-turn-metrics]` > 0 且挂在 `[data-turn-tail]` / `[data-turn-process]` 上；
7. 设置页插件卡片可读写**其余 4 项**（`keepLastRows` 行已移除）。

### 6.2 新增 14 条（编号 8-21）

8. **不污染原生节点**：插件**从未**对 `[data-step-process]`/`-body`/`-content`/任何 `[hidden]` 元素
   写 `style.display` 或插入节点（**唯一例外**：`button[data-turn-process]` 内的指标 span）**[仅真机]**；
9. `[data-step-process]` 组根的 `style.display` **恒为空串**（**含老会话**——依赖 W1-13 的遗留清理）**[仅真机]**；
10. **选择器不双命中**：嵌套 flow 下 `findFlow()` 稳定命中外层会话列；
11. **中文状态词**：**running 期**断言 `[role="status"]` 公告 span 被替换，且**未误改**三处错误提示行；
12. **幂等**：替换后再跑一轮 pass **不重复改写**、且能正确还原（用自有标记属性）；
13. **`reasoning`/`response` part 感知**：`reasoning` 节点不被判为「正文」；
14. **chip 门禁**：组不可见/收起态下不建 chip，或不谎报「折叠了 N 个」；
15. **running 期不双重隐藏**：进行中回合组已展开且插件未写 display **[仅真机]**；
16. **组重挂后展开态保留**：chip 重建后 `aria-expanded` 不丢 **[仅真机]**；
17. **间距不跳变**：`.O_Ebla_content` 兄弟选择器（CHAT:2160）不出现 8px/16px 跳变 **[仅真机]**；
18. **用户手势优先**：`isTrusted=true` 点击收起最后一组 → 插件**不再**展开（G1）；
19. **无振荡/死循环**：连续 **30 轮** pass 后，组的 `aria-expanded` **收敛**（不再变化），
    且插件对该组的 click 计数 **≤ 3**；
20. **不发散焦点**：pass 内自动 click 后 `document.activeElement` 与 click 前一致；
21. **官方面板不失准**：断言 **`div[data-chat-flow]`（column）的直接子级中不存在插件节点**
    （即 chip 不再走 flow 级挂载，§4.4）。
---

## 7. 实施计划

### 阶段 0（串行前置，**必须先做**）

**T0.1 真机 DOM 快照** —— 起隔离实例（`auto-collapse-dev`，端口 **3082**），用 playwright-cli 抓真实会话 DOM，
与本文档的源码结论对齐。**专验 3 件事**（桩无法覆盖）：
```
a. readVisibleTurn 在 chip 存在时是否失准（§4.4）—— 抓 column.children 与 chip 的实际关系
b. 自动 click 抢焦点与组内滚动跳动的真实表现（§5.6）
c. verbose 真实会话下插件是否确实建了 chip（§3.3，预期：是）
```
产出 `DOM_SNAPSHOT_0.1.7.md`。
**T0.2 修既有红测** —— §2.4。**必须先绿**，否则验收基线不可用。

### 阶段 1（W1 与 W2/W3 可并行；写入范围不重叠）

**W1 折叠重构** —— 写入范围：`src/fold.ts`、`src/settings.ts`、`src/index.ts`、`src/client.ts`、`src/locales.ts`、
`src/roster-constants.ts` + 新增 `test/fold-017-*.test.mjs`
⚠️ **W1-1 与 W1-6 依赖 T0.1 的结论**（§4.4 已给方案，但真机形态需确认）。

| # | 项 | 关联 |
|---|---|---|
| 1 | **`findBlocks` 不得把组根当 `block.host`**（§3.1 根因）；chip 宿主移出组根 | §3.1 |
| 2 | **§4.4 落地**：context 块折叠目标下移到 DisclosureRow 根 + chip 挂 flowItem 内部 | §4.4 |
| 3 | `findFlow()` 排除组内容流 **+ subagent 子会话面板**；修 `flows[0]` 回退（fold.ts:2997） | §3.2(1) |
| 4 | **正确谓词** `groupBodyVisible` / `groupCollapsibleMode` | §4.3 |
| 5 | **click 驱动 + 防护四件套**（纯函数目标态 / 门禁 / 收敛记账 / muting 延迟重放） | §5.5 |
| 6 | **焦点处置**（首选放弃自动 click；若保留则按 §5.6） | §5.6 |
| 7 | **A1 时序**：最后组恒展开 + **G1 用户手势接管** | §5.3 / §5.7 |
| 8 | **跨组聚合**：`model-retry`/`turn-error`/`turn-max-tokens` 夹中间时不断开 | §5.2 |
| 9 | **移除 `keepLastRows`（软降级）**：按 §5.8 的 5 步做 | §5.8 |
| 10 | **verbose 下不介入**：`aria-expanded==='true' && disabled` 时跳过 | §5.10 |
| 11 | `reasoning`/`response` part 感知（`hasBodyText`/`hasBodyContent`/`buildSegments` 的 bodySteps） | §3.1 |
| 12 | `thinkSummary()` 复用 `toolSummary()` 的 `[data-disclosure-row]` 路径 | §3.2(2) |
| 13 | `replaceTurnStatus()`：改结构判定 + **自有标记属性** + 保留内容门禁 + 标记与 Map 键**同一节点** | §3.2(3) + §7.1 |
| 14 | `MutationObserver.attributeFilter` 补 `hidden` 与 `data-group-expanded-mode` | §5.5 |
| 15 | 指标：读 `data-turn-process-*` 拿权威计数 + 补 token 类字段 + 避免自建行与原生行双写 | §5.9 |
| 16 | `click()` 适用条件守卫：`!alwaysOpen && canCollapse`（否则 no-op） | §5.4 |
| 17 | **清除老会话 DOM 中插件遗留的 `style.display`**（否则验收 9 必 FAIL） | §6.2 第 9 条 |
| 18 | **`npm run build`** 重建 `lib/index.js` + `lib/client.js`；同步 `lib/types/*.d.ts` | §2.2 |
**W2 指标 shadow（方案 C）** —— 写入范围：`src/turn-metrics.ts`、`src/client.ts` + 新增 `test/shadow-inject-*.test.mjs`
**背景**：内置 `assistant-step` 注册时声明了 `inject: () => ({ hooks: { presentation } })`（CHAT:6736-6741）。
0.1.7 起该 face 由槽位框架**按条目**解析，插件的 shadow entry 没声明 inject → 拿不到 `usePresentation` →
委托渲染内置组件时抛 `usePresentation is not a function` → **整条槽位崩溃**。
**做法**：给 shadow 自己的 register options 加 `inject`，**转发内置的 hook source**，让框架自己包装：
```js
slotsService.register({
  name: 'conversation.chat.node', key: 'assistant-step', priority, locale,
  inject: () => {
    const inner = builtinAssistantInject          // 内置 entry 的 inject 工厂
    if (inner === undefined) return {}
    const face = inner() ?? {}
    const src = face.hooks && face.hooks.presentation
    // ★ 必须显式挡 undefined（见下）
    return src === undefined ? {} : { hooks: { presentation: src } }
  },
}, TurnMetricsNodeView)
```
**机制核实**（`dsh-client-ui-renderer/lib/client.js`）：
```
runInject(:415-422) → bindInjectSources(:424-439) → observableHook(:219-226)
  → bound[standardHookPropName('presentation')] = observableHook(src)  // 挂成一级 prop：usePresentation
```
**★ 必须显式挡 undefined**：`observableHook` 内部是 `hookCache.get(source)` + `hookCache.set(source, hook)`，
`hookCache` 是 `WeakMap` → 传 `undefined` 会在 **`WeakMap.set(undefined, …)` 处抛 `TypeError`**，
且是**绑定期**就崩（不是渲染期）。对照 `materializeStandardBinding`（renderer:646-657）**有**显式守卫，
说明这是 entry 级 inject 面**缺守卫**，不是框架惯例。
**两个前提/副作用**（必须知道）：
1. **槽位声明层已声明 inject 也没用**：`conversation.chat.node` 的 slot 级声明带 `CHAT_NODE_INJECT`（CHAT:12311-12315），
   但 renderer 只按 **entry 自己的** `options.inject` 调 `runInject` → **必须自己显式声明**；
2. **同名覆盖**：内置 face 与 session standard 的 `hooks:{presentation}`（CHAT:12329）会物化成**同名** `usePresentation`，
   `renderEntry` 顺序 `...kit, ...injected`（renderer:774-775）使 **entry 覆盖 kit**；
   且 `assertNoPropOverlap`（renderer:1005）**只在 factory 路径校验**。
**同时删除**：`canShadowBuiltin()` 的「不注册」降级、`withBuiltinInject()` 的手工转换。
**保留**：R1 的 HMR 可逆链路（`disposeTurnMetricsInjector`）。
**W3 红测修复**（= T0.2）—— 写入范围：`test/host-settings.test.mjs`（唯一）。

### 阶段 2（串行）

- **T2.1** 隔离实例跑 §6 的 **21 条探针**（7 基础 + 14 新增）；
- **T2.2** 独立 subagent 审查（**只用 subagent 做审查**）+ 复审至无可合并问题；
- **T2.3** 文档收口：更新 `DSH_0.1.7_ADAPTATION.md`、README、`behavior-spec.md`（含 §5.8 降级声明）。

### 阶段 3（交付）

1. **全绿后**再改 `~/.dsh/profiles/web/cordis.patch.yml`，恢复 `dsh-auto-collapse` 的 `enabled`；
2. 主实例**不重启服务**（如需重启：`Start-Process powershell -WindowStyle Hidden -File E:\Data\Script\restart-dsh-web.ps1 -Wait`，
   且**本会话只执行一次**；勿用 `/dsh-market/restart`）；
3. 提交推送到 **`dalcui`**（本项目唯一 remote）。
---

## 8. 风险清单

| # | 风险 | 级别 | 处置 |
|---|---|---|---|
| R1 | 对组根/组内写 `display` 破坏原生折叠；组根**无 `style` prop** → React **永不自愈**（永久性） | 🔴 | §4.2 硬约束 + W1-1 |
| R2 | chip 建在组内错位（排在官方标题之前） | 🔴 | W1-1 |
| R3 | **click 振荡 / 死循环**（c1/c2/c3） | 🔴 | §5.5 四件套 + 验收 19 |
| R4 | **click 抢焦点 + 主动滚动**（`focus()` 不可回滚） | 🔴 | §5.6 + 验收 20 |
| R5 | **flow 级 chip 破坏官方 `readVisibleTurn` 二分** | 🔴 | §4.4 + 验收 21 |
| R6 | verbose 下插件介入且破坏 | 🔴 | W1-10 |
| R7 | chip 谎报「折叠了 N 个」而实际不可见 | 🔴 | §4.3 正确谓词 + 验收 14 |
| R8 | 状态词替换**幂等断裂**（英文下逐 pass 累加；中文下彻底失效） | 🟠 | W1-13 + 验收 12 |
| R9 | 状态词误改三处错误提示行（TurnError/TurnMaxTokens/retry 也是 `role=status`） | 🟠 | 保留内容门禁 + 验收 11 |
| R10 | 「自动展开最后组」被 CHAT:2313-2319 反冲 | 🟠 | 门禁（W1-5）+ G1 |
| R11 | 用户手动收起被撤销 | 🟠 | §5.7 G1 + 验收 18 |
| R12 | 组内间距跳变（兄弟选择器 CHAT:2160） | 🟡 | 验收 17 **[仅真机]** |
| R13 | 组重挂后 chip 孤儿 / 展开态丢失 | 🟡 | `validParent` 自愈（fold.ts:1676-1680）+ 验收 16 |
| R14 | `findFlow` 选中 subagent 子会话面板 | 🟡 | W1-3 |
| R15 | W2 中 entry 覆盖 kit 的同名 `usePresentation` | 🟡 | §7 W2 已记录 + 复审确认 |
| R16 | **B-移除波及 `src/` 6 文件 + `test/` 18 文件** | 🟠 | §5.8 的降风险 5 步 |
| R17 | 既有 25 个测试 fixture 是**旧 DOM 形状** | 🟡 | 新增测试覆盖新形状；既有测试按新语义调整 |
| R18 | **未做真机运行期实测** | 🟡 | T0.1 |
| R19 | 老会话 DOM 里已有插件写的 `style.display` 残留 | 🟡 | W1-17 |
---

## 9. 角色分工（Agent Teams）

| 角色 | 职责 | 写入范围 |
|---|---|---|
| **T0 侦察**（subagent，只读） | T0.1 真机 DOM 快照（专验 a/b/c 三件事） | 仅新增 `DOM_SNAPSHOT_0.1.7.md` |
| **W1 折叠重构** | §7 阶段 1 的 W1（18 项） | `src/fold.ts`、`src/settings.ts`、`src/index.ts`、`src/client.ts`、`src/locales.ts`、`src/roster-constants.ts` + 新增测试 |
| **W2 指标 shadow** | §7 阶段 1 的 W2 | `src/turn-metrics.ts`、`src/client.ts` + 新增测试 |
| **W3 红测修复** | §2.4 | `test/host-settings.test.mjs`（唯一） |
| **R1/R2 审查**（subagent，只读） | 对 W1/W2 独立复审 | 无 |
| **V 验收** | 21 条探针 + 恢复 enabled | `cordis.patch.yml` |
**依赖**：`T0.1 → W1`；`W2` / `W3` 与 W1 并行；`R1/R2 → V → 文档收口`。
---

## 10. 决策记录（已全部拍板，**无需再问用户**）

| 决策 | 结论 | 位置 |
|---|---|---|
| **D1** | 组收起时**不自建 chip**；把原插件功能**在原生折叠基础上重新构建** | §5.1 / §5.2 |
| **A** | **A1**：chip 覆盖除最后一组外全部；最后一组恒展开 | §5.3 |
| **B** | **移除 `keepLastRows`（软降级）** | §5.8 |
| **C** | **C1**：只补原生没有的指标（保留计数、读原生属性拿权威值） | §5.9 |
| **D2** | ~~建议用户改 verbose~~ —— **已作废**（verbose 下插件本应完全不介入，§5.10） | §3.3 |
| **D3** | 完成适配后再启用插件 | §7 阶段 3 |
| **P0-5** | **(a) 短期方案**：让所有 chip 都不落在 `column.children`（context 块折叠目标下移） | **§4.4** |
---

## 附录 A. 踩坑备忘（血泪教训，省一次逆向）

**A.1 六个「我以为对、实际错」的结论**（写代码时若发现与此不符，**以本文档为准**）：
```
1. ❌「0.1.7 工具组折叠导致 findBlocks 收集不到块」
   ✅ 收集用的是后代查询（fold.ts:3562），照样收集得到；真问题是组根被当成了 block.host
2. ❌「状态词替换的目标是 button[data-turn-process] 的 label」
   ✅ 目标是 role="status" 的 visuallyHidden 无障碍公告 span（CHAT:6171-6176，不含时长）
3. ❌「verbose 下插件会接管更多」→ 方向反了
4. ❌「verbose 下插件完全不介入」→ 实际介入了（chip=1 在组根内）
   踩坑点：探针给按钮设 aria-expanded="" 会得到 chip=0 的假象，真实值是 "true"
5. ❌「groupExpanded = 有 data-group-expanded-mode」→ 语义反了（属性存在 ⇔ 【非】折叠模式）
6. ❌「block.key 含 group:」→ 实际是 node:<groupKey>:block:N（fold.ts:3044-3050，组根无 data-chat-flow-kind）
```
**A.2 三个「看起来对、技术上不成立」的方案**：
```
1. ❌ chip 用 height:0 + visibility:hidden 保几何单调
   → chip 是 display:flex; min-height:24px，且兄弟 gap 16px 照算 → rect.top 仍被推高 24+16px
2. ❌ muting 期间无条件丢弃 observer 回调
   → 会丢掉同批次的真实变化，且异常未清则永久失聪
3. ❌ 保存/恢复 activeElement 来消除 click() 的焦点副作用
   → blur/focus 事件已派发、滚动不可回滚、恢复本身产生第二次 focus（双倍抖动）
```
**A.3 关键源码坐标速查**：
```
CHAT:1606-1627  useSearchableHidden（hidden=until-found，含焦点保护 + beforematch）
CHAT:1688-1710  processWindowReady / processMember / processHidden / processOpen
CHAT:1845-1856  useDisclosure（组展开态是组件局部 state，不写 DOM 属性）
CHAT:2082-2101  useProcessScroll.sync（组滚动窗口，注意 [hidden] 门禁）
CHAT:2257-2266  组标题 button[data-process-activity]（aria-expanded 可读、onClick 可驱动）
CHAT:2299-2382  ChatGroupSeat（grouped 判定 / body hidden / 标题层 hidden={!grouped}）
CHAT:2313-2319  ★ c2 死循环的元凶（outerHidden 时 setOpen(false)）
CHAT:4524-4573  anchor() / capturePosition（锚点选择键 data-chat-anchor-key）
CHAT:4582-4605  ★ readVisibleTurn 二分（依赖 rect.top 单调 + data-chat-turn）
CHAT:6145-6196  TurnProcessNodeView（open = !foldable || open；aria-expanded；disabled）
CHAT:10565-10573 INDEPENDENT 集（含 model-retry → 切组）
CHAT:10680-10747 ProcessGroupBuilder.rebuild（分组逻辑，不读 policy）
CHAT:12013-12042 四模式 presentation policy
```