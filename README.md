# dsh-auto-collapse

> DeepSeek Harness Web 客户端插件：把会话里的工具卡片与 Think 推理块自动折叠成一行摘要，让界面只保留模型说的话。增强版集成了回合级指标摘要栏（耗时 / token 用量 / tok/s 等，配置可控）。
>
> **核心原则：整个执行过程能分层级、量化地展示。** 模型正文之外的一切系统信息（思考 / 工具调用 / 上下文注入 / 重试等状态行）都按「类别 × 数量」折叠成可展开的行，进行中最新的活动保持可见。
>
> English: [README.en.md](./README.en.md)

## 这是什么

`dsh-auto-collapse` 是一个纯前端 DOM 插件，挂在 DeepSeek Harness Web 聊天界面上，把工作流程折叠成一行行摘要——工具调用、推理过程不再占据整屏，呈现接近 VSCode Codex 桌面端的折叠体验，**同时将“Deep diving” 修改为可配置的“Deep sleeping...”**。它不改动消息内容，只控制工作流程的显示状态。

## 效果预览

![折叠效果](assets/screenshot.png)

## 特性

- **回合完成自动收起**（一级）：每个回合完成后，工作过程收成一行 `已处理 X秒`，只留模型最终正文；点击展开完整工作流程（上下文注入 → 思考 → 工具调用 → 过程正文 → 最终正文）。
- **进行中实时摘要行**：回合进行中，工作流最顶端显示一条实时摘要行（`已工作 X秒 | 工具调用 / tokens…`），带运行呼吸点、耗时每秒走表，只实时统计、不打断流式输出；回合完成后由可点击的一级行接管。对齐 dsh-turn-fold 的 running summary。
- **二级折叠行**：展开一级后，工具调用组与思考块各自折叠成一行 chip（`正在运行 {命令}` / `运行了命令` / `编辑了文件` / `已思考` / `上下文注入`），点击展开/收起；相邻工具组合并，正文输出是硬边界（不会跨正文合并）。**正文之间不同类别的系统信息跨类别合并折叠**：think + 工具 + 上下文注入 + model-retry 等状态行合成一个 chip，chip 标注各自类别×数量（如 `2 段思考 · Bash ×2 · 2 次上下文注入 · 1 次重试`）。**仅相邻 ≥2 条非正文内容才折叠**：单条工具调用 / 单段思考 / 单条上下文注入保留原生行展示，不生成 chip。
- **二级 chip 分层粒度计数**：完成态 chip 收起时展示各类别×数量（`N 段思考 · 工具名 ×次数 · N 次上下文注入 · N 次重试`，如 `Bash ×2 · Read ×1`），工具名按**数量降序**排列、并列保持首次出现顺序，有失败时追加浅红 `K 个失败`。对齐 dsh-turn-fold 的 activityGroup。
- **PTC（run_code）子工具名展示**：PTC 模式下单个 `Code` 卡内编排多个工具调用时，只要 dsh 系统解析出 1 个及以上具体工具名（`Code` 与子工具占 2 行+），就对其折叠；折叠行优先按解析出的子工具名 × 数量展示实际使用的工具（如 `Bash ×2 · Read ×1`），未获取到系统解析的实际工具名时才用 `Code` 兜底。收起态末尾仍追加该折叠中最后一次工具调用的 `description` 参数。
- **进行中保持最新内容可见**：回合进行中时，含 running 行的二级块强制展开（原生工具卡/思考行实时可见），回合闭合后回到默认收起——即「会话进行中始终保持最后一条内容不折叠」。
- **三级思考合并**：展开 `已思考` 后，连续思考合并为一个三级思考行（标题 `Think · 第一句`），点击展开合并内容块；原始四级行不出现。
- **原生视觉对齐**：图标盒 16px / glyph 14px / 行高 24px / 行距 16px，颜色使用 DSH 原生 token（`--dsw-alias-label-*`），思考与命令图标取自 DSH 原生图标（`IconThinkOutline14` / `IconApiOutline14`）。
- **展开/收起过渡动画**：点击驱动的展开（淡入 + 4px 上移，合并思考正文带高度展开）与收起（镜像淡出，后代随祖先 seat 整体消失、无跳变）均为 180ms；仅用户点击触发动画，流式协调器决策保持瞬时。
- **流式友好**：同一个 `assistant-step` 原地补正文、React 换节点和历史乱序挂载都会重新协调；running 状态带文字平滑呼吸动画，`prefers-reduced-motion` 下停止动画（过渡动画同样禁用）。
- **完整工作类型**：除 tool-call 外，顶层 `command` / `manual-compaction`、context 和纯图片 final 都按同一回合语义处理。
- **回合级状态行折叠**：DSH 原生的重试/失败/超限状态行（"已重试模型请求"、终态失败"出错了"、"已达到输出 token 上限"）随段折叠隐藏；落在工具组之间或工具组上一行的吸收进该二级 chip 一起折叠，被正文隔开的只随一级折叠。
- **异常终止也折叠**：回合被手动停止或异常中断、却没有正常 `turn-tail` 边界时（已停止的 tool 行 / 终态失败 / 输出上限），同样生成一级行折叠工作过程，停止态追加"已停止"标签。
- **可配置状态提示词**：在 设置 → 插件 → 插件配置 中可以编辑“状态提示词”，默认 `Deep sleeping...`；留空保存后恢复官方 `Deep diving...`。
- **回合级指标摘要栏**：回合完成后摘要行显示可配置的指标（耗时、工具调用次数、模型调用次数、输入/输出/推理 tokens、缓存命中/写入 tokens、缓存命中率、tok/s、首 token 用时），数据通过 shadow 渲染器从 React 会话快照直接获取并**按记录复现**（耗时用 `turnTimings`、token 用 `node.data.usage`），精确可靠、不依赖实时结果。
- **可配置指标字段**：在 设置 → 插件 → 插件配置 的"摘要栏指标"输入框中，用逗号分隔字段名控制显示哪些指标；默认显示 耗时 / 次模型 / 次工具 / 输入 / 缓存命中 / 命中率 / 输出 / 上下文增量。每个字段名后可用 `(自定义名)` 覆盖显示名，如 `inputTokens(输入上下文)`；可选字段含 `contextDelta`（本轮新增上下文 = 本回合最后一次模型调用输入 token − 上一回合最后一次模型调用输入 token；首回合基线取 0，即等于本轮末输入）。
- **中断安全按轮次匹配**：指标按 `sessionId:turn` 从注入器模块级存储精确读取（main↔subagent 各会话隔离，不会同名 turn 串扰），而非 DOM 位置就近匹配；turn 归属优先 turn-tail 原生 `data-turn-tail`。手动停止→发送新消息、执行中插话、切换会话，各轮次统计互不串扰、进行中计时不归零。
- **状态标签**：回合被停止或中断时摘要栏追加"已停止"/"已中断"标签。
- **交互感知**：键盘焦点或文本选择位于回合活动内容中时保持展开。
- **状态持久化**：展开/收起状态通过 localStorage 持久化。
- **无障碍 ARIA 标签**：折叠行和 chip 均带 `aria-expanded` / `aria-label`。
- **双语支持**：根据 DSH Web 语言设置自动切换中英文摘要文案。
- **不依赖 dsh-harmony**：纯客户端插件，使用 DSH 原生 `slots.register` shadow 机制获取 React 数据。
- **可逆**：卸载（HMR stop）时完整还原所有折叠/隐藏/改写。

## 安装

已发布 npm 包（推荐，使用构建好的版本）：

```bash
dsh plugin --profile web add "dsh-auto-collapse"
```

从 GitHub 安装（开发版或需要跟随 `main` 分支时）：

```bash
dsh plugin --profile web add "github:a179-sanae/dsh-auto-collapse#main"
```

安装后重启 DSH web 服务（或触发插件 HMR），页面 `Ctrl+Shift+R` 硬刷新即可生效。无需任何配置。

## 开发

### 项目结构

```
src/fold.ts          核心：FoldController（状态机）+ findBlocks（块识别）+ 折叠/展开逻辑 + 指标提取
src/turn-metrics.ts  回合指标注入器：shadow 渲染器从 React 会话快照获取 token 用量/耗时/tok/s
src/client.ts        浏览器端入口（注册插件 + 指标注入器）
src/settings.ts      插件配置卡片（状态提示词 + 摘要栏指标配置）
src/locales.ts       中英文双语支持
src/index.ts         host half
build.mjs         esbuild 构建（lib/client.js 的注册 id 在 banner 里）
deploy.mjs        安全部署：校验 → 备份 → 替换 → 身份核验重启 → 哈希验证/回滚（DSH web 输出持久化到 ~/.dsh/logs/web.{out,err}.log）
cordis.patch.yml  profile 树挂载
test/             fake DOM 契约、竞态、会话切换与 40 组乱序排列回归
```

### 检查

```bash
npm run check
```

依次执行 TypeScript 检查、构建和全部回归测试。

### 快速部署（本机开发）

```bash
npm run deploy
```

脚本先核验插件/DSH 包名和 3080 监听进程身份，再做时间戳备份、替换、重启与服务端哈希验证；失败自动恢复旧 bundle。可用 `DSH_AUTO_COLLAPSE_LIB`、`DSH_DIR`、`DSH_WEB_PORT`、`DSH_LOG_DIR` 覆盖默认路径。

### 发布新版本

更新 `package.json` 中的 `version` 后，发布到 npm（`prepack` 钩子会自动构建）：

```bash
npm publish --access public
```

本机开发也可以只打包为 tgz：

```bash
npm pack --pack-destination <本地插件目录>
```

将 profile 的 `package.json` 中插件依赖更新为新 tgz 路径后重新安装插件。

### 关键机制

- **块识别**（`findBlocks`）：顶层节点按 tool-call、command/manual-compaction、context、thinking 和正文分类；user/steering/turn-tail 是不可跨越的硬边界。
- **segment 协调**：每轮根据当前 DOM 顺序重建 segment；最后一个含文本或媒体的 `assistant-step` 是 final，其余正文是中间过程。稳定 flow/key 复用展开状态，不依赖一次性 mutation 事件。
- **时长**：流式回合按 segment 分别记录 running 起点；历史回合从官方时长或 `timeStart`/turn-tail 解析。格式 `X秒` / `X分Y秒`，整分省略秒位。
- **React 共存与可逆性**：节点替换后按稳定 key 重新绑定；一级行被移除会按原展开状态重建；所有 inline `display` 在首次改写前保存并精确恢复。

## 许可

MIT
