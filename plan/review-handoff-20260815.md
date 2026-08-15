# DSH Auto Collapse 全量 Review 交接笔记

更新时间：2026-08-15

## 约束与基线

- 本轮是只读 review；用户明确禁止使用 subagent。
- 未修改源代码；工作区中已有用户改动必须保留。
- 当前分支：`main`，HEAD `2639e44`。
- 初始工作区已有改动：`lib/client.js`、`src/fold.ts`、`test/fake-dom.mjs`、`test/fold-regression.test.mjs`，以及未跟踪的 `behavior-spec.md`。
- `behavior-spec.md` 是当前行为约定的主要依据；`handoff.md` 是历史交接资料，部分结论仍待真实页面验证。

## 已完成的阅读与验证

- 已通读 `behavior-spec.md`、`handoff.md`、`README.md`、`README.en.md`、构建/部署脚本和 `package.json`。
- 已核对当前 DSH 安装包的真实节点模型：助手最终内容使用同一个 `assistant-step` 节点持续更新；顶层手动命令是 `command`；工具调用内部才有 `data-chat-call-id`。
- 已通过：`npm run build`、`node test/fold-behavior.test.mjs`、`node test/fold-regression.test.mjs`、`node test/adversarial-race.mjs`、`node test/adversarial-session.mjs`、`node test/debug-blocks.mjs`、本机现有 `tsc --noEmit`、`git diff --check`、`npm pack --dry-run --json`。
- 这些测试主要使用 fake DOM，不能替代真实 DSH/React 重渲染验证。
- 额外执行两回合确定性排列压力测试：40 组中 35 组违反最终收敛不变量，见问题 15。

## 已复现的高风险问题

1. **顶层 `command` 卡片完全不折叠**：真实 `command` seat 没有 `data-chat-call-id`，`findBlocks()` 只识别该属性；合成 `command` 流程结果为 `processed 0`、命令仍可见、无 chip。
2. **React 替换节点导致已完成工具泄漏**：替换已处理工具 DOM 后，新节点按 HTMLElement 身份成为未认领 block，结果工具可见并出现新的 chip。
3. **同一 `assistant-step` 节点后续补正文不会重新归类**：初始只有 thinking 的节点随后补正文时，`takeNewAnchors()` 已标记过，`replayTurn()` 不再运行；复现结果为中间正文/工具泄漏和残留 thinking chip。真实 DSH 正是原地更新该节点。
4. **think carry 穿过 turn/user 边界**：`findBlocks()` 的 `carry` 未在硬边界刷新，上一 turn 的第二段 thinking 会被归入下一 turn 的 chip。
5. **running 计时跨 flow/session 泄漏**：全局 `turnStartMs` 在旧 flow 运行时切换 flow 未清理；新 flow 的已完成行会得到错误的 `0秒`/旧计时，而不是尾部可解析时长。
6. **边界先收尾、工作节点后到时不会补一级行**：先只挂 `user + turn-tail`（scope 为空，边界被标记 settled），再插入工具和 assistant 正文，结果没有 `.dshcf-processed`，工具只留下可见二级 chip。
7. **真实单个 `assistant-step` 原地补正文会泄漏旧中间正文**：step1 已有正文、step2 只有 think 时先收尾，之后给同一个 step2 节点补 final 正文，step1 仍保持可见而应折叠；这是 DSH 当前复用 `assistant-step` 节点的实际流式模型。
8. **纯图片 final 被当作无正文**：只含 `<img>` 的 assistant 节点 `hasBodyText()` 返回 false，完成后宿主和工具都被隐藏，图片不可见。
9. **原始样式不可逆**：工具宿主初始 `style.display='grid'`，折叠后为 `none`，展开后变成空字符串而不是 `grid`；`stop()` 同样只恢复为空字符串。
10. **DOM 修复丢失一级展开状态**：展开后移除 `.dshcf-processed` 触发 `healProcessedRows()`，重建行的 `aria-expanded` 从 `true` 变回 `false`，标题也回到“展开工作过程”。
11. **命令摘要会取 suffix**：实际 ToolRow 的 DisclosureRow 结构是 summary 后再挂 `summarySuffix`；`toolSummary()` 取 `lastElementChild`，运行中会显示 suffix（例如 `(live)`）而不是主命令。
12. **状态文案修改未限定当前 flow**：合成一个 flow 外部的 `[role=status]` 后，插件仍把它从 `Deep diving` 改成 `Deep sleeping`。
13. **相邻 context 会被吞进工具 chip**：`findBlocks()` 对 `context` 只标记自身为 row，却不刷新 `run`；`user → context → tool` 最终只有一个 `运行了命令` chip，context 没有独立二级摘要，与函数注释/现有 context 场景的意图不一致。
14. **乱序历史渲染会把正文挂到错误回合**：先创建 turn2 一级行，再把 turn1 批次插到它前面，`processedRows` 的 Map 插入顺序变成 turn2→turn1。之后给 turn2 后挂中间正文时，`replayTurn()` 取“Map 中最后一个位于 boundary 前的 entry”，错误选中 turn1；复现中展开 turn2 看不到正文，展开 turn1 才出现。
15. **两回合乱序挂载不能最终收敛**：用当前 DSH 的真实 `assistant-step` 类型对两个已完成回合执行 40 组确定性随机插入排列；不变量为最终恰有两条一级折叠行、工作节点全部隐藏、最终答复可见且每行只展开本回合。结果 35/40 失败，表现包括 0/1 条折叠行、工作节点泄漏、最终答复被隐藏和跨回合归属错误。这是 fake-DOM 排列压力测试，不等同于真实浏览器复现，但直接证明当前一次性消费锚点、按 HTMLElement 身份记账的状态机不满足行为规范要求的“最终收敛”。

## 重点代码位置（当前行号可能随用户后续编辑变化）

- 主循环与状态：`src/fold.ts:396-624`
- turn 归并：`src/fold.ts:644-787`
- 节点修复与 chip：`src/fold.ts:934-1037`
- block 识别：`src/fold.ts:1183-1258`
- 行状态/摘要：`src/fold.ts:1334-1498`
- boundary/首用户判断：`src/fold.ts:1538-1588`
- 会话状态清理风险：`src/fold.ts:460-470`

## 已确认的工程化与剩余风险

- 原始 `style.display` 会被覆盖且无法完全恢复，见问题 9。
- `healProcessedRows()` 重建 level-1 行时会丢失展开状态，见问题 10。
- `toolSummary()` 取 `lastElementChild` 会误取 `summarySuffix`，见问题 11。
- `middleByHost`/旧 flow 节点是否长期强引用，及全局 MutationObserver 的性能压力。
- 测试 fixture 使用不存在的顶层 `assistant` kind、缺少真实浏览器/React 重渲染覆盖。
- `package.json` 与 `package-lock.json` 版本不一致，缺少 typecheck/lint/test 脚本，以及 MIT 元数据但无 LICENSE 文件。
- `stop()` 未清空 `blockContainers`/`allRows` 等强引用，旧节点长期会话/HMR 可能保留；全局 MutationObserver 还观察整个 body 的 subtree、attributes、characterData。
- 当前 `node_modules/.bin/tsc --noEmit` 可通过，但 TypeScript 5.9.3 是 extraneous，`package.json` 未声明且没有 `typecheck`/`test`/`lint` 脚本；干净安装不会复现这条检查。
- `deploy.mjs` 用 `shell:true` 拼接命令，并按端口强制停止任意监听进程、直接覆盖已安装 bundle，缺少目标身份校验/备份/回滚。

## 最终结论与建议顺序

当前测试全绿不能证明插件在真实 DSH 流式更新、手动 command、React 节点替换和会话切换下正确。最先应把一次性 HTMLElement 消费模型改为按 flow/segment/稳定 key 每轮协调的状态模型，并把真实 `assistant-step` 原地更新、节点替换和乱序排列纳入回归；随后补齐 `command`/`manual-compaction`、图片 final、边界隔离和样式可逆；最后再处理动效、摘要、性能、部署与发布门禁。本轮未修改插件源代码，只新增并持续更新本交接笔记。
