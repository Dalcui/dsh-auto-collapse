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

### 0.3.3 — 2026-10-22 · 第二轮复审收紧：补 3 处零覆盖 + 修 3 处注释漂移

- **背景**：0.3.2 后第二轮独立复审（no-build 逐文件 runner 跑全仓变异，避免 run-all 先 build
  覆盖变异体）确认**无阻断缺陷**，指出 3 处测试零覆盖、3 处注释与实现漂移、1 处 0.3.0 起的
  段边界缺陷。本轮处理前两项（第三项见下「已知遗留」）。
- **补 3 处零覆盖（审查实测：改坏代码后全仓 37 文件零失败）**：
  1. **owner 选择规则**（`syncLiveRows` 的 `ownerByTurn.set` last-wins）：场景 D 原先只断言
     「实时行数 === 1」，钉不住它落在谁身上；改成 first-wins 后全仓不杀但行会跳到段 A 起点。
     现补位置断言（实时行的下一个兄弟必须 = 段 B 的首个官方组）⇒ 变异 **M11 ⇒ 1 FAIL**。
  2. **`turnActive` 单独分支**（`provisionalSegmentKeys` 的 `!openTail && !turnActive`）：既有
     夹具里 steering 之后总有节点 ⇒ `openTail` 恒 true，删掉 `turnActive` 那一半不失败。新增
     **场景 J**（steering 为 flow 最后一个流项、`[data-chat-running]` 挂在 steering 座位内部
     ⇒ 不成为新流项）⇒ 变异 **M13 ⇒ 2 FAIL**。
  3. **`attributeFilter` 的 `data-open`**（`src/fold.ts:834`）：`fold-animation.test.mjs` 只查
     data-selected/data-state。补一条 includes 断言 ⇒ 变异 **M14 ⇒ 1 FAIL**。
- **修 3 处注释漂移**（注释与实现字面矛盾，是本仓库历史高频问题）：
  - `nativeTurnRowOpen`：原写「任一为展开即展开（data-open 优先）」，实现是 **data-open 存在即
    以其为准、缺失才回退 aria**；改为准确措辞（含 data-open="false" 的处理）。
  - `provisionalSegmentKeys`：原写「只有回合确实还在跑才返回」，实现是 **openTail 或 turnActive
    其一即可**；改为「二者其一」并如实声明 openTail 单独成立即可判临时段、以及由此产生的收敛边界。
  - passive 判据处的取证指引：原写「真机取证见场景 D」，实际取证在**场景 B / G**。
- **验收**：`test/fold-steer-live.test.mjs` **10 场景 40 断言**；新增变异 M11/M13/M14 全部被杀；
  既有 8 个变异体仍全杀；全仓 37 测试文件全绿 + typecheck 零错误。
- **已知遗留（未在本轮修，需产品决策）**：`turn-trigger` 不是段边界——当某回合**缺 turn-tail**
  时（宿主异常路径，`turn/end` 恒发 turn-tail 故罕见），两个回合会被并成一段（1 条一级行、
  指标取自后一回合）。审查逐字对比 0.3.0 ⇒ **非本 diff 引入**。修法需在 `buildSegments` /
  `findBlocks` 同时追加「上一段缺 turn-tail 时才把 turn-trigger 当边界」的保守条件，并补夹具；
  因涉及段划分主干逻辑、风险高于收益，未擅自改动。

### 0.3.2 — 2026-10-22 · 按独立审查收紧：补 3 处真空断言 + passive 撤退还原组

- **背景**：0.3.1 落地后由独立审查（只读 subagent，全量核对 src/fold.ts + 桩 DOM 变异）
  确认**无阻断缺陷**，但指出 7 条非阻断项。本轮处理其中 6 条（第 5 条为新增实现，第 7 条补注释）。
- **修掉 3 处真空/半真空断言**（本轮最重要——它们让对应行为零覆盖却不自知）：
  1. 场景 C 只有 1 个官方组 ⇒ `covered` 恒空 ⇒ 无论是否判出 passive 都不建 chip，断言恒真。
     改为 **2 组**：非 passive 必建 chip、passive 必不建 ⇒ 变异「回退 aria 兜底」被杀（1 FAIL）。
  2. 场景 E/F 未挂 `[data-chat-running]` ⇒ `turnActive` 恒 false ⇒ 删掉 `settled` 门结果相同。
     挂上后覆盖真实间隙（turn-tail 先到、running 指示器尚未撤）⇒ 变异「删 settled 门」被杀（6 FAIL）。
  3. 组桩 `makeGroup` 的展开态**不可切换**（click 不改 aria-expanded）⇒ 所有「组被驱动到
     某目标态」的断言都失真。改为可切换（click 切 aria-expanded + body 的 beforematch 揭示），
     语义与 fold-retry / fold-chip-drive 的官方 disclosure 桩一致。⚠️ 同时修正：click 里**不得**
     再派发 beforematch（否则收起方向的 click 被 reveal 监听反冲、组永远收不起来）。
- **新增场景 I**：历史插话回合已结束 + 新回合正在跑——`turnActive` 是 flow 级信号，是唯一能
  暴露「上一回合插话段被跨回合复活成临时段」的用例（变异「settled 门失效」实测被杀）。
- **代码**：passive 撤退那一个 pass 把此前由 chip 代表（收起）的组驱动回展开（§5.10「完全
  不介入」的收尾）——否则插件撤退后这些组永久停在收起态。单次门控 `chip !== null`，不会每
  pass 反复拉扯；`driveGroups` 自带 G1/inert/outerHidden 防护。
- **文档**：behavior-spec R12 补收敛条件（既无 turn-tail 又无终止标记的中断回合会让临时段
  长期停留——与 0.3.0「末段永不闭合 ⇒ 不结算」同源，非本次引入，宿主补出证据即收敛）；
  `syncLiveRows` 的 `segment:` 兜底分支标注为当前不可达（防御性保留）。
- **验收**：`test/fold-steer-live.test.mjs` 9 场景 34 断言；变异 8 组全杀（M1/M2/M3/M4/M5/M6/M7/M9，
  其中 M10「组还原改 covered-only」为等价变异，如实记录不杀）；全仓 37 测试文件全绿；
  typecheck 零错误；真机复测插话会话：进行中 1 条实时行且位于 turn-process 之后、正文全可见、
  无 chip；闭合后 rows=[]、正文全可见、原生行 data-open+disabled 且拿到指标。

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
  - passive 段与「段转直播/消失」路径都主动 `dropSegmentChip`（不留孤儿 chip）；撤退那一个
    pass 还把它此前代表（收起）的组驱动回展开——§5.10「完全不介入」的收尾，避免这些组永久
    停在收起态（靠 `chip !== null` 做单次门控，不会每 pass 反复拉扯）。
- **验收**：
  - 新增 `test/fold-steer-live.test.mjs`（9 场景 34 断言）：A 插话进行中、B data-open
    passive、C 旧版 aria passive 不回归、D 多次插话单实时行、E 回合结束后恢复折叠、
    F 插话紧跟 turn-tail、G 原生行转 passive 撤销遗留 chip 并还原组、H `data-open="false"`
    不得被误读为展开、I 历史插话回合已结束 + 新回合在跑（turnActive 不跨回合污染）。
    审查后**修掉 3 处真空断言**：C 初版只 1 个组（covered 空 ⇒ 恒无 chip）、E/F 未挂
    `[data-chat-running]`（settled 门零覆盖）、组桩不可切换（驱动后回读不变 ⇒
    所有「驱动到目标态」断言失真）；并修正组桩的 `beforematch` 语义（不得在 click 里派发，
    否则收起方向被 reveal 监听反冲）。
  - 变异实测（`.playwright-cli/mutate3/5/6/7.mjs`，**8 个变异体全部被杀**）：M1 回退临时段
    跳过 ⇒ 4 FAIL；M2 回退 data-open ⇒ 2 FAIL；M3 回退临时段实时行 ⇒ 4 FAIL；M4 回退
    passive chip 撤销 ⇒ 1 FAIL；M5 `data-open` 裸 `hasAttribute` ⇒ 1 FAIL；M6 删 settled 门 ⇒
    6 FAIL；M7 回退 aria 兜底 ⇒ 1 FAIL；M9 删 passive 撤退时的组还原 ⇒ 1 FAIL。
    （M10「组还原改成 covered-only」未被杀——撤退时 last 组本就是展开态，属等价变异。）
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