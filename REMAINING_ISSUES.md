# dsh-auto-collapse 遗留问题清单（REMAINING_ISSUES）

> **处理状态（2026-09 第三轮修复，供复审避免重复裁决）**：
> - ✅ 已修复：P1（segOrdinal 缓存+缓存失效矩阵）、P2（◆ 前缀 34 条/行号/9 节验收）、P3（末段索引+同步矩阵测试）、P4（常量行号，函数符号保持符号名定位）、P5/N6（compareDocumentPosition 真语义统一）、P6（场景 20/21/22+observer 泄漏+[class*=] 桩缺陷修复）、U1/U2/U4/U5/U6/U8/U9/U10/U11/U12 全部落地。
> - ⏭️ 评估后跳过（理由落档）：U3（StatusTextCard 310 行 hook 化——全 test 目录零处渲染设置卡片，React stub 不覆盖，hooks 重构是盲改，风险高于维护性收益）；U7（21 个测试文件各自 boot/seat 且已知 drift——fold-reconcile 的 seat 带额外属性，机械迁移回归风险高）。两者均列「长期重构」最末，待有渲染测试保障后再做。
> - 未落实 💡 建议项保持开放（术语表/data-* 契约附录/CI paths 过滤等，随迭代消化）。

> 背景：在 REVIEW_FINDINGS.md 审查报告基础上，对三个修复提交（28f60fe P0+P1 / 96b3651 文档 / c184ee7 P3）进行了 5 名复审员的第二轮复审。
> 实测基线：`node test/run-all.mjs` exit 0（22 个测试文件全绿）、`npm run typecheck` 零错误、build 后 lib 零漂移、工作树干净。
> 本清单收录：⚠️ 部分修复 7 项、❌ 未修复 12 项、🔀 修复引入的新问题 6 个、💡 未落实建议若干。
> 状态标注：复审时工作树 HEAD = c184ee7。

---

## ⚠️ 部分修复（7 项）

### P1. R2 聚合缓存残留三处（性能修复只完成一半）
- 位置：src/turn-metrics.ts:589-592（segOrdinal useMemo）、:598-601（命中 O(1)）、:421-442（computeSegOrdinal）、:364-407（缓存）
- 问题：①**segOrdinal 的 useMemo 每帧每个 step 仍 O(N) 扫描 computeSegOrdinal**，未缓存未节流，渐近 O(S×N) 未根除；②running 中无节流；③缓存失效依赖未实测的宿主契约（ChatNodeStore.values() upsert 重建假设，turn-metrics.ts:152-154/348-354）——重试原地 push attempts 不 upsert 时会脏命中返回旧值；**cachedTurnMetrics 本身零测试**（未导出，指纹失效分支无覆盖）。
- 建议：computeSegOrdinal 加指纹缓存；补缓存失效单测（同回合新增节点/插话新段/重试 attempt/计时端点更新矩阵）。

### P2. R5 behavior-spec 分层不彻底
- 位置：behavior-spec.md:7（分层定义）、:80/:129/:135/:137（§ 实现标签）
- 问题：三文体分层说明与 4 处 § 实现标签已加，但**正文无 ◆ 前缀**（仅定义处出现）、**验收标注 0 处**、§ 实现标签只有函数名**无行号**。
- 建议：正文条款加 ◆ 前缀；§ 实现补行号；验收项标注测试文件+场景号。

### P3. M3 metricsByTurn 有界但查询仍全表扫描
- 位置：src/turn-metrics.ts:58-97（双 LRU）、:107-130（readPreviousTurnLastInput）
- 问题：LRU 裁剪已落地（128 段/会话 + 8 会话，Map 有界 ≤1024 条），但 readPreviousTurnLastInput 仍是线性扫描，未建 turn→末段索引。有界后成本可控，属优化项。

### P4. M19 模块地图无行号
- 位置：README.md:86-118（符号级地图，README.md:88 明说「再 grep 符号名到行」）
- 问题：符号级地图/数据流小节/三向映射矩阵已落地（38 符号 37 真实），但无行号——现场演练改动画时长、加折叠类别均为 3 步（含 1 次 grep），未达「零 grep」标准。
- 建议：地图符号补行号（如 ANIM_DURATION_MS → fold.ts:46）。

### P5. T5 compareDocumentPosition 未对齐真 DOM 语义
- 位置：test/fake-dom.mjs:250-272（补了实现但「包含」仍单 bit 8/16）；test/adversarial-race.mjs:24-36、test/adversarial-session.mjs:23-35（两份重复实现仍在，包含分支顺序位 4|16 / 2|8 与真实语义相反）
- 问题：fake-dom 与 adversarial 两文件共三份语义不一致实现；adversarial 的 Node.prototype 覆盖会盖掉 fake-dom 实现（潜伏分叉点）。当前被测代码只查单 bit 未露馅。
- 建议：fake-dom 修成真 DOM 组合位语义；删除 adversarial 两份重复实现。

### P6. T7 覆盖盲区仅补约 3.5/8
- 位置：test/ 各文件
- 未补盲区：①data-selected 详情联动行为零测试（仅 fold-animation.test.mjs:793 订阅契约断言）；②快捷键守卫缺 INPUT/TEXTAREA/isContentEditable 拒绝与 repeat=true 拒绝路径（现有测试只带 repeat:false）；③reportError 路径（fold.ts:764-772）无测试；④metricsAttempts 20 次重试上限无测试；⑤contextDelta 负值缺展示断言（仅 metrics-unit:168-172 防负值根因）；⑥parseTurnDuration 新时间格式（「8月14日 21:56」timeStart 路径）全部 fixture 仍旧格式；⑦roster-watch 的 defaultReload/defaultStorage 真实路径零覆盖；⑧observer 实例级泄漏断言受 fake-dom disconnect 空操作限制。

### P7. R4 子项：lib/types/*.d.ts 仍手工维护
- 位置：build.mjs（不产 d.ts）、tsconfig.json:8（noEmit 无 declaration）
- 问题：lib/index.js 已由 esbuild 自动产出根治双源，但 .d.ts 类型声明仍手工维护、无产出/守卫。
- 建议：加 declaration 产出任务或 diff 守卫。

---

## ❌ 未修复（12 项）

### U1. M1 controller.start() 容错被跳过（P1 优先级项）
- 位置：src/client.ts:56-57（裸调 controller.start()）、src/fold.ts:667-670（start() catch 后 reportError 并 **re-throw**）
- 问题：指标注入器/看门狗均有 try/catch 且注释「失败只丢此功能」，唯独核心折叠链路没有；异常冒泡到 cordis effect 会拖垮整个插件（含设置卡片/watchdog），与「故障隔离 G2」原则相悖。
- 建议：client.ts:56 包 try/catch；改动极小，优先修。

### U2. M4 全 flow 扫描未加缓存（性能族只修一半）
- 位置：src/fold.ts:816（每 pass 一次 flow.querySelectorAll('[data-turn-process]')）、:857 + :3699-3712（每 pass 对每个 completed 段无条件 parseTurnDuration → findTurnStart 全 flow 扫 [class*="timeStart"]，不受任何限制）
- 建议：findTurnStart 建 flow 引用+变化代际索引，pass 间复用。

### U3. M11 StatusTextCard 巨型组件未收敛
- 位置：src/settings.ts:197-508（5 组 pending/派生/handler/save/JSX 逐字复制）
- 建议：抽 useFieldEditor hook + save 字段声明数组统一循环。

### U4. M18 dsh-alpha.3_4.md 未标注已解决
- 位置：dsh-alpha.3_4.md（39 行，被 .gitignore 忽略但仍在根目录，全文无「已解决」标注）
- 建议：文件头部加「已解决（修复见 turn-metrics.ts:12-18 / README.md:80）」或移入归档目录。

### U5. T4 fold-behavior.test.mjs 0 断言仍在 run-all 清单
- 位置：test/fold-behavior.test.mjs:1-227（纯 console.log 冒烟，grep assert 0 条）
- 建议：转真断言（processed 行存在/chip 数量/展开可见性）或移出清单。

### U6. T6 fake-dom dataset 未桥接 attributes
- 位置：test/fake-dom.mjs:300-306（dataset 仍是独立 Proxy，赋值不同步到 data-* 属性）
- 建议：dataset 的 set/get 桥接到 attributes Map。

### U7. T8 无共享测试 harness
- 位置：test/ 各文件（boot()/seat()/register() 在 13+ 文件逐字复制；assert/check 两种签名并存；document._all 注册 hack）
- 建议：抽 test/harness.mjs 导出 boot/seat/register/assert 标准件。

### U8. 工程化🟢-1 deploy extraFiles 缺失静默跳过
- 位置：deploy.mjs:319（仍 if (!existsSync(dest)) continue 无提示）
- 建议：缺失时 console.warn 列出未同步文件。

### U9. 工程化🟢-2 client.js banner/footer 拼接产物无语法守卫
- 位置：build.mjs:65-78（node --check 只查 lib/index.js）、:28-29（banner/footer 拼接）
- 建议：对拼接后的 lib/client.js 同样跑 node --check（写临时文件或 child_process 校验）。

### U10. 工程化🟢-3 FoldClientCtx 类型缺字段
- 位置：lib/types/client/index.d.ts:10-12（仅 effect）；src/client.ts:33-37（已含 slots?/settingsScope?）
- 建议：d.ts 补 slots?/settingsScope? 字段。

### U11. 工程化🟢-4 external.d.ts 冗余未删
- 位置：src/external.d.ts（注释「仓库本地不装这些包」与事实不符；node_modules schemastery@3.18.1 实装且自带类型）
- 建议：删除该文件或更新注释。

### U12. unhandledrejection 兜底监听未做（安全💡）
- 位置：src/client.ts apply()
- 建议：加轻量 window.addEventListener('unhandledrejection')（仅 console.warn，卸载时移除），与 reportError 模式一致。

---

## 🔀 修复引入的新问题（6 个）

### N1. README 模块地图引用虚构符号 createChip【最需立即修】
- 位置：README.md:98、:133（引用 createChip，全仓 grep 仅 README 出现）
- 实际符号：fold.ts:3525 updateChip。
- 影响：模块地图按图索骥会扑空，地图信任度受损。
- 建议：改为 updateChip（fold.ts:3525）。

### N2. spec 新 TOC 锚点约 7/10 失效
- 位置：behavior-spec.md:11-20（新增 TOC）
- 问题：带括号章节标题在 GitHub slugger 规则下锚点与目录不符（如「二、等级结构（以此为准）」实际锚点 #二等级结构以此为准，目录写 #二等级结构）。
- 建议：按 slugger 规则修正锚点或去掉标题括号。

### N3. en:87 结构表残留 node.data.usage 旧表述
- 位置：README.en.md:87（与同文件 :42 已更新的 tokenUsage 口径自相矛盾）
- 建议：改为 tokenUsage 权威源表述。

### N4. M5 副作用：无注入器部署时持久化整体退化
- 位置：src/fold.ts:2483-2486（sessionId 为空直接不持久化，注释声明「宁可丢失也不跨会话误恢复」）
- 影响：slots 不可用、无 data-dshcf-session 时，展开状态不再持久化——功能回退，属设计取舍但需知晓。

### N5. R2 缓存对旧版 DSH 永久 miss
- 位置：src/turn-metrics.ts:378-381（valuesEpoch 依赖 nodes.values()）
- 影响：旧版 Map 每次返回新迭代器 → 缓存永久 miss 自动禁用——性能修复只对 rc.1 生效（安全兜底，非 bug，但旧版无性能收益）。

### N6. adversarial 的 compareDocumentPosition 覆盖分叉
- 位置：test/adversarial-race.mjs:24-36、adversarial-session.mjs:23-35
- 影响：Node.prototype 赋值盖掉 fake-dom 实现，其包含分支顺序位与真 DOM 相反——潜伏分叉点（与 P5 同源）。
- 建议：删除这两份覆盖，统一用修正后的 fake-dom 实现。

---

## 💡 未落实建议（低优先级，随迭代消化）

- 文档：特性条目行内「实现：」标注；指标字段链路一句话（index.ts:10 默认串 → settings.ts 214 UI → turn-metrics.ts 计算）；spec 实现状态标记（已实现/未实现）；术语表（PTC/steering/segOrdinal/contextDelta）；DOM data-* 契约清单附录；排障笔记归档约定。
- 工程化：build entryPoints 目录扫描（当前仅两入口，可接受）；CI paths 过滤（小仓库可接受）。
- 测试：run-all.mjs 顶部补「测试文件 → 被测模块」映射表；fake-dom 对不支持的 selector 组合器（>/+/~/ :has）直接抛 unsupported。
- M8 残留：补「host/client 两侧签名输出直接对比」的跨侧断言。
- M10 残留：FiberState 启动期自检日志。
- 安全：XSS 防回归已落地 ✅，无新增。

---

## 🎯 下一轮修复优先级

1. **立即（改动小、收益直接）**：U1（M1 start 容错）→ N1（createChip 虚构符号）→ N2（TOC 锚点）→ N3（en:87 旧表述）。
2. **短期**：P1（computeSegOrdinal 缓存 + 缓存单测）→ U2（M4 findTurnStart 缓存）→ U6（dataset 桥接）→ P5/N6（compareDocumentPosition 统一）。
3. **中期**：U5（fold-behavior 转真断言）→ P6（盲区 4.5 条补测）→ U8-U11（工程化 🟢 四项）→ U4（dsh-alpha 标注）→ P2（spec 分层补全）→ P7（d.ts 产出）。
4. **长期重构**：U3（StatusTextCard hook 化）→ U7（测试 harness）→ P4（地图行号）→ P3（索引化）→ U12（unhandledrejection 兜底）。

---

*来源：5 名 nova/deepseek-v4-flash 复审员对照 REVIEW_FINDINGS.md 逐项验证，主代理去重汇总。全程只读，未修改任何文件。*
