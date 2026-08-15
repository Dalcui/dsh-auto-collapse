# DSH Auto Collapse 修复交接笔记

更新时间：2026-08-15

## 用户授权与边界

- 用户要求直接执行全量修复，并授权使用真实浏览器与 DeepSeek V4 Flash 做流式交互验证。
- 用户此前明确禁止 subagent；本轮继续由主线程独立完成。
- 保留当前工作区已有改动，不 commit、不 push。
- 不整包推倒重写：保留现有 chip、图标、三级思考展开和样式组件，重写核心 flow/segment 协调状态。

## 实施基线

- 分支 `main`，基线 HEAD `2639e44`。
- 工作区已有用户改动：`lib/client.js`、`src/fold.ts`、`test/fake-dom.mjs`、`test/fold-regression.test.mjs`、`behavior-spec.md`。
- Review 笔记：`plan/review-handoff-20260815.md`，共记录 15 个复现问题。
- 本机 DSH `0.1.0-rc.6` 的真实契约：助手节点始终为 `assistant-step` 并原地更新；命令节点为 `command` / `manual-compaction`；图片 final 可以只有 `<img>`、没有正文文本节点。

## 目标设计

- 每轮从当前 `[data-chat-flow]` 的 DOM 顺序重建 segment，不再依赖 fresh-anchor 一次性事件。
- segment 由 `user` / `steering` 起点和 `turn-tail` / 下一段起点界定；已完成 segment 每轮重新协调 final、中间正文与工作块。
- 运行期 UI 状态以稳定 flow/key 记录，DOM 元素只作为当前渲染引用；React 替换节点后自动重新绑定。
- 原始 inline `display` 在首次写入前保存，展开、卸载和分类漂移时精确恢复。
- `command`、`manual-compaction`、tool-call、context、thinking 与 image-only assistant 都进入统一语义分类。

## 验证计划

- 固化 15 个 review 复现，加入固定种子排列压力测试。
- 运行 build、全部测试、typecheck、diff-check、pack dry-run。
- 安全部署前核对 3080 监听进程并备份当前安装 bundle。
- Chrome 中选择 DeepSeek V4 Flash，验证真实流式正文、工具/命令折叠、最终输出、历史重载、展开/收起与控制台错误。

## 当前进度

- [x] Review 与真实 DSH 源码契约核对
- [x] 核心协调逻辑重写
- [x] 回归与排列测试
- [x] 构建与静态验证
- [x] 本机 DSH 安全部署与服务端 bundle 哈希核验
- [x] 真实浏览器验证

## 已完成实现

- `FoldController` 已移除 `seenBodyNodes` / pending boundary / claimed host / replayTurn 状态链；每轮使用当前 DOM 重建 segment，并以 `data-chat-flow-key` / `data-chat-anchor-key` 生成稳定 key。
- segment 展开状态、block 展开状态和实时计时均按稳定 key 隔离；React 替换节点后重新绑定，一级行被移除后保持原展开状态重建。
- 所有被插件改写的 inline `display` 都记录原值；分类漂移、换 flow 和 stop 时精确恢复。
- 支持顶层 `command` / `manual-compaction`、纯图片 final；context 与 tool 分块；thinking carry 在 user/steering/turn-tail 边界刷新；Deep sleeping 只修改当前 flow。
- running chip 已补文字 shimmer、三点跳动和 reduced-motion；工具摘要不再误取 suffix；Edit/Write 完成态显示“编辑了文件”。
- 新增 `test/fold-reconcile.test.mjs`，覆盖 review 的关键复现和固定种子 40 组双回合乱序挂载；当前 40/40 全部收敛。
- 新增 `npm test` / `npm run typecheck` / `npm run check`、正式 TypeScript 依赖、CI、MIT LICENSE；package-lock 已同步到 0.1.3。
- `deploy.mjs` 已改为目标/进程身份核验、时间戳备份、无 shell 参数调用、服务端哈希验证和失败回滚。
- 协调器异步 pass 增加非可视自诊断：成功标记 `data-dshcf-state="active"`，异常只记录首个同类错误并允许后续 mutation 重试。
- 官方 `turn-tail` 时长现在优先于本地 running 计时，避免实时完成后显示 13 秒、刷新后变成 16 秒；没有官方时长时仍使用 segment 本地计时。

## 阶段性验证

- 最终通过：`npm run check`（typecheck、原有 behavior/regression/race/session、新协调器回归与 40 组排列）、部署/测试脚本 `node --check`。
- 包验证通过：`npm pack --dry-run --json` 产物为 `dsh-auto-collapse@0.1.3`，9 个条目，含 LICENSE；`npm ci --dry-run --ignore-scripts` 无锁文件漂移。
- `git diff --check` 通过，仅报告 Windows 工作区现有 LF→CRLF 转换提示；没有空白错误。
- 2026-08-15 最终真实部署：目标为 `C:\Users\a179\.dsh\profiles\web\node_modules\dsh-auto-collapse\lib\client.js`；最终部署前备份为 `client.js.backup-2026-08-15T11-32-18-516Z`；旧 DSH 进程经页面与命令行双重确认后停止，新 PID `37108`。
- 最终服务端验证：主页 revision `1ed1cf9a3412`，实际返回 bundle SHA-256 前缀 `67cce26811cc`，与本次构建完全一致。
- 部署首跑额外发现并修复：命令宿主可能不继承请求的 cwd；`deploy.mjs` 的所有同步子进程现固定使用脚本所在仓库为 cwd。

## 真实浏览器验证

- Chrome 真实页面 `http://127.0.0.1:3080/`，模型选择器确认 `DeepSeek-V4-Flash / Max`。
- 第一回合实际运行 PowerShell `Start-Sleep -Seconds 6` 后输出测试串，再由 Read 工具读取本仓库 `package.json`；完成态生成一条 `已处理 24秒`，两个工具与中间 assistant-step 隐藏，最终长回答可见。
- 一级展开后生成 context / think / 两个 tool 二级 chip；单独展开第一个 tool 时只显示对应 Pwsh 行，第二个 Read 行保持隐藏；一级重新收起后全部 chip/tool 隐藏，final 保持可见。
- 第二回合实际运行 10 秒 PowerShell。运行中采样到 `.dshcf-chip.running`、`Deep sleeping...`、`dshcf-shimmer` 和三个 `dshcf-dot-jump`；完成后生成 `已处理 16秒`。
- 刷新历史后仍恰有两条 collapsed 一级行，时长稳定为 24秒/16秒，两个 final 可见、三个 tool-call 隐藏、可见 chip 为 0；插件诊断 `active`、错误日志为空。
- 首次服务重启后的旧 tab 曾处于 web-runtime reconnect，未立即出现控件；干净重载后未复现。自诊断已保留，后续若宿主再次静默打断 pass，可直接从 style 节点与控制台定位。

## 增量修复：左栏会话切换

- 用户报告：从左侧会话列表切换后没有一级“已处理”，刷新后出现。
- 真实复现：刷新 `Calculating simple addition` 时有 3 条一级；切换到验证会话并等待 1.6 秒后，新的 flow 已有 14 个 `data-chat-flow-kind` 节点，但一级仍为 0；刷新才恢复。
- 根因：React detach 旧 flow 后，MutationObserver 的容器级 childList record 以旧 flow 的原父容器为 target；回调时旧 flow 已断连，原祖先链过滤同时判定两个方向都不相关，漏掉了唯一一次切换调度。
- 修复：当前 flow 为 disconnected 时无条件调度一次 pass，由 `findFlow()` 接管新 flow；fake DOM 支持传入真实 mutation records，并新增 body 级 flow 替换回归。
- 回归验证：新增场景不使用空 records 的 `env.tick()` 捷径，直接发送真实形态的 body childList record；旧实现会失败，新实现可生成新会话一级、清理旧插件行并保持 final 可见。`npm run check` 全套通过，40/40 排列仍收敛。
- 最终部署：备份 `client.js.backup-2026-08-15T11-47-14-764Z`，新 DSH PID `13768`，服务端 revision `b784aea36834`，bundle SHA-256 前缀 `9043c7da83b4`。
- 浏览器验证：刷新验证会话得到 2 条一级；不刷新切到 `Calculating simple addition`，新 flow 完整渲染后约 72ms 自动得到 3 条一级；再往返切换分别稳定为 2/3 条。所有一级默认收起，无可见 tool/chip，诊断为 `active`，浏览器错误日志为空。
