# 验证手段（测试 / 变异实测 / 真机取证）

桩 DOM 测试组织方式、变异实测模板与流程、真机取证（playwright-cli）与插话工况构造方法。改行为、写测试、取证前必读。
> 来源：自 [AGENTS.md](../AGENTS.md) §3 拆出（0.3.7 文档渐进披露重构）

---

## 手段

- 桩 DOM：`test/*.test.mjs`（`test/fake-dom.mjs` 提供 el/seat/组/工具行等），
  `node test/run-all.mjs` 自动纳入新 `*.test.mjs`。
- 变异实测：临时改回旧实现 → `node build.mjs` → 跑对应测试 → 确认断言失败 → 还原。
  `.playwright-cli/mutate3.mjs` 是现成模板（注意本仓库源码是 **CRLF**）。
- 真机取证：`playwright-cli -s=<session> open http://127.0.0.1:3080`；
  脚本放 `.playwright-cli/*.js`（`run-code --filename` 或 `eval` 传 `() => {…}`）。
  **插话工况怎么造**：新会话发一个含长 `Start-Sleep` 工具调用的提示词，
  运行中在输入框填插话内容后按 **Ctrl+Enter**（`mode:"steer"`；普通 Enter 只会排到
  下一回合）。插话节点会以 `data-chat-flow-kind="steering"` 出现在当前回合中间。

---
