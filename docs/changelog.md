# 版本变更记录

每版一条：日期 / 版本 / 主题 / 根因 / 修法 / 验收证据（测试名 + 变异实测 + 真机取证）。新改动完成后必须在此追加一节（见 AGENTS.md 铁律 1）。
> 来源：自 [AGENTS.md](../AGENTS.md) §4 拆出（0.3.7 文档渐进披露重构）

---

### 0.3.7 — 2026-11-12 · 文档渐进披露重构：AGENTS/README 薄入口 + docs/ 细节拆分（无代码行为变更）

- **背景/主题**：AGENTS.md 会**自动注入每个会话上下文**（355 行 wc 口径，其中 §4 版本史约 270 行为纯历史细节），
  README.md（371 行）同样塞满逐版本适配史与实现细节——与当前任务无关的长细节每次都被整段塞进上下文。
  本版按 skill 式**渐进披露**重构：入口只保留每次都要遵守的规则 + 「什么时候读什么」索引，细节移入
  `docs/`，需要时再查。纯文档改动，未触碰任何 src/test 行为（仅注释指向修正）。
- **修法**：
  - `AGENTS.md` 355→59 行（wc -l 口径，下同）：§0 铁律（7 条全保留；引用改指 docs 新位置；「37 个测试文件」笔误修正为 38）、
    §1 速览、§2 场景→文档索引表、§3 版本速查一行版。§2 契约 → `docs/host-contract.md`、§3 验证 →
    `docs/verification.md`、§4 版本史 → `docs/changelog.md`（本节所在文件）。
  - `README.md` 371→85 行：特性压缩为一览（全文 → `docs/features.md`）、兼容性压缩（适配史全文 →
    `docs/adaptation-history.md`）、开发细节 → `docs/architecture.md`（模块地图/数据流/三向映射/关键机制）
    与 `docs/how-to.md`（检查/部署/发布/热生效机制）。
  - `README.en.md` 154→71 行：同构瘦身，英文特性全文 → `docs/features.en.md`；英文兼容性 bullets、
    checks/deploy/publish、key mechanisms 逐字保真迁入对应 docs（带「verbatim from legacy」标注）。
  - 修正 4 处指向旧章节位置的注释：`test/fold-steer-live.test.mjs`（AGENTS.md→docs/changelog.md）、
    `src/index.ts` / `src/locales.ts`（README 模块地图→docs/architecture.md）、`src/fold.ts` 快捷键注释。
  - **如实声明的弃用**（非搬运、有意删除的过时错误陈述）：README.en.md 的「0.1.7 adaptation in progress,
    not finished + entry stays disabled」段（早已完成，中文版与 changelog 为准）；README.en.md 旧版
    project layout 模块地图（缺 flow 扩展位/roster-constants 等、与中文版矛盾，以 docs/architecture.md 为准）。
    其余旧行逐行校验（trim 后精确命中）：三文件共 64 行未命中 = 上述声明弃用 20 行 + 44 行入口节标题/导语重写、
    长行重排与 `](x)`→`](../x)` 链接改写；内容缺失 0。
  - 版本号 0.3.6→0.3.7（package.json + package-lock 两处）。
  - **第一轮审查后修复**：docs/architecture.md 删除切片与手动拼接重叠产生的 client↔host 重复块与双标题、
    小节统一 H2；英文热更新机制段 features.en.md 与 how-to.md 只留单份（how-to 引用 features.en）；
    architecture.md「36 个测试文件」改「38（36 个 *.test.mjs + 2 个 adversarial-*）」；AGENTS 铁律 4
    兼容范围校准为 0.1.1-rc.x ~ 0.2.2-rc.1（与 README 一致）；adaptation-history 0.1.7 标题前补空行；
    全部 11 个 md 工作区统一 CRLF + EOF 单换行（存储层 blob 由 core.autocrlf 归一，不新增 .gitattributes 规则）；architecture/how-to 来源行补 README.en.md；README 安装导语还原
    「使用构建好的版本 / 需要跟随 main 时」措辞。
- **验收**：
  - 覆盖校验脚本逐行核对旧三文件（AGENTS 45-356 / README 17-371 / README.en 17-154）→ 除上述刻意项外 missing=0。
  - `node build.mjs` 四守卫（host/client d.ts 导出面 + 双 node --check）通过；`npx tsc --noEmit` 零错误；
  - 无代码行为变更 ⇒ 不需要真机取证与变异实测（无新行为）。

### 0.3.6 — 2026-11-11 · 段级 chip 职责拆分：只做重试记录开关，不再代表工具组

- **背景/主题**：0.3.5 把每组工具数下沉到组头后，段级 chip 的「已折叠 N 个工具组 + 活动
  统计摘要」成为重复信息。真机确认它仍做两件事：① 一键展开/收起 27 个覆盖组；② 收起时隐藏
  27 条「已重试模型请求」、展开时放出。① 与「组头单独点开 + 原生行整体收起」重复，② 是唯一
  不可替代的职责。用户确认采用**方案 B**：chip 只负责重试/状态行；同时把组头徽标文案从
  「N 个工具」改为「N 次工具」。
- **修法**：
  - `SegmentState.groupsExpanded` → `statusExpanded`：chip 的展开态只控制块外状态行。
  - `ensureSegmentChip(state, flow)`：删除 `covered` 参数与组计数标题；仅当
    `snapshot.statusRows`（已连接）非空时创建，标题 = `N 条重试记录`（全是 model-retry）
    或 `N 条状态记录`（含 turn-error / turn-max-tokens）；点击只开合状态行。
  - 段内覆盖组**始终**由 `driveGroups(covered, false)` 驱动收起，最后一组仍驱动展开；
    与 chip 是否存在完全解耦（0.3.6 前收起的触发源是 chip 点击）。
  - `passiveRestored?: boolean`：进入 passive 时一次性把此前驱动过的组还给宿主；不再以
    `chip !== null` 作门控（无重试的段也有被驱动过的组，旧门控会漏还原）。
  - 段级 chip leading 图标改为 14×14 圆形箭头（原生 retry 行无独立 SVG 可克隆）。
  - `groupToolCountLabel`：zh `N 次工具`，en `N tool calls`；测试/文档同步。
  - **chip 创建补 nativeOpen 门控**：0.3.6 初版发现「原生行收起、但有重试行」的回合会在
    折叠行下方挂出 chip（旧实现靠 `covered.length > 0` 隐式挡住——原生收起时组带 hidden）。
    现在 `driveGroups` 之后、`ensureSegmentChip` 之前显式检查 `nativeOpenSegments`，
    收起回合 `dropSegmentChip` 并跳过（组驱动照常执行，不受门控影响）。
- **影响（如实声明）**：没有块外状态行的回合**不再出现段级 chip**；「一键展开其余工具组」
  入口随 chip 移除，用户改为点各自组头（原生行仍可整体收起）；重试链仍可通过 chip 展开；
  原生行收起再展开后 chip 的展开态重置为收起（门控每 pass drop/重建，可接受）。
- **验收**：
  - `test/fold-group-count.test.mjs` 扩为 **7 场景 35 断言**：chip 仅在重试行存在时创建、
    标题计数、点击不驱动工具组、无状态行不建 chip、原生行收起不建 chip（场景 7）；
    原组徽标 5 场景保持。
  - `test/fold-chip-drive.test.mjs`：删除已失效的 D1（chip 驱动组），D2b 补 beforematch
    零 click 断言；D3/D5 增加「chip 只开重试行、不驱动组」断言；D3/D5 标题计数。
  - `test/fold-017-safety.test.mjs`：K 直接用组 aria 断言覆盖集（不再用 chip 计数作代理）；
    L/L2 改为组驱动断言（修掉 `chip === null ||` 的真空逃逸）；N 的 muting 重放信号改为
    chip 重试计数 2→3；E/R 夹具补重试行。
  - `test/fold-steer-live.test.mjs`：G 补重试行以验证 passive 撤销 chip；新增 **G2**
    （无状态行、无 chip 时 passive 仍还原全部组，杀 old chip 门控）。
  - `test/fold-retry.test.mjs`：R7 用例改为「历史段 3 组全部收起 + chip 只开重试行」。
  - `fold-flow-slot` / `fold-multi-flow` / `fold-error-passive` 夹具补重试行，保留原有
    「每回合各归各 chip / 两列账本隔离 / 健康回合 chip」覆盖。
  - 变异实测（`.playwright-cli/mutate-chip-retry.mjs`，**5 个新变异体全部被杀**）：
    M10 chip 无条件创建 ⇒ 2 FAIL；M11 chip 重新驱动组 ⇒ 4 FAIL；M12 passive 回退 chip
    门控 ⇒ 1 FAIL；M13 标题不区分重试/状态 ⇒ 4 FAIL；M14 去掉 nativeOpen 门控 ⇒ 2 FAIL。
    0.3.5 的 M1–M9 复跑仍全部被杀。
  - 全仓 **38 个测试文件全绿**；`npx tsc --noEmit` 零错误；`node build.mjs` 四守卫通过。
  - 真机（3080，DSH 0.2.2-rc.1，部署 `rev=9bc501d7f5f9` 后刷新）：
    - 有重试的回合 3：chip `27 条重试记录`；收起态 28 组中 1 组展开、27 条重试行全隐藏；
      点击 chip 后 27 条重试行全可见、**仍只有 1 组展开**；再点收起恢复隐藏。
    - **nativeOpen 门控**：刷新后回合 3 原生行收起（data-open 缺失）⇒ 全页 0 个
      `.dshcf-seg-chip`（修复前会在折叠行下方挂出 chip）；展开后才出现。
    - 无重试的当前会话：2 个组徽标 `· 26 次工具` / `· 186 次工具`，**无段级 chip**
      （0.3.6 的「无状态行不建 chip」）。
    - 回合 2 为官方 alwaysOpen（data-open=true + disabled）⇒ §5.10 插件完全不介入：
      36 组全展开、36 条状态行可见、无 chip（符合既有 passive 语义，非本版回归）。
    - 组头高度：收起 24px、展开 32px（官方下内边距）。
- **兼容**：旧版 DSH 无 `[data-step-process]` 组时 chip 空转；块级 chip（legacy 无原生行）
  语义未改；原生行指标注入未改。

### 0.3.5 — 2026-11-11 · 每组工具数挂到官方组标题末尾，段级 chip 不再显示活动统计摘要

- **主题**：原生 compact 模式下，工具统计此前只以段级 chip 的形式挂在**每轮的开始位置**
  （`已折叠 N 个工具组 · code ×12 · commands ×11 …`），用户无法从某个原生工具组的折叠行
  直接看到该组有多少个工具。本版把每组统计下沉到该组自己的原生折叠行（组标题按钮）末尾：
  `运行了代码，更新了计划，已调用工具 · 5 次工具`。
- **根因**：0.3.4 及以前，组级信息只存在于 `div[data-step-process]` 内部（官方标题文案只列
  活动类别、不含计数）；插件读取组内行做统计的唯一出口是段级 chip 的 `summarizeGroups`
  活动直方图，且该 chip 挂在 `turn-process` 座位（回合顶部）。
- **修法（最小改动）**：
  - `src/fold.ts groupToolCallCount(group)`：按组内容流统计工具调用数——普通工具行 1；
    PTC(run_code) 有子工具时按子工具数计（对齐块级 `Bash ×2 · Read ×1` 的「子工具替代
    Code」口径），无子工具计 1；只数「最近 `[data-chat-flow]` = 本组 content」的行
    （子代理面板等嵌套流不计）；斜杠命令 / manual-compaction 不计。
  - `syncGroupToolCounts(flow)`：每 pass 对 flow 直接子级的官方组维护一个
    `span.dshcf-group-count`，追加到 `button[data-process-activity]` 末尾（label 之后）。
    count≤0 时移除；徽标不在末尾时补回；文本不变不写（防 MutationObserver 自激）。
    React 重渲染清掉后下一 pass 自愈（与 `syncNativeDisclosure` 的原生行指标 span 同款）。
  - `ensureSegmentChip`：删除 `summarizeGroups` 摘要（`dshcf-chip-summary` / `dshcf-chip-sep`
    不再创建），chip 只保留「已折叠 N 个工具组」控件标题；补 CSS
    `.dshcf-chip.dshcf-seg-chip .dshcf-chip-title { max-width:100% }`——移除摘要后标题
    自身宽度触发了通用 70% 上限的循环截断（真机实测 `已折叠 27 个工…`）。
  - CSS `.dshcf-group-count`：14px/24px、`--dsw-alias-label-tertiary`、`flex:0 0 auto`、
    nowrap；实测**收起态**组头（含徽标）高度 24px，展开态 32px 来自官方 8px 下内边距
    （非徽标引起）。
- **契约最小例外**（behavior-spec 头部 ① / §四 二级已同步）：官方组仍是「不透明容器」——
  **不写组根/body/content 的 style、不往这些位置插节点**；唯一例外是向组标题按钮末尾追加
  这一个 inert 计数 span。它不参与折叠/驱动决策，click 冒泡到官方按钮 = 展开/收起（符合预期）。
- **验收**：
  - 新增 `test/fold-group-count.test.mjs`（5 场景 25 断言）：每组独立计数；PTC 子工具
    按 2 计（不重复计 run_code 自身）；run_code 无子工具计 1；斜杠命令不计；纯思考 /
    纯命令组无徽标；嵌套流不计；新增工具后原地更新；React 清掉徽标后自愈；React 把官方
    节点插到徽标之后时补回末尾（insertBefore，不重复）；工具全部消失后移除；切流/销毁
    时清掉旧 flow 徽标；徽标只在组头按钮内（组根 children 仍为 `[header, body]`）；段级
    chip 不再创建统计摘要 span / 不含 `×N` 文本。
  - 变异实测（`.playwright-cli/mutate-group-count.mjs`，**9 个变异体全部被杀**）：
    M1 关闭组计数注入 ⇒ 14 FAIL；M2 去掉嵌套流边界 ⇒ 1 FAIL；M3 子调用按行数计
    （run_code 自身也计）⇒ 2 FAIL；M4 徽标改挂组根 ⇒ 15 FAIL；M5 零计数不撤徽标 ⇒
    1 FAIL；M6 恢复段级 chip 摘要 span ⇒ 1 FAIL；M7 run_code 无子工具计 0 ⇒ 1 FAIL；
    M8 斜杠命令也计入 ⇒ 2 FAIL；M9 不补回徽标末尾 ⇒ 1 FAIL。
  - `node test/run-all.mjs` **38 个测试文件全绿**；`npx tsc --noEmit` 零错误；
    `node build.mjs` 四守卫通过。
  - 真机（3080，DSH 0.2.2-rc.1，部署后刷新）：回合 2 原生 `tool-calls=34`，36 组中 34 组
    有徽标、徽标数值和 74（含 PTC 子工具）；回合 3 原生 26，28 组中 26 组有徽标、和 78。
    抽查「已读取文件，运行了代码，更新了计划 · 5 次工具」= 1 个 run_code + 5 个子工具
    （todo_write + read×4）；收起态组头高度 24px（展开态 32px 为官方下内边距）；段级 chip 文本为完整的
    `已折叠 27 个工具组`（无摘要、无截断）；控制台无 dsh-auto-collapse 报错。
- **兼容**：旧版 DSH 无 `[data-step-process]` 组时 `syncGroupToolCounts` 空转；段级 chip
  的标题与交互不变（仅去掉摘要）；原生行指标注入路径未改。

### 0.3.4 — 2026-11-08 · 适配 DSH 0.2.2-rc.1：修复指标注入 shadow 被注入面变更打崩

- **背景**：本机 DSH 于 2026-11-07 升级到最新版 **0.2.2-rc.1**（npm latest）。真机巡检（3080）
  发现折叠主干正常、host 半正常，但**全部指标功能失效**：页面
  `[data-dshcf-turn-metrics-host]` / `[data-dshcf-session]` / `[data-dshcf-seg]` /
  `.dshcf-native-metrics` 均为 0，控制台报 `TypeError: fileMentions is not a function` +
  `slot entry crashed in 'conversation.chat.node'`。
- **根因**：0.2.2 把内置 `conversation.chat.node` / `assistant-step` 的 entry 级 inject face
  从 `() => ({ hooks: { presentation } })` 改为
  `(sessionId) => ({ hooks: { presentation }, resolveFilePath, fileMentions })`，并把
  `fileMentions` 从 ChatView kit 移除（旧 bundle 12 处 → 新 bundle 5 处，仅经 face 下发）；
  内置 `AssistantNodeView` 在「已闭合回合的最终回复」节点上无守卫调用
  `fileMentions(owner, …)`。插件 shadow 条目只转发 `hooks.presentation`、且无参调用内置
  工厂 ⇒ shadow 渲染内置组件时 `props.fileMentions` 为 undefined ⇒ SlotErrorBoundary 把
  shadow 条目退市 ⇒ 指标注入永久失效（自愈重注册最多 3 次，face 里始终缺该键）。
- **修法（最小改动）**：
  - `src/turn-metrics.ts shadowInjectFace(...args)`：把框架绑定期实参（sessionId）原样转发给
    内置 inject 工厂，并**整体透传**内置 face（浅拷贝）；仅对 `hooks` / `keyedHooks` 隔间做
    防御清洗——非对象整体丢弃，对象内只保留 WeakMap 合法键（对象/函数），其余键
    （`resolveFilePath` / `fileMentions` 等一级 prop）原样透传。旧版 DSH 的 face 只有
    `hooks.presentation`，输出与旧实现逐字等价。
  - `src/fold.ts hasNativeRunningIndicator`：选择器补 `:not([data-holding])`——0.2.2 的
    RunningStatus 在「会话已停、回合未闭合」时渲染带 `data-holding` 的隐藏占位，旧判据会
    误判 `turnActive=true`（已停止回合仍走「进行中」分支：残留实时计时行 / 临时段多维持一个 pass）。
- **如实声明的边界**：`[data-holding]` 修复只解决「占位被误判为在跑」；holding 之后若仍有
  未闭合尾段，插话段仍由 `provisionalSegmentKeys` 的 openTail 判为临时态（既有收敛条件，
  behavior-spec R12），本版本**不改变**该结算语义。
- **验收**：
  - 测试：`test/turn-metrics-injector.test.mjs` 新增 T1-I（7 断言：sessionId 透传、
    presentation 保留、resolveFilePath/fileMentions 透传、内置组件执行不抛错并拿到新 prop）；
    `test/fold-steer-live.test.mjs` 新增场景 K/K2（**真机 0.2.2 顺序**：holding 不产生
    实时行；K 同时如实钉住「holding 之后的未闭合尾段仍按临时态，不虚构结算」）；
    `test/shadow-inject.test.mjs` C 段扩展（部分非法 hooks、keyedHooks 清洗、混合 face
    经 runInject 后非 hook 键保留）。
  - 变异实测（全部被杀）：M1 回退 face 透传（只转 presentation + 无参调用）⇒
    injector **5 FAIL** / shadow-inject **11 FAIL**；M2 回退 holding 选择器 ⇒ K+K2 **2 FAIL**；
    M3 删 keyedHooks 清洗 ⇒ **1 FAIL**；M4 hooks 改成「任一非法就全丢」⇒ **3 FAIL**。
  - 全仓 **37 个测试文件全绿**；`npx tsc --noEmit` 零错误；`node build.mjs` 四项守卫通过。
  - 真机（3080，DSH 0.2.2-rc.1，部署 0.3.4 后刷新）：已完成会话
    `metricsHost/sessionAttr/segAttr = 74/74/74`、`.dshcf-native-metrics = 2`（文本如
    「65 次模型 · 20.2M 输入」）、`data-dshcf-turn-metrics` JSON 正常；原生行展开后
    `.dshcf-chip` 出现且组被驱动；控制台无 `fileMentions` / `slot entry crashed` 报错。
- **兼容**：0.1.7 ~ 0.2.1 的内置 face 只有 `hooks.presentation`，整体透传与旧实现等价；
  无 `data-holding` 的旧版选择器语义不变（`:not([data-holding])` 恒命中）。

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
