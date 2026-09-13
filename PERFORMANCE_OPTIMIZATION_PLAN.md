# dsh-auto-collapse 性能优化方案（最终报告）

> 配套报告：E:\APP\Agent\DSH\DSH-WebUI-性能诊断报告-20260913.md（原诊断为现象定位，本文为插件侧修复方案）。
> 状态：方案已过三路独立审查（R1 deepseek-v4-pro / R2 v4-flash 完整；R3 glm-5.3-flash 红队三次被服务重启打断，残余范围已由 R1/R2 覆盖）。尚未实施。
> 代码基线：仓库 HEAD b524e14（== dalcui/main，工作树干净）。DSH 版本 0.1.5-rc.1。

-----

## 一、代码状态确认（先回答「是否最新」）

| 项 | 结论 |
|---|---|
| 仓库 vs 远端 | HEAD b524e14 与 dalcui/main 完全一致（0 0），无落后无领先 |
| lib/ vs src/ | 重建产物哈希与已提交版逐字节一致，无漂移 |
| 已部署产物 | ⚠️ 落后于仓库：profiles/web/node_modules/dsh-auto-collapse/lib/client.js 为 4305 行，缺 3a374be 的 tok/s 修复（部署包 liveDecodeMs=0 / settled=0；仓库产物 4324 行） |
| 插件当前状态 | profile 中 disabled: true（原报告第八节 B），线上未运行 |
| 报告所测版本 | 报告行号（computeTurnMetrics@143 / @156 const targetSeg / cachedSegOrdinal@283 / computeSegOrdinal@306）与部署包谱系吻合；HEAD 移位 +17 行 |

-----

## 二、宿主快照语义（正确认知的前提，三处关键）

审查独立核实（dsh-client-ui-chat/lib/client.js）：

1. order 引用惰性保持：ChatSnapshotBuilder.apply（:5599-5630）只有 structural=true 才重算，且用 sameReferences 判定——键序列不变时保留旧数组引用。纯内容流式（upsert 新对象但 kind/anchorSeq/visibility/location 不变）不换 order。
2. nodes.values() 惰性脏重建（MutableChatNodeStore.values :4868-4903）：valuesCache + valuesDirty，upsert 置脏后首次调用才重建，同帧内共享同一数组。
3. snapshot 每次 apply 新建对象，但缓存指纹是 order + valuesEpoch + timing 端点，不含 snapshot 引用——不推翻缓存判定结论。

> 这三条决定：内容流式 chunk 不触发 useMemo 重算（原报告第 132 行那句是对的）；真正的全量重算发生在「结构变化」批次（新 tool-call / new step / turn-tail / 新回合 / loadOlder prepend / 重连 replaceWindow）。

-----

## 三、真实剩余成本（实测）

### 3.1 真凶是 cachedSegOrdinal（对原报告「双层缓存击穿」的归因修正）

- cachedSegOrdinal 缓存键 = nodeKey，S 个可见 assistant-step 是 S 个孤立键；结构变化 → order 引用换新 → S 个键全部 miss → 各自 O(N) 扫 order。
- metricsCache（cachedTurnMetrics）键 = sessionId:turn:segOrdinal，同帧同 (turn,seg) 的多个 step 能去重——它不是 O(S×N) 的来源。
- 结论：继续加缓存层次无效；必须换「批次级派生 + 按回合迭代」的架构。

### 3.2 三路独立复现（方向一致，绝对值因夹具构成/机器差 2–7×）

| N（节点） | S（可见 step） | 本报告 | R1 (v4-pro) | R2 (v4-flash) |
|---:|---:|---:|---:|---:|
| ~470 | 60 | 1.6 ms | 1.4 | 0.4 |
| ~2060 | 240 | 6.1 | 20.4 | 4.4 |
| ~7720 | 480 | 66 | 229.5 | 26.8 |
| ~16620 | 960 | 262 | 1784 | 124 |

四项共同确认：标准二次方形态 + S>512 的 LRU 阈值悬崖（SEG_ORDINAL_CACHE_MAX=512，R1 量出悬崖额外付出 ~750ms）。

### 3.3 fold 侧：每动画帧全量重派生（原报告完全未覆盖的另一半）

审查实测（fake-dom + 真实 client.js，N=100 回合流投 characterData 记录）：

- 单 pass 3128 次元素级 querySelectorAll，热点：
  - [data-turn-tail] 组合查询 ×1210（segmentMetricsKeys fold.ts:2460）
  - [data-dshcf-turn-metrics] ×101（extractTurnMetrics fold.ts:2284，每完成段全 flow 扫）
  - [data-dshcf-session] ×202（fold.ts:2482）
- 链路：observer(characterData:true :660-680) → shouldSchedule → markDirty（:741 无条件 flowChanged=true）→ invalidateFlowIndexes（:3764）作废索引 → 每 rAF 一次 pass() 全量重建 findBlocks + buildSegments。
- 口径修正：characterData 是 live summary / 滚动跟随的刻意驱动，不能全砍；真正可砍的只有「结构索引重建 + 已完成块重复派生 + 双扫合并」。
- 频率修正：是「每动画帧一次」（宿主对 live-chunk 返回 animation-frame），不是「每 WS chunk」。

-----

## 四、对原报告的正式修正（三条）

| # | 原报告/初版说法 | 修正后 |
|---|---|---|
| 1 | 双层缓存同时被击穿 | 归因错位。真凶是 cachedSegOrdinal（键=nodeKey）；metricsCache（键=turn:seg）同帧能去重 |
| 2 | 可获 3 个数量级余量 | 不成立。A 方案全量重建每结构变化仍 O(N)，实测 5–176×；3 个数量级需增量索引（正确性风险最高） |
| 3 | fold characterData 触发是纯浪费 | 半错。characterData 是 live summary 的刻意驱动；只砍结构索引重建 + 已完成块重复派生。且报告完全没写 fold 这一半 |

-----

## 五、优化方案（按 ROI 排序）

### 第〇梯队（最高 ROI，2026-09-14 glm-5.3-flash 评审新增）：宿主属性门控 + 数据驱动

宿主已免费发布、插件尚未消费的现成信号（dsh-client-ui-chat/lib/client.js）：
- 每 seat：data-chat-turn（:1609）、data-chat-flow-kind / data-chat-flow-key（:1607-1608）
- data-turn-process-member / data-turn-process-hidden / data-turn-process-answer（:1610-1612）
- 原生紧凑用 hidden=until-found 隐藏已完成轮次过程行（useSearchableHidden :1484-1505）
- 等价式：member 行原生展开 ⟺ 有 data-turn-process-member 且无 data-turn-process-hidden
- 每个 chat-node 渲染器已下发 owner.turnProcess = {spec, foldable, open, setOpen}（:1560-1570）；turn-metrics 已挂 assistant-step 槽却未读该 prop

插件浪费点：pass() 每帧无条件 findBlocks 全量重建（fold.ts:819），flowItems 不过滤 [hidden]（:2848-2855），逐项 thinkRowsIn/callRowsIn/commandRowsIn（:3140-3141/:3314-3347）+ TreeWalker + segmentMetricsKeys 逐候选查询（:2460）。

改动（一条融合路径）：
1. 用 data-chat-turn 直接取回合号，替代 segmentMetricsKeys 的 [data-turn-tail] 组合查询（清零 ~1210 次）+ [data-dshcf-session]（~202 次）。
2. 用 member/hidden 门控：原生已折叠轮次跳过 blocks/segments 全量派生，仅保留 chip 摘要。
3. host 列表缓存收尾（吸收原 B2 / B5′）。

收益：fold 稳态 DOM 查询 3128 → O(几十)，fold 成本 O(全部项) → O(运行段)。
风险：属性翻转过渡需一次全量 pass（chip 清理依赖 blocks 存在）；normal 模式/旧版属性缺失自动空转回退；user/turn-tail/answer 非 member 不受影响。
可行性：高。与 A1-A4（turn-metrics 结构批次尖峰）正交，可并行。

### 第一梯队：fold 侧（每动画帧兑现）

| # | 改动 | 安全性（R2 实测） |
|---|---|---|
| B1 | invalidateFlowIndexes 只在含非 characterData 记录的批次调用 | 安全。硬约束：保留空批次全量失效 + dirtyMessages 定向失效 + 不改 observer options（fold-animation 断言 characterData===true） |
| B2 | 合并 fold.ts:843(缓存) 与 :859(每 pass 现查) 两处 [data-turn-process] 全扫 | 安全，稳态流式期省 1 次全 flow 扫 |
| B5′ | :1326 每 live 段每帧 flow.querySelectorAll([data-dshcf-turn-metrics]) 改缓存 host 元素列表（键含属性串） | 真正的钱在这里，非 JSON.parse memo |

### 第二梯队：turn-metrics 侧（结构事件兑现，5–176×）

| # | 改动 | 安全性 |
|---|---|---|
| A1+A2+A4 | 以 (order引用, valuesEpoch) 为键，一次 O(N) 建 Map(nodeKey→seg) + Map(turn→keys[])；computeTurnMetrics 按该回合 keys 迭代；cachedSegOrdinal 查表（删 512 LRU） | 等价性成立（R1 在 500 随机 world 上 11044 断言 0 失败）。前提：steering 不进 keysByTurn、segOf 与 fold.buildSegments 对齐（user→seg0、steering→seg++、turn-tail→seg0） |
| A3 | 回合级指纹下沉 | 有陷阱：指纹必须含「该 turn 的 key 集合 + seg 划分」，否则只增/移 steering 会脏命中旧段结果 |

### 第三梯队：B3（最高危，默认不做）
pass() 结构派生按 flow 结构代际缓存。有条件：必须保留内容路径（syncLiveRows/updateChip/runningSince/scrollFollow），否则 fold-live 全破、实时状态冻结；必须加「dirty 消息 hasBody 翻转 → 升级全量 pass」门，否则 fold-regression 场景 10/10c 必破。

### 第四梯队：增量索引（3 个数量级，单独列，默认不做）
只重算受影响回合 → 理想上限 <0.01ms/回合。正确性风险最高（steering 归属/段划分脏命中），待 A+B 落地并真实验证后再评估。

> 附带 items（低优先级）：B4（running 节流，两坑：流结束尾部冲刷、勿节流 attribute/childList/空批次）；C1 同步部署包到 HEAD；C2 停用 @kenz1117/dsh-ui-usage-billing 轮询 / 排除 profile 对 webserver 的整块覆盖；C4 归档三个遗留 md（REMAINING_ISSUES*.md / REVIEW_FINDINGS.md）。

-----

## 六、审查顺带发现的本插件现存 bug（纳入 A 方案一并修）

computeSegOrdinal（turn-metrics.ts:538-559）与 computeTurnMetrics（:270-283）内部 seg 推进顺序不同：前者「先判定回合边界、后 steering++」，后者「先 steering++、后判定边界」。当 steering 带 turn 号且跨回合边界时二者漂移（R1 构造：computeSegOrdinal(b2)=1 但 computeTurnMetrics(turn2,b2)=空）。宿主正常语义（steering 同 turn 插话）不触发；A 方案统一 segOf 来源可顺带消除双算法漂移。

-----

## 七、落地计划与验证（dsh-plugin-dev skill 流程）

1. 隔离 profile plugin-dev:3081 已建（不碰主 3080）。
2. 每步：改 src/ → node build.mjs → node --check（含 client.js banner/footer 守卫）→ node test/run-all.mjs（22 文件全绿）→ npm run typecheck。
3. dsh --profile plugin-dev --dump-config 只读门 → 起 3081 → playwright-cli E2E（基线对比 console/requests + 截图 + 主线程心跳延迟/pass 耗时）。
4. 每小步用只读 subagent 复审（项目约定），重复直到无功能影响。
5. 全部绿后：deploy.mjs（不重启服务）→ 线上验证 → 汇报。
6. 约束：lib/index.js 保持纯 JS；推送只走 dalcui；插件保持 disabled: true 直到 A+B 完成。

-----

## 八、待拍板

1. 范围：建议【第〇梯队（属性门控，最高 ROI）+ 第二梯队 A1-A4（正交并行）】一起做；B1 顺带；响应式接驳（读 owner.turnProcess）作后续加固；B3 / 增量索引不做。
2. 是否现在动手：同意则按第七节推进，每步给进度。
3. 报告更正：第四节的四条修正是否回写进原诊断报告 / 另起附录。
