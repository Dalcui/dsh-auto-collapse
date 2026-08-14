# dsh-auto-collapse

> DeepSeek Harness Web 客户端插件：把会话里的工具卡片与 Think 推理块自动折叠成一行摘要，让界面只保留模型说的话。
>
> English: [README.en.md](./README.en.md)

## 这是什么

`dsh-auto-collapse` 是一个纯前端 DOM 插件，挂在 DeepSeek Harness Web（`http://127.0.0.1:3080`）聊天界面上。它不改动消息内容，只控制工作流程的显示状态：

- **回合完成自动收起**（一级）：每个回合完成后，工作过程收成一行 `已处理 X秒`，只留模型最终正文；点击展开完整工作流程（上下文注入 → 思考 → 工具调用 → 过程正文 → 最终正文）。
- **二级折叠行**：展开一级后，工具调用组与思考块各自折叠成一行 chip（`正在运行 {命令}` / `运行了命令` / `已思考`），点击展开/收起；相邻工具组合并，正文输出是硬边界（不会跨正文合并）。
- **三级思考合并**：展开 `已思考` 后，连续思考合并为一个三级思考行（标题 `Think · 第一句`），点击展开合并内容块；原始四级行不出现。
- **原生视觉对齐**：图标盒 16px / glyph 14px / 行高 24px / 行距 16px，颜色使用 DSH 原生 token（`--dsw-alias-label-*`），思考与命令图标取自 DSH 原生图标（`IconThinkOutline14` / `IconApiOutline14`）。
- **流式友好**：思考摘要逐帧更新不触发 DOM 自激循环；running 动画只做 scale/opacity（不参与布局）；`prefers-reduced-motion` 下停止动画。
- **可逆**：卸载（HMR stop）时完整还原所有折叠/隐藏/改写。

## 安装

```bash
npm run build          # 构建 lib/client.js
npm pack --pack-destination C:/Users/a179/.dsh/plugins
# 在 ~/.dsh/profiles/web/package.json 的 dependencies 引用新 tgz：
#   "dsh-auto-collapse": "file:C:/Users/a179/.dsh/plugins/dsh-auto-collapse-0.1.0.tgz"
cd C:/Users/a179/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh
node lib/bin.js plugin --profile web install   # 重装插件
node lib/bin.js web                             # 重启服务（包名/rev 变更后必须）
```

刷新页面（`Ctrl+Shift+R` 硬刷新绕过浏览器缓存）即可生效。

## 配置

无需配置。插件的挂载由包内 `cordis.patch.yml` 提供（profile 层无需重复 insert）。

## 项目结构

```
src/fold.ts       核心：FoldController（状态机）+ findBlocks（块识别）+ 折叠/展开逻辑
src/client.ts     浏览器端入口（注册插件）
src/index.ts      host half
build.mjs         esbuild 构建（lib/client.js 的注册 id 在 banner 里）
cordis.patch.yml  profile 树挂载
```

## 关键机制

- **块识别**（`findBlocks`）：顶层消息元素按"工具组 / 纯思考消息 / 正文消息"分类；正文是硬边界，`Think1-正文-Think2` 的 Think2 作为遗留行并入下一个堆积块，不会跨正文合并。
- **一级收起**：`turn-tail` / 新用户消息 / steering 是回合边界；完成态只保留真正含正文的最终宿主，无正文的工具/思考宿主整块隐藏（消除"已处理"与正文之间的空白）。
- **时长**：流式回合用 `turnStartMs` 实时计时；历史回合从 `timeStart`（回合开始）到 turn-tail（结束）的差值解析；支持 `X秒` / `X分Y秒` / `X小时Y分`。
- **React 共存**：所有行/宿主引用在 pass 中现取，点击处理器不持有闭包旧引用；插件节点被 React 重渲染清掉后自愈重建。

## 许可

MIT
