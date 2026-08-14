# dsh-auto-collapse

> DeepSeek Harness Web 客户端插件：把会话里的工具卡片与 Think 推理块自动折叠成一行摘要，让界面只保留模型说的话。
>
> English: [README.en.md](./README.en.md)

## 这是什么

`dsh-auto-collapse` 是一个纯前端 DOM 插件，挂在 DeepSeek Harness Web 聊天界面上，**同时将"Deep diving" 修改为 "Deep sleeping"**。它不改动消息内容，只控制工作流程的显示状态：

- **回合完成自动收起**（一级）：每个回合完成后，工作过程收成一行 `已处理 X秒`，只留模型最终正文；点击展开完整工作流程（上下文注入 → 思考 → 工具调用 → 过程正文 → 最终正文）。
- **二级折叠行**：展开一级后，工具调用组与思考块各自折叠成一行 chip（`正在运行 {命令}` / `运行了命令` / `已思考`），点击展开/收起；相邻工具组合并，正文输出是硬边界（不会跨正文合并）。
- **三级思考合并**：展开 `已思考` 后，连续思考合并为一个三级思考行（标题 `Think · 第一句`），点击展开合并内容块；原始四级行不出现。
- **原生视觉对齐**：图标盒 16px / glyph 14px / 行高 24px / 行距 16px，颜色使用 DSH 原生 token（`--dsw-alias-label-*`），思考与命令图标取自 DSH 原生图标（`IconThinkOutline14` / `IconApiOutline14`）。
- **流式友好**：思考摘要逐帧更新不触发 DOM 自激循环；running 动画只做 scale/opacity（不参与布局）；`prefers-reduced-motion` 下停止动画。
- **可逆**：卸载（HMR stop）时完整还原所有折叠/隐藏/改写。

## 安装

```bash
dsh plugin --profile web add "github:a179-sanae/dsh-auto-collapse#main"
```

安装后重启 DSH web 服务（或触发插件 HMR），页面 `Ctrl+Shift+R` 硬刷新即可生效。插件的挂载由包内 `cordis.patch.yml` 提供，profile 层无需重复 insert。

## 配置

无需配置。

## 开发

### 项目结构

```
src/fold.ts       核心：FoldController（状态机）+ findBlocks（块识别）+ 折叠/展开逻辑
src/client.ts     浏览器端入口（注册插件）
src/index.ts      host half
build.mjs         esbuild 构建（lib/client.js 的注册 id 在 banner 里）
deploy.mjs        快速部署：build → 覆盖已安装副本 → 重启服务 → 验证
cordis.patch.yml  profile 树挂载
```

### 快速部署（本机开发）

```bash
npm run deploy
```

构建并直接覆盖本机已安装副本、重启服务、验证服务端 bundle。路径常量在 `deploy.mjs` 顶部，换机器按需修改；本机无 DSH 安装时不适用。

### 发布新版本

```bash
npm pack --pack-destination <本地插件目录>   # 打包（prepack 钩子自动构建）
```

将 profile 的 `package.json` 中插件依赖更新为新 tgz 路径后重新安装插件。

### 关键机制

- **块识别**（`findBlocks`）：顶层消息元素按"工具组 / 纯思考消息 / 正文消息"分类；正文是硬边界，`Think1-正文-Think2` 的 Think2 作为遗留行并入下一个堆积块；流末尾无堆积块时并入宿主消息的块，完成态不残留可见思考行。
- **一级收起**：`turn-tail` / 新用户消息 / steering 是回合边界；完成态只保留真正含正文的最终宿主，无正文的工具/思考宿主整块隐藏（消除"已处理"与正文之间的空白）。
- **时长**：流式回合用 `turnStartMs` 实时计时；历史回合从 `timeStart`（回合开始）到 turn-tail（结束）的差值解析；格式 `X秒` / `X分Y秒`，整分省略秒位（`15分00秒` → `15分`），小时级 `X小时` / `X小时Y分`。
- **React 共存**：块/行引用每轮 pass 刷新，click 处理器通过每轮更新的块绑定工作（不持有跨轮引用）；插件节点被 React 重渲染清掉后自愈重建。

## 许可

MIT
