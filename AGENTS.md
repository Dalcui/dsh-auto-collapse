# AGENTS.md — dsh-auto-collapse 项目级约定与版本史

> 本文件是**本仓库**的协作契约 + 版本变更记录。全局约束（中文回答、审查只用后台 subagent
> 等）来自 `~/.dsh/AGENTS.md`；这里只记项目特有、且每个改动都必须遵守的规则。
> 行为权威仍是 [behavior-spec.md](behavior-spec.md)；本文件不重复行为条款。

---

## 0. 铁律（每次改动都要遵守）

1. **每次改动必须递增版本号**：同步改 `package.json` 与 `package-lock.json`（根
   `version` 与 `packages[""].version` 两处），然后**在下面「版本变更记录」追加一节**
   —— 写清：日期 / 版本 / 主题 / 根因 / 修法 / 验收证据（测试名 + 真机取证）。
   版本号语义：破坏性契约变更 → minor；行为修复 / 新兼容 → patch；仅文档 → 也要 bump patch。
2. **基线先行**：动手前 `node test/run-all.mjs` 必须全绿；提交前依次跑
   `node build.mjs`（含 4 项守卫）→ `npx tsc --noEmit` → `node test/run-all.mjs`
   （当前 37 个测试文件）→ `git diff` 自查。
3. **测试必须有鉴别力**：新行为要配「改回旧实现 ⇒ 断言失败」的变异实测（在
   `AGENTS.md`/commit 里写明变异体与被杀断言）。一次性写入的夹具天然没鉴别力——
   涉及插话 / 原生行展开态的用例必须走**真实用户时序**（先阶段 1、tick、再阶段 2）。
4. **绝不改 DSH 宿主源码**（`~/.dsh/profiles/*/node_modules/@deepseek-ai/*` 与全局
   npm 安装目录只读参考）。插件只读宿主 DOM 契约，并保持向后兼容（0.1.2 ~ 0.2.1）。
5. **部署不重启 dsh-web**（重启会中断正在跑的会话）：`node build.mjs` → 手动把
   `lib/client.js` / `lib/index.js` / `package.json` 拷到
   `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-auto-collapse\`（先备份）→
   `node deploy.mjs --verify`（只读校验服务端合并 bundle 是否已含新字节）→ 浏览器刷新。
   不要跑 `npm run deploy`（会重启服务，且登录态缺失时首页校验会失败）。
6. **只在 `dalcui` remote 上提交/推送**（唯一 remote；origin 已移除）。
7. **审查用后台 subagent**：每完成一小块就让 subagent 独立审查（只读），修完再复审，
   直到无功能性问题；subagent 禁止再起次级 subagent、禁止 memory 操作。

---

## 1. 项目速览

- 这是什么：DSH Web 客户端插件，把工具卡 / Think 块折叠成一行，只留模型说的话；
  附带轮次指标行（时长 / 次模型 / token / tok-per-s、上下文增量）。
- 构建：`src/*.ts` → `lib/client.js`（esbuild 打包 IIFE）+ `lib/index.js`（host half）。
  `lib/index.js` 必须是纯 JS（`build.mjs` 有 `node --check` 守卫）。
- 目录：`src/fold.ts` 折叠核心（最大）、`src/turn-metrics.ts` 指标注入器、
  `src/settings.ts` 设置卡、`src/index.ts` host 半、`test/` 桩 DOM 全量回归。
- 文档：`behavior-spec.md`（行为条款 ◆ / § 实现 / 验收）、`README.md`（对外说明 +
  适配史）、`DOM_SNAPSHOT_0.1.7.md` / `DSH_0.1.7_ADAPTATION.md`（0.1.7 规格）。

## 2. 宿主 DOM 契约要点（改折叠前先读）

| 契约 | 0.1.7 ~ 0.2.0 | 0.2.1-rc.2 |
|---|---|---|
| 流容器 | 列 `[data-chat-flow]` 的直接子级 | 列 > `div[data-slot="conversation.chat.flow"]`（`display:contents`）的直接子级 |
| 原生回合行 | `button[data-turn-process]`，展开态 = `aria-expanded="true"` | 同上，但展开态看 **`data-open`**；`aria-expanded` 只在 `hasContent` 时写 |
| 官方工具组 | `div[data-step-process]` 不透明容器：只读属性/内部行、只驱动组头按钮、绝不写 style、绝不插节点 |
| 组折叠态 | 组头按钮 `button[data-process-activity]` 的 `aria-expanded` | 同左 |
| alwaysOpen（插件完全不介入） | `aria-expanded==='true' && disabled` | `data-open && disabled`（插话回合 `hasContent=false` ⇒ 无 aria-expanded） |

已知坑：`[hidden="until-found"]` 的 `computed display` 是 none 但 `style.display` 为空；
不要用 `aria-expanded=""` 判定；chip 只能挂 `turn-process` 座位内部（不能进
`column.children` 二分序列）。

## 3. 验证手段

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

## 4. 版本变更记录

### 0.3.1 — 2026-10-22 · 插话进行中：正文不隐藏、指标行回到顶部、alwaysOpen 回合撤退

- **主题**：修复「插话发送时，被插话轮次的非最后一条正文全被隐藏，且轮次指标行与次级
  工具折叠行位置颠倒」，并顺带修掉同源的「插话回合结束后仍残留折叠 chip」。
- **真机症状（DSH 0.2.1-rc.2，playwright 取证，插话=运行中 Ctrl+Enter）**：
  - 插话刚送达、模型仍在跑时：段 A 的中间正文 `display:none`；`dshcf-processed`
    （指标行）出现在段级 chip **下方**（chip 挂在 turn-process 座位内 = 回合顶部）；
  - 回合闭合后：原生 `button[data-turn-process]` 为 `data-open + disabled`（alwaysOpen），
    插件却仍建 chip、驱动工具组收起、隐藏 model-retry 行（违反「插件完全不介入」）。
- **根因**：
  1. `buildSegments` 里「段被 `steering` 边界收尾」被当成「回合已完成」⇒ 该段立即进入
     已完成结算：建一级行 + 隐藏 `middleSteps` + 建段级 chip。但插话是**排队**机制，
     回合本身还在 running（`data-chat-running` 在）。
  2. 0.2.1 把原生行的展开态从 `aria-expanded` 改为 `data-open`；插话回合
     `hasContent = !interleavedInput && …` 恒 false ⇒ 官方不写 aria-expanded ⇒ 旧 passive
     判据 `aria-expanded==='true' && disabled` 恒假，插件在 alwaysOpen 回合上继续介入。
- **修法**（`src/fold.ts`）：
  - 新增 `provisionalSegmentKeys()`：被 steering 收尾、且其回合尚无结束证据
    （后续 `turn-tail`/`user` 边界或 `terminated`）且仍有未闭合段 / `[data-chat-running]`
    的段 = **临时段**。临时段不建 SegmentState（⇒ 无一级行、无 chip、正文/状态行不被
    一级折叠隐藏）；段级组仍按直播语义驱动。
  - `syncLiveRows` 改为**按回合归属**：一个回合只保留一条实时行，所有者 = 该回合最后一个
    「有工作」的临时段/未闭合段（插话刚送达时所有者仍是上一段 ⇒ 实时行原地不动）。
  - 新增 `nativeTurnRowOpen()`：`data-open` 优先（显式排除 `"false"`，防官方改写渲染形态）、
    `aria-expanded` 兜底；passive 判定、`toggleExpandAll` 均改用它。
    MutationObserver `attributeFilter` 补 `data-open`。
  - passive 段与「段转直播/消失」路径都主动 `dropSegmentChip`（不留孤儿 chip）。
- **验收**：
  - 新增 `test/fold-steer-live.test.mjs`（8 场景 28 断言）：A 插话进行中、B data-open
    passive、C 旧版 aria passive 不回归、D 多次插话单实时行、E 回合结束后恢复折叠、
    F 插话紧跟 turn-tail、G 原生行转 passive 撤销遗留 chip、H `data-open="false"` 不得
    被误读为展开（防官方未来改写成 `data-open={open}`）。
  - 变异实测（`.playwright-cli/mutate3.mjs` / `mutate5.mjs`）：M1 回退临时段跳过 ⇒ 4 FAIL；
    M2 回退 data-open ⇒ 2 FAIL；M3 回退临时段实时行 ⇒ 4 FAIL；M4 回退 passive chip 撤销 ⇒
    1 FAIL；M5 把 `data-open` 改成裸 `hasAttribute` ⇒ 1 FAIL。
  - 真机（3080，真实插话会话）：插话进行中只剩 `dshcf-processing`（无 chip/无一级行）、
    段 A 正文可见、实时行位于 turn-process 座位之后；回合闭合后 rows=[]、全部正文可见、
    原生行拿到 `.dshcf-native-metrics`。
  - 全仓 37 个测试文件全绿 + typecheck 零错误 + build 四守卫通过。
- **兼容**：0.1.2 ~ 0.2.0 无 `data-open` 时回退 `aria-expanded`，行为不变；
  无 steering 的工况不产生任何临时段，路径与 0.3.0 逐字一致。

### 0.3.0 — 2026-10-19 · 适配 DSH 0.2.1 会话流扩展位

- 0.2.1 把会话列的全部流子级包进 `div[data-slot="conversation.chat.flow"]`
  （`display:contents`），官方读顶层行同口径解包。插件新增
  `flowContentOf` / `flowContentRootOf`，所有以流为键的缓存与失效统一同键；
  `isFlowVisible` 沿祖先链回退。修复「整会话被当成一个巨型块 / 指标注入整体失效」。
- 验收：`test/fold-flow-slot.test.mjs`（8 场景 18 断言）+ 真机 5 回合取证。

### 0.2.0-rc.2 — 2026-09-30 · 按 ISSUE_ROOTCAUSE 的 P1–P5 批次

- 详见 `ISSUE_ROOTCAUSE_2026_09_30.md`、`REMAINING_ISSUES*.md`、`SAVE_ISSUE_ROOTCAUSE.md`：
  直播段状态行收敛、`partition.last` 流粒度、tps/ttft 自算、设置保存 volatile ref 链路。