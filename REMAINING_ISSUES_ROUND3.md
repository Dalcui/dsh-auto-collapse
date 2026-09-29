# dsh-auto-collapse 第三轮复审后剩余问题清单（REMAINING_ISSUES_ROUND3）

> 背景：三轮「审查 → 修复 → 复审」迭代完成。第三轮修复提交 ca51546（代码）+ 4dcbd32（文档），3 名复审员对照 REMAINING_ISSUES.md 逐项验证。
> 实测基线：`node test/run-all.mjs` exit 0（22 个测试文件全绿）、`npm run typecheck` 零错误、build 后 lib 零漂移、工作树干净。
> **结论：第三轮修复已验收，无阻断性新问题。** 本清单收录剩余的低优先级项（部分修复残留 / 有意跳过的长期重构 / 低概率契约脆弱点）。
> 状态标注：复审时 HEAD = 4dcbd32。

---

## ⚠️ 部分修复残留（4 项）

### W1. P1 残留：running 节流未实现
- 位置：src/turn-metrics.ts（全文件无 throttle/节流代码）
- 现状：cachedTurnMetrics 与 cachedSegOrdinal 均为帧级去重缓存（同帧 O(1) 命中），但 running 流式期间的计算**没有跨帧节流**——每帧仍触发一次聚合/段号重算。
- 建议：对 running 状态的计算加节流（与 fold 的 rAF 调度合并或时间窗节流）。

### W2. P6 残留：4 条诊断类测试盲区
- 位置：test/ 各文件（grep 实证无覆盖）
- ③reportError 路径（src/fold.ts:764-772，pass 抛错 → style[data-dshcf-state=error]）无测试；
- ④metricsAttempts 20 次重试上限（fold.ts:855-857）无测试；
- ⑤contextDelta 负值展示无断言（仅 fold-record.test.mjs:95 正值 + metrics-unit:168-172 防负值根因）；
- ⑦roster-watch 默认实现 defaultReload（roster-watch.ts:104）与 defaultStorage（:76）真实路径零覆盖（现有测试全部注入替代）。
- 说明：均属覆盖缺口而非行为缺陷。

### W3. P2 瑕疵：spec 验收标注文件错位
- 位置：behavior-spec.md:104（写「fold-issue-round3（场景 17/17b）」）
- 实际：场景 17/17b 在 test/fold-regression.test.mjs:878/:932；fold-issue-round3.test.mjs 只有场景 A-E（:51-136）。
- 建议：改标注为 fold-regression.test.mjs。

### W4. P4 瑕疵：README 行号差 1
- 位置：README.md:104（写 METRICS_CACHE_MAX:399）
- 实际：定义在 src/turn-metrics.ts:400（修复提交时已在 400，属文档提交笔误）。
- 建议：改为 :400。
- 附带轻微项：README.md:88「再 grep 符号名到行」说明与常量已带行号的现状语义略冲突，可同步措辞。

---

## ❌ 有意跳过（2 项，长期重构）

### S1. U3 StatusTextCard 巨型组件未收敛
- 位置：src/settings.ts:197-508（5 组 pending state/派生/handler/save/JSX 逐字复制，无 useFieldEditor、无字段声明数组）
- 跳过理由（清单已落档）：长期重构，缺渲染测试保障，当前无功能性影响。
- 建议时机：补 settings 渲染测试后，抽 useFieldEditor hook + save 字段声明数组统一循环。

### S2. U7 无共享测试 harness
- 位置：test/（boot()/seat()/register() 在 13+ 文件逐字复制；assert/check 两种签名并存；document._all 注册 hack）
- 跳过理由：同上，长期重构；现有测试全绿且行为级断言有效。
- 建议时机：抽 test/harness.mjs 导出 boot/seat/register/assert 标准件，统一 assert 签名。

---

## 🔀 残余风险 / 契约脆弱点（4 项，低概率、非阻断）

### R1. findTurnStart 用 parentElement 取 flow 索引键
- 位置：src/fold.ts:3727（boundary.parentElement 依赖 turn-tail 为 flow 直接子级）
- 风险：宿主若在 flow 与 turn-tail 之间插入 wrapper 层，索引 miss 且 querySelectorAll 范围收窄 → 漏检 flow 内其他 timeStart（新格式时长退化）。
- 对比：segmentMetricsKeys（:2437）用 closest 更稳。
- 建议：改为 closest 取 flow，消除契约脆弱点。【最值得下轮修】

### R2. observer attributeFilter 不含 class 变化
- 位置：src/fold.ts（observer attributeFilter 仅含 data-selected/data-state）
- 风险：宿主原地改 timeStart 的 class（不增删节点）不触发索引失效。正常路径随消息整体插入无碍。
- 建议：若需覆盖，把 timeStart 相关 class 纳入失效判断或加显式失效钩子。

### R3. 缓存指纹依赖宿主 values() 重建契约（N5 已知）
- 位置：src/turn-metrics.ts:378-381（valuesEpoch 依赖 nodes.values()）
- 风险：重试场景若宿主原地 push attempts 而不 upsert 重建，会脏命中返回旧值；该场景单测不可模拟（宿主契约残余，非本轮引入）。旧版 DSH（Map 迭代器每次新建）则永久 miss 自动降级，安全但无性能收益。
- 建议：无法在本插件内根治；可在 DSH 升级时回归验证 values() 契约。

### R4. U4 标注位于被 .gitignore 忽略的文件内
- 位置：dsh-alpha.3_4.md:2-5（已加「✅ 已解决（归档标注，U4）」，但该文件被 .gitignore 忽略）
- 影响：标注只存在于工作区，**不进提交**——clone 下来的新开发者看不到标注。
- 建议：解除该文件忽略并提交，或移入归档目录（如 docs/archive/）。

---

## 🎯 建议优先级（若继续迭代）

1. **顺手修（分钟级）**：W3（spec 验收文件错位）、W4（README 行号差 1）、R4（解除 gitignore 或归档）。
2. **小改动**：R1（findTurnStart 改 closest）、W1（running 节流）。
3. **补测试**：W2 四条诊断盲区。
4. **长期重构**：S1（StatusTextCard hook 化）、S2（测试 harness）。
5. **跟踪项**：R2、R3（依赖宿主契约，DSH 升级时回归验证）。

---

*来源：3 名 nova/deepseek-v4-flash 复审员对照 REMAINING_ISSUES.md 第三轮验证，主代理去重汇总。全程只读，未修改任何文件。*
