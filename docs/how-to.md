# 部署、发布与热更新（操作细节）

本机开发常用操作与「为什么不能直接 npm run deploy」的完整说明。协作铁律以 [AGENTS.md](../AGENTS.md) 为准。
> 来源：自 [README.md](../README.md) §安装 / §开发 与 [README.en.md](../README.en.md) §Checks/§Quick deploy/§Publishing 拆出（0.3.7 文档渐进披露重构）；英文热更新机制单份在 [docs/features.en.md](features.en.md)

---

## 检查


```bash
npm run check
```

依次执行 TypeScript 检查、构建和全部回归测试。

## 本机快速部署（⚠️ 会重启 dsh-web）

> **注意**：日常部署请按 AGENTS.md 铁律 5 走「build → 手动拷贝 → deploy.mjs --verify → 浏览器刷新」，
> **不要**直接运行 `npm run deploy`——它会重启服务（中断正在跑的会话），且本项目 DSH web 需登录、
> 无登录态时脚本的首页校验会失败。以下内容是该脚本自身行为的说明（历史保留）。


```bash
npm run deploy
```

脚本先核验插件/DSH 包名和 3080 监听进程身份，再做时间戳备份、替换、重启与服务端哈希验证；失败自动恢复旧 bundle。可用 `DSH_AUTO_COLLAPSE_LIB`、`DSH_DIR`、`DSH_WEB_PORT`、`DSH_LOG_DIR` 覆盖默认路径。

## 发布新版本


更新 `package.json` 中的 `version` 后，发布到 npm（`prepack` 钩子会自动构建）：

```bash
npm publish --access public
```

本机开发也可以只打包为 tgz：

```bash
npm pack --pack-destination <本地插件目录>
```

将 profile 的 `package.json` 中插件依赖更新为新 tgz 路径后重新安装插件。

## 插件启停与热更新

**插件启停热生效**：本插件自带 roster 看门狗（node 侧 `/dsh-auto-collapse/roster` 探针 + 浏览器侧 1.5s 轮询）。

- **禁用任意客户端插件**：热生效——持有本 bundle 的已打开页面会在约 1.5–3s 内自动刷新并移除该插件的 UI，不需要重启 dsh web 服务，也不需要手动刷新。
- **重新启用本插件**：只有仍持有旧 bundle（禁用后尚未自动刷新的窗口期）的页面会自动恢复；已按禁用刷新过的页面不再装载本 bundle，需手动刷新一次。
- 3s 防风暴窗口内连续切换多个插件时，重载按 ≥3s 间隔排队收敛到最新状态（最多 3s 一次自动刷新，最终状态与最后一次切换一致）。

DSH 服务端本身对启停就是热生效的（watchUserPatches + dsh-client-modules 模块图重构），本机制补上的是浏览器侧的最后一步。

**代码更新无需重启服务**：更新本插件不需要重启 dsh web 服务——client half（`lib/client.js`）`npm run build` 后替换 `node_modules/dsh-auto-collapse/lib/client.js`（或 `dsh plugin --profile web update dsh-auto-collapse` 重新安装），由 DSH 官方 `dsh-client-hmr` 把 bundle 内容变化（rebuilt 帧）热替换到已打开页面（未启用 HMR 时 `Ctrl+Shift+R` 硬刷新即可）；host half（`lib/index.js`）改动由 DSH 服务端 `cordis-plugin-hmr` + `watchUserPatches` 热应用。仅当 host half 出现纯 JS 语法错误（DSH 加载 .js 不做类型剥离）导致插件树加载失败时，才需要修复后重启——`npm run build` 内置的 `node --check` 守卫会在构建期拦截此类回归。

---

## English: checks / deploy / publish (verbatim from legacy README.en.md)

### Checks

```bash
npm run check
```

Runs TypeScript checking, a fresh build, and the complete regression suite.

### Quick deploy (local dev)

```bash
npm run deploy
```

Validates the plugin/DSH package identities and the process listening on port 3080, then creates a timestamped backup, replaces the bundle, restarts DSH, and verifies the served hash. Failures restore the old bundle. Override defaults with `DSH_AUTO_COLLAPSE_LIB`, `DSH_DIR`, `DSH_WEB_PORT`, and `DSH_LOG_DIR`.

### Publishing a new version

Update the `version` in `package.json`, then publish to npm (the `prepack` hook builds automatically):

```bash
npm publish --access public
```

For local development, you can pack a tgz without publishing:

```bash
npm pack --pack-destination <local-plugin-dir>
```

Point the plugin dependency in the profile's `package.json` to the new tarball and reinstall the plugin.
