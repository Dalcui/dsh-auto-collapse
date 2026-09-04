
## 结论：修复「没生效」的根因是 DSH 版本不匹配

最新提交 `be808af`（`fix: 适配 DSH 0.1.2-alpha.3 …`）是**为 DSH 0.1.2-alpha.3 写的**，但本机安装的 DSH 是 **0.1.2-alpha.4**。alpha.4 相对 alpha.3 又把聊天快照的 token 计费契约改了一轮，而 `be808af` 的指标注入器只适配到了 alpha.3，没有适配 alpha.4 —— 所以「轮次折叠行指标」在 alpha.4 上仍然断链。

### 已确认的事实（都验证过，非猜测）

1. **修复确实部署了**：部署目录 `~/.dsh/profiles/web/node_modules/dsh-auto-collapse/lib/client.js` 与仓库 HEAD 的 `lib/client.js` 逐字节一致（仅 CRLF/LF 差异，git blob 哈希相同 `fd02e25a`）。所以不是「没重新 build/deploy」。
2. **指标注入器能装上**：`connection` 服务在 alpha.4 仍存在（未改名）、`slots.entries()` 返回的 `StoredEntry` 仍有 `options`/`component` 字段（没改名）、`resolveBuiltinAssistant` 能命中内置 `assistant-step` 并成功注册 `priority:-1` 阴影渲染器。排除了「inject 抛错 → 注入器整体未安装」这条链路。
3. **服务端日志无注入器报错**：`guard/logs` 下的 web out/err 日志里，`dsh-auto-collapse`/`metrics injector`/`Rules of Hooks`/`connection` 全部 0 命中（9/2 的 playwright 浏览器控制台里的 roster `ERR_CONNECTION_REFUSED` 是当时 web 没起时的客户端错误，与本次无关）。

### 具体断点：token 计费契约变了（类型层 + 权威位置）

子代理读 alpha.4 的类型声明与运行时 bundle 后确认：

| 项目 | alpha.3（`be808af` 所适配） | alpha.4（本机实际） |
|---|---|---|
| 快照 `nodes` | `Map` | `ChatNodeStore` 接口（有 `.get()`，用法兼容） |
| `legacy.turnTimings` | Map | 仍是 `ReadonlyMap`（耗时读取没断） |
| assistant-step 的 token 来源 | `data.usage.inputTokens` | 类型上 `usage: unknown`（`chat-nodes.d.ts:28`），**权威 token 计数迁到 `turn-tail.data.tokenUsage`** |
| 输入 token 字段名 | `inputTokens` | **`uncachedInputTokens`**（`chat-nodes.d.ts:57`，已改名） |
| `cacheRead/cacheWrite/reasoning` | 在 usage 上 | 移到 `TurnTokenUsage` 上且全为可选 |

而插件 `src/turn-metrics.ts` 的 `computeTurnMetrics` 仍是老逻辑：遍历 `order` → `nodes.get(key)` → 对 `assistant-step` 读 `n.data.usage.inputTokens / cacheReadTokens / cacheWriteTokens / outputTokens / reasoningTokens`，对 `turn-tail` 读 `n.data.tokensPerSecond`。这与 alpha.4 的计费模型脱节。

### 一个诚实的补充（运行时层面）

运行时追踪子代理进一步发现：alpha.4 的 `projectAssistant` 目前**仍是原样透传** `state.usage`（即 dsh-llm 的原始 `TokenUsage`，含 `inputTokens`），所以 `n.data.usage.inputTokens` 在运行时**当前仍可能读得到数字**，类型声明的 `unknown` 只是「不再承诺」而非「运行时已删字段」。这意味着：

- 类型层是明确的断链（`usage: unknown`，权威字段已改名+迁移）；
- 运行时 token 值当前可能侥幸可读，但这是 alpha.4 没删字段的偶然结果，不属于稳定契约，随时会在后续 alpha.4.x 补丁里失效。

### 修复方向（供后续落地）

1. 让指标注入器按 alpha.4 计费模型读取：token 优先从 `turn-tail` 节点的 `data.tokenUsage` 取，输入 token 用 **`uncachedInputTokens`**（并注意 `outputTokens/totalTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens` 均为可选）；`assistant-step.data.usage` 只作回退。
2. `nodes` 已从 `Map` 变 `ChatNodeStore`：虽然 `.get(key)` 兼容，但应停止把它强转 `Map<string, any>`，改按 `ChatNodeStore` 接口调用，避免后续 API 再变。
3. 版本探针：在 host/客户端加 DSH 版本探测，按 `0.1.2-alpha.3` 与 `0.1.2-alpha.4+` 分别走快照形状分支，而不是假设单一形状。

需要的话我可以直接按上述方向改 `src/turn-metrics.ts` 并补一个 alpha.4 快照形状的回归测试。