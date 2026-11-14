# AGENTS.md — dsh-auto-collapse 项目协作契约（薄入口 · 渐进披露）

> 本文件只保留**每次改动都必须遵守的铁律**、项目速览、与「什么时候该读哪份文档」的索引；
> 细节全部拆在 [docs/](docs/) 与 [behavior-spec.md](behavior-spec.md)，需要时再去查，不再自动塞进上下文。
> 全局约束（中文回答、审查只用后台 subagent 等）来自 `~/.dsh/AGENTS.md`；行为权威仍是 [behavior-spec.md](behavior-spec.md)，本文件不重复行为条款。

## 0. 铁律（每次改动都要遵守）

1. **每次改动必须递增版本号**：同步改 `package.json` 与 `package-lock.json`（根 `version` 与
   `packages[""].version` 两处），然后在 **[docs/changelog.md](docs/changelog.md) 顶部追加一节** ——
   写清：日期 / 版本 / 主题 / 根因 / 修法 / 验收证据（测试名 + 变异实测 + 真机取证）。
   版本号语义：破坏性契约变更 → minor；行为修复 / 新兼容 → patch；仅文档 → 也要 bump patch。
2. **基线先行**：动手前 `node test/run-all.mjs` 必须全绿；提交前依次跑
   `node build.mjs`（含 4 项守卫）→ `npx tsc --noEmit` → `node test/run-all.mjs`（当前 38 个测试文件）→ `git diff` 自查。
3. **测试必须有鉴别力**：新行为要配「改回旧实现 ⇒ 断言失败」的变异实测（在 docs/changelog.md 或
   commit 里写明变异体与被杀断言）。一次性写入的夹具天然没鉴别力——涉及插话 / 原生行展开态的用例必须走
   **真实用户时序**（先阶段 1、tick、再阶段 2）。构造与模板见 [docs/verification.md](docs/verification.md)。
4. **绝不改 DSH 宿主源码**（`~/.dsh/profiles/*/node_modules/@deepseek-ai/*` 与全局 npm 安装目录只读参考）。
   插件只读宿主 DOM 契约，并保持向后兼容（0.1.1-rc.x ~ 0.2.2-rc.1，宿主升级前先查 docs/adaptation-history.md）；契约细节见 [docs/host-contract.md](docs/host-contract.md)。
5. **部署不重启 dsh-web**（重启会中断正在跑的会话）：`node build.mjs` → 手动把 `lib/client.js` /
   `lib/index.js` / `package.json` 拷到 `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-auto-collapse\`（先备份）→
   `node deploy.mjs --verify`（只读校验服务端合并 bundle 是否已含新字节）→ 浏览器刷新。
   不要跑 `npm run deploy`（会重启服务，且登录态缺失时首页校验会失败）。
6. **只在 `dalcui` remote 上提交/推送**（唯一 remote；origin 已移除）。
7. **审查用后台 subagent**：每完成一小块就让 subagent 独立审查（只读），修完再复审，直到无功能性问题；
   subagent 禁止再起次级 subagent、禁止 memory 操作。

## 1. 项目速览

- 这是什么：DSH Web 客户端插件，把工具卡 / Think 块折叠成一行，只留模型说的话；附带轮次指标行
  （时长 / 次模型 / token / tok-per-s、上下文增量）。对外介绍见 [README.md](README.md)。
- 构建：`src/*.ts` → `lib/client.js`（esbuild 打包 IIFE）+ `lib/index.js`（host 半）。
  `lib/index.js` 必须是纯 JS（`build.mjs` 有 `node --check` 守卫）。
- 目录：`src/fold.ts` 折叠核心（最大）、`src/turn-metrics.ts` 指标注入器、`src/settings.ts` 设置卡、
  `src/index.ts` host 半、`test/` 桩 DOM 全量回归；`docs/` 按主题拆分细节，本文件只是薄入口。

## 2. 什么时候该读什么（渐进披露索引）

| 任务场景 | 先读 |
|---|---|
| 改折叠 / 展开驱动、任何碰宿主 DOM 的判定 | [docs/host-contract.md](docs/host-contract.md)（契约表 + 已知坑 + 0.2.2 追加） |
| 写 / 改测试、变异实测、真机取证、插话工况构造 | [docs/verification.md](docs/verification.md) |
| 裁决「特性 or bug」边界行为 | [behavior-spec.md](behavior-spec.md)（◆ 条款 / § 实现 / 验收权威） |
| 按符号定位模块、数据流、条款↔实现↔测试映射 | [docs/architecture.md](docs/architecture.md) |
| 用户可见特性 / 指标口径 / 设置项完整语义 | [docs/features.md](docs/features.md)（英文：docs/features.en.md） |
| 各宿主版本为什么这么改、真机验收史 | [docs/adaptation-history.md](docs/adaptation-history.md) |
| 每版改动记录（根因 / 修法 / 验收） | [docs/changelog.md](docs/changelog.md) |
| 本机部署 / 发布 / 热生效热更新操作细节 | [docs/how-to.md](docs/how-to.md) |
| 0.1.7 深档（DOM 快照 / 决策记录） | DOM_SNAPSHOT_0.1.7.md · DSH_0.1.7_ADAPTATION.md · ADAPTATION_PLAN_0.1.7.md |
| 设置保存链路 / 历史根因长档 | SAVE_ISSUE_ROOTCAUSE.md · ISSUE_ROOTCAUSE_2026_09_30.md · REVIEW_FINDINGS.md · REMAINING_ISSUES*.md |

## 3. 版本速查（一行版，详情见 docs/changelog.md）

- **0.3.8** 修 passive 回合被插件强行展开工具组：撤退只撤 chip/一级行，组折叠态交还宿主
- **0.3.7** 文档渐进披露重构：AGENTS/README 薄入口 + docs/ 细节拆分（本版，无代码行为变更）
- 0.3.6 段级 chip 只做重试记录开关，不再代表工具组；组徽标文案改「N 次工具」
- 0.3.5 每组工具数挂官方组标题末尾（`· N 次工具`），chip 去活动统计摘要
- 0.3.4 适配 DSH 0.2.2-rc.1：inject face 整体透传恢复指标注入；`data-holding` 不算在跑
- 0.3.3 / 0.3.2 复审收紧：补 3 处零覆盖变异、修注释漂移、passive 撤退还原组（**0.3.8 已撤销**）
- 0.3.1 插话进行中不折叠正文、实时行按回合归属、alwaysOpen 回合完全不介入
- 0.3.0 适配 0.2.1 会话流扩展位解包；0.2.x P1–P5 批次（见 ISSUE_ROOTCAUSE 长档）
