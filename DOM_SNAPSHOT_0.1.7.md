# DOM_SNAPSHOT_0.1.7 — 真机 DOM 快照（T0.1 产出）

> 采集环境：`dsh --profile auto-collapse-dev --port 3082`，DSH **0.1.7-rc.2**，
> 插件为**当前 0.1.7 未适配版本**（故快照同时记录了破坏现象）。
> 采集方式：playwright-cli（chrome），真实已完成会话 `session-8ad27872`（6 回合 / 97 官方组 / 208 工具行）。
> 采集时间：2026-09-28。

---

## 0. 与规格书 §4.4 的一致性结论（**重要修正**）

规格书 §4.4 称「`readVisibleTurn` 对 `elements.column.children` 做二分」，并据此推导
「chip 若成为 column.children 成员会破坏二分」。

**真机源码核对结果（CHAT:5163-5166）**：
```
<div ref={scroll.columnRef} className="…column" data-chat-flow="">   ← data-chat-flow 在 column 上
```
`elements.column` **就是**外层 `div[data-chat-flow]`（`data-chat-flow` 在列容器上设一次）。
规格书 §3.1 的层级图（`div[data-chat-flow]` 外层 → 组根）**正确**；§4.4 的措辞亦正确。

**真机实测**：column 直接子级中确有插件节点，命中 §4.4 的唯一触发路径：
```
colPluginChildren = ["dshcf-chip dshcf-flow-chip", "dshcf-chip dshcf-flow-chip"]
chipByParent      = { column: 2, group-root: 28 }
```
→ **§4.4 的风险已真实发生**（2 个 flow 级 chip 落在 column 子级），验收第 21 条当前 **FAIL**。

---

## 1. 会话层结构

```
div.EvIC1a_column [data-chat-flow]              ← elements.column；228 个直接子级
  div.EvIC1a_older                              ← "加载更早"按钮（非 flowItem）
  div.EvIC1a_flowItem [data-chat-flow-kind="user"]        [data-chat-turn]
  div.EvIC1a_flowItem [data-chat-flow-kind="turn-process"] [data-chat-turn]
  BUTTON.dshcf-chip.dshcf-flow-chip             ← ★ 插件节点（破坏二分）
  div.EvIC1a_flowItem [data-chat-flow-kind="model-retry"]
  div.O_Ebla_root [data-step-process] [data-chat-turn]     ← 官方工具组
  div.EvIC1a_flowItem [data-chat-flow-kind="assistant-step"]
  …
```

- `data-chat-flow-kind` 实测全集（本会话）：
  `user / turn-process / model-retry / assistant-step / tool-call / turn-error / turn-tail / turn-trigger / steering`
- **flowItems 计数 239，column 子级 228** → 差值来自组内容流（`data-step-process-content` 也带 `data-chat-flow`）。
- **`flowsTotal = 98`，其中 `nestedFlowCount = 97`**（即 97 个组内容流），
  `firstFlowIsColumn = true`（文档序第一个即 column，故 `findFlow()` 当前侥幸取对）。
- **组根 97 个，全部是 column 的直接子级**（`groupsDirectInColumn = 97`，无嵌套）。
  规格书「组根无 `data-chat-flow-kind`」**证实**（`groupHasKind = null`）。
- **`data-chat-turn` 在组根上存在**（`groupHasTurnAttr = "3"`）。

### 1.1 结构变更（相对 0.1.2）

| 项 | 0.1.7 真机 |
|---|---|
| `data-follow-end` | **0 命中**（已移除） |
| think 行 `data-state` | **恒有**（`running` / `ok`） |
| think 行结构 | 与工具行**同形**：`[data-variant=think][data-state]` > `[data-disclosure-row][data-expandable]` > leading/title/separator/summary>`span.*_summaryText` |

---

## 2. 官方工具组（`data-step-process`）

```
div.O_Ebla_root [data-step-process="true"] [data-chat-turn="3"]
                [data-chat-group-key] [data-chat-flow-key] [data-chat-anchor-key="group:…"]
                [data-chat-paging-anchor]                 ← grouped && !open 时才有
                [data-group-expanded-mode]                ← !grouped 时才有
  div [hidden]                                            ← hidden={!grouped}，非折叠模式才隐藏标题
    button.O_Ebla_title [data-process-activity="thinking"] [aria-expanded="false"]
      span.O_Ebla_leading > (span[data-step-process-icon] , span[data-step-process-chevron])
      span.O_Ebla_label  "…"
  div.O_Ebla_body [data-step-process-body] [hidden="until-found"]   ← 收起时
    div.O_Ebla_content [data-step-process-content] [data-chat-flow] ← ★ 嵌套 flow
```

真机统计（97 组）：
- `groupBtnFalse = 97`、`groupBtnTrue = 0` → **全部默认收起**（compact：`stepGrouping='collapsed'`）。
- `groupHasGroupExpandedMode = false`（本会话全部处于折叠模式 → 属性**不写**）。
  → 印证 §4.3：`data-group-expanded-mode` 存在 ⇔ **非**折叠模式，
     **绝不能**用它判「用户是否展开」。
  → 也印证「outerHidden 历史组」场景：`grouped=true` 但该属性缺失，
     此时 `body` **无 `hidden`**（body hidden 只在 `grouped && !open` 时写，
     `hidden={!grouped}` 写在**标题外层 div** 上）。**§4.3 的错误谓词风险证实**。

### 2.1 ★ 行嵌套（决定重构可行性的关键事实）

```
thinkTotal      = 53   thinkInGroup = 53   thinkInHelper = 0
toolTotal       = 208  toolInGroup = 208
cmdInGroup      = 12
```
→ **0.1.7 把全部 think / tool / command 行都包进了官方组**，
   `flowItems(flow)`（flow 直接子级）**再也看不到任何行**。
   → `findBlocks` 的 `callRowsIn(el)`（后代查询）会**透过组根命中组内工具行**
     → `isToolPile=true` → **组根被当作 `block.host`**。规格书 §3.1 根因 **证实**。

---

## 3. ★ 三类破坏的真机证据（§3.1 B1/B2/B3）

| # | 指标 | 真机值 | 判定 |
|---|---|---|---|
| **B1** | 组根 `style.display === 'none'` | **11**（共 97 组）；`groupHidden`（原生 hidden 属性）= 16 | ✅ **复现**：插件对 11 个组根写了内联 `display:none` |
| **B1** | 被插件隐藏的组，标题按钮是否可见（`offsetParent !== null`） | `[false,false,false]` | ✅ **整组（含官方标题）消失** |
| **B2** | chip 的父节点 | `group-root: 28`、`column: 2` | ✅ **28 个 chip 被 prepend 进组根内部**（排在官方标题按钮之前） |
| **B3** | 插件写了 `display:none` 的 think 行 | `data-variant=think` 且 `style=display: none;` **命中** | ✅ **工具/思考卡仍不可见** |

补充（原生自愈性）：组根 JSX（CHAT:2343-2352）**没有 `style` prop** →
React **永不清除**插件写的 `style.display` → **永久性**（规格书 §3.1 结论证实）。
对照：`button[data-turn-process]` 的 children 由 React 管理，插件插的指标 span 能自愈
（真机实测 `tpInfo[].metrics` = 1/1/0/0/1/1，span 存在且被重建）。

---

## 4. 原生回合行（`turn-process`）

```
div.EvIC1a_flowItem [data-chat-flow-kind="turn-process"] [data-chat-turn="3"]
  div [data-slot="conversation.chat.node"] [style="display: contents"]
    span.TTCZqG_visuallyHidden [role="status"] [aria-live="polite"] "深度求索中"
    button.l_V-RG_root [data-turn-process="3"]
      [data-turn-process-messages="26"] [data-turn-process-tool-calls="34"] [data-turn-process-subagents="0"]
      [disabled] [aria-expanded="true"] [data-open="true"]
      span.l_V-RG_label "…用时28分2秒"
```

真机 6 个 turn-process 的按钮状态：
```
turn=3 aria=true  disabled=true   metrics=1
turn=4 aria=true  disabled=true   metrics=1
turn=5 aria=true  disabled=true   metrics=0
turn=6 aria=true  disabled=true   metrics=0
turn=7 aria=false disabled=false  metrics=1   ← 唯一可折叠的
turn=8 aria=null  disabled=true   metrics=1
```
→ **证实 §5.4 / §5.10**：「`aria-expanded==='true'` 且 `disabled`」= 原生不可折叠
   ⇒ 插件**不介入**。也证实 `data-turn-process-*` 计数属性可直接读，无需自己数 DOM。

> ⚠️ 踩坑印证：**不能**给按钮设 `aria-expanded=""` 做测试，真实值是 `"true"` / `"false"` / `null`。

**`[role="status"]` 实测 6 处**：
```
"处理失败"                        class=TTCZqG_visuallyHidden   ← TurnError，不可误改
"已重试模型请求（6/30） · 10s"    class=Sixlwa_retryText        ← retry，不可误改
…（另 4 条 retry 同类）
```
→ 印证 §3.2(3)/R9：状态词替换必须**保留内容门禁**（只改 turn-process 节点的公告 span）。

---

## 5. 真机未能复现的项（如实声明）

- **verbose 模式（§3.3）**：本会话为 compact（`transcriptView: compact`，
  组全部收起、`groupBtnTrue=0`），**未**观测到 `aria-expanded="true" + disabled` 的
  verbose 情形下的 chip 建立。§3.3 的 bug 结论**未经本轮真机验证**，代码按 §5.10 实现。
- **`readVisibleTurn` 二分失准的直接观测**（§4.4）：未做滚动-读数对照实验；
  但「chip 落在 column 子级」这一**必要前提已实测成立**（2 个），故按 §4.4 修。
- **焦点/滚动副作用**（§5.6）：未做端到端焦点观测；代码按「首选放弃自动 click」实现。

---

## 6. 对实施的影响（结论）

1. **W1-1 是硬前提**：组根绝不可成为 `block.host`；且**行全在组内**，
   意味着插件的二级折叠**必须**改为驱动官方组按钮（``button[data-process-activity]``），
   而不是隐藏行——因为组收起时行本就被 `hidden="until-found"` 覆盖。
2. **§4.4 必须落地**：真机已有 2 个 flow 级 chip 落在 column 子级。
3. **`findFlow()` 必须收窄**：`flowsTotal=98` 而嵌套 97 个；
   当前「取第一个可见」侥幸正确，但 `flows[0]` 回退（不可见时）会选中组内容流。
4. **谓词必须照 §4.3 写**：真机 `data-group-expanded-mode` 全部缺失（折叠模式），
   错误谓词在此场景会返回 true 而绕过门禁。
