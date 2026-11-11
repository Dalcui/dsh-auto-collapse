# 宿主 DOM 契约（改折叠前先读）

DSH 各版本宿主 DOM 契约要点、已知坑与 0.2.2 追加事实。涉及折叠/展开驱动、宿主结构判定的改动必读。
> 来源：自 [AGENTS.md](../AGENTS.md) §2 拆出（0.3.7 文档渐进披露重构）

---

## 契约表

| 契约 | 0.1.7 ~ 0.2.0 | 0.2.1-rc.2 |
|---|---|---|
| 流容器 | 列 `[data-chat-flow]` 的直接子级 | 列 > `div[data-slot="conversation.chat.flow"]`（`display:contents`）的直接子级 |
| 原生回合行 | `button[data-turn-process]`，展开态 = `aria-expanded="true"` | 同上，但展开态看 **`data-open`**；`aria-expanded` 只在 `hasContent` 时写 |
| 官方工具组 | `div[data-step-process]` 不透明容器：只读属性/内部行、只驱动组头按钮、绝不写 style、绝不往组根/body/content 插节点；**唯一例外（0.3.5）** = 组头按钮末尾的 inert 工具计数 span |
| 组折叠态 | 组头按钮 `button[data-process-activity]` 的 `aria-expanded` | 同左 |
| alwaysOpen（插件完全不介入） | `aria-expanded==='true' && disabled` | `data-open && disabled`（插话回合 `hasContent=false` ⇒ 无 aria-expanded） |

已知坑：`[hidden="until-found"]` 的 `computed display` 是 none 但 `style.display` 为空；
不要用 `aria-expanded=""` 判定；chip 只能挂 `turn-process` 座位内部（不能进
`column.children` 二分序列）。

0.2.2-rc.1 追加（2026-11-08，0.3.4 适配）：

- 内置 `assistant-step` 的 **entry 级 inject face** 新增 `resolveFilePath` / `fileMentions`
  （`fileMentions` 已从 ChatView kit 移除），工厂签名变为 `(sessionId) => face`。
  shadow / 委托渲染必须**整体透传**内置 face；只转 `hooks.presentation` 会让内置
  `AssistantNodeView` 在闭合回合最终回复上抛 `fileMentions is not a function` 并被
  SlotErrorBoundary 退市（指标全丢）。
- `[data-chat-running]` 新增 `data-holding` 形态（会话已停、回合未闭合的隐藏占位），
  **不算在跑**：运行判据须写 `[data-chat-running]:not([data-holding])`。
- `data-turn-process-answer`（`compactAnswer`）在 0.2.2 移除；插件未引用。
- 组内容 `[data-step-process-content][data-chat-flow]` 与 `turn-tail` flow kind 在
  0.2.1 已存在，**不是** 0.2.2 新增。
