# 移动端流式功耗优化（0.3.10）——测量方法与前后数据

移动端 390×844@DPR3 访问「进行中」会话时明显发热。本文记录复现方法、根因定位与
0.3.9 → 0.3.10 的同一口径前后对比，供后续版本回归对照。

> 结论摘要：流式期间插件自身的主线程成本从 **4.4s/10s 降到 ~16ms/10s（最优轮次 2–7ms）**；
> 工具事件单 pass 的 p95 从 **114–193ms 降到 26–55ms**（4x 限速）；
> CPU profile 里的 `hasInteractionInBlocks` 从 **19–24% self 降到不再入榜**。

---

## 1. 复现环境

| 项 | 取值 |
|---|---|
| 宿主 | DSH Web 0.2.2-rc.3（`dsh web`，本机 127.0.0.1:3080） |
| 插件 | dsh-auto-collapse 0.3.9（基线）/ 0.3.10（改后），其余插件保持原样 |
| 视口 | `Emulation.setDeviceMetricsOverride` 390×844、DPR 3、mobile+touch |
| CPU | `Emulation.setCPUThrottlingRate({rate: 4})` |
| 浏览器 | Chrome 157（headless，独立 user-data-dir） |
| 指标 | `Performance.getMetrics` 取 TaskDuration / ScriptDuration / LayoutDuration / RecalcStyleDuration / LayoutCount / RecalcStyleCount；`MutationObserver` 统计 DOM 变化；`PerformanceObserver('longtask')` 统计长任务；`document.getAnimations()` 排除 core 装饰动画 |

**帧率口径**：headless Chrome 的 rAF 只有 ~8–15Hz，而真机是 60/120Hz。为了让
「流式期间每次 characterData 批次是否触发一次 pass」这一核心频率可复现，测量时用
`setTimeout(…, 16)` 替换页面内 `requestAnimationFrame`（仅调度入口，计时口径不变），
使调度节奏与 60Hz 设备一致。这一替换对改前/改后完全一致，相对关系有效。

**pass 计数**：插件每次成功 pass 都会写 `#dshcf-style[data-dshcf-state]`（同值也触发
MutationObserver 记录），据此计数；单 pass 耗时 = 记录到的 rAF 回调起点到该次写入的
时间差（仅统计 rAF 路径，60ms 兜底路径不计入单次耗时，但计入总数）。

**夹具**（同一历史会话，86 个官方组 / 44 次工具调用；节点数随注入的合成行变化）：
- **稳态流式**：7712 节点（约为用户真机 3958 节点的 2 倍），用 60ms 定时器改写
  最后一条正文的文本节点（等价宿主流式 characterData）；连续测 10s。
- **工具事件尖峰**：7907 节点（每轮先 append 一条工具行克隆，故比流式夹具多 195 个
  节点），每次向官方组内容流 append 一条工具行（结构变化），间隔 1.2–1.5s，共 5 次；
  连测 3 轮，每轮重新加载页面。
- **进行中会话零 mutation**：真实的「进行中」会话（~10.8k 节点），只观察 10s，
  不做任何注入。

---

## 2. 根因定位（0.3.9 基线）

1. **`hasInteractionInBlocks` 每 pass 读 `document.activeElement`**：Blink 的
   `Document::activeElement()` 会触发 `UpdateStyleAndLayoutTreeForNode`。流式
   characterData 刚把样式树弄脏时，一次读取就强制**全文档**样式重算。
   4x 限速下单次 pass 因此多出 ~20ms（占单 pass 70%+）；CPU profile 里
   `hasInteractionInBlocks` 占 **19–24% self**，`RecalcStyleDuration` 占 44%。
2. **每个字符批次都跑全量 pass**：`findBlocks` / `buildSegments` / `reconcileBlock`
   / 可见性判定（`getComputedStyle`）在内容已折叠、DOM 很小时没有收益。
3. **自写回响**：pass 自己插入的 `.dshcf-group-count` 徽标、`.dshcf-native-metrics`
   指标 span、一级行文本都会被自己的 MutationObserver 看到，于是每次工具事件
   产生 2 个 pass（实测 5 次事件 = 10 passes）。

---

## 3. 修法（0.3.10）

1. **纯 characterData 批次走轻量摘要更新**（`FoldController.lightPass`）：
   只刷新实时行计时文本、命中块的 chip 摘要、一级行指标文本、turn-process 公告
   文本；不重建段、不判定显隐、不驱动组。全量调度永远覆盖轻量调度。
2. **交互状态事件驱动**（`installPerfListeners`）：selectionchange / focusin /
   focusout / pointerup / keyup 维护 `selectionActive` / `focusInsideFlow` 两个布尔量；
   pass 里为假时直接跳过精确判定（为真时仍走原有 contains / intersectsNode）。
3. **自写过滤**（`isSelfMutation`）：只把「target 在插件节点内」与「纯插入、且插入的
   全是插件节点」视为自写；**删除方向不过滤**（React 清掉徽标/指标 span 时必须重放，
   否则自愈链断）。
4. **隐藏降频**：`document.hidden` 时跳过 pass，`visibilitychange` 恢复可见时补一次
   全量 pass（从当前 DOM 重建，最终态不丢）。
5. **秒表走轻量路径**：实时行 1s 计时改为 `schedule(true)`，并由 `armLiveTick()` 在
   全量/轻量两条路径都续期（只改文本，不重建）。
6. 附带：`syncProcessedRow` 的 `aria-label` 改为值不变不写。

---

## 4. 前后数据（同一夹具、同一口径）

### 4.1 稳态流式（60ms characterData，10s，7712 节点）

| 指标 | 0.3.9 | 0.3.10 |
|---|---|---|
| pass 次数 / 10s | 155（全部全量） | 156（全部轻量） |
| 单 pass p50 | **26.5ms** | **0.0ms** |
| 单 pass p95 | **61.4ms** | **0.1ms** |
| 单 pass max | 81.3ms | 3.1ms |
| pass 总耗时 | **4428ms** | **16.4ms**（多数轮次 4ms） |
| ScriptDuration | 18.3% | **0.9–1.1%** |
| RecalcStyleCount | 15.8/s | 11.1–12.7/s |
| longtask | 19 次 / 1239ms | 5–6 次 / 297–339ms |

> 剩余的 `RecalcStyle` 与 longtask 来自宿主：正文文本增长必然触发宿主自身的
> 滚动跟随与布局（同夹具下把插件完全停掉，样式重算仍在 10–12 次/s）。
> 插件自身 pass 成本已降到噪声级（16ms/10s）。

### 4.2 进行中会话、零 mutation（10s，~10.8k 节点）

| 指标 | 0.3.9 | 0.3.10 |
|---|---|---|
| pass 次数 / 10s | 27–30（全量） | 9–10（轻量） |
| 单 pass p95 | 81–116ms | **0.3–0.8ms** |
| pass 总耗时 | 705–979ms | **1.4–1.9ms** |
| ScriptDuration | 2.4% | **0.2%** |

> 1 次/s 的轻量 pass 是实时行「已工作 X秒」的秒表；无实时行时 pass 数为 0
> （闭合会话实测 idle 10s = 0 pass）。

### 4.3 工具事件尖峰（5 次结构变化 / 轮，3 轮）

| 指标 | 0.3.9 | 0.3.10 |
|---|---|---|
| 每次事件的 pass 数 | 2（含自写回响） | 1 |
| 单 pass p50 | 69.8–105.5ms | **24.0–36.6ms** |
| 单 pass p95 | 114.2–193.5ms | **25.7–54.9ms** |
| 5 次事件 pass 总耗时 | 643–793ms | **136–227ms** |

> 单次 pass 的剩余成本主要是「新工具行 → 宿主必然要做的全文档样式重算 + 布局」
> 被 pass 内的可见性读取提前到同步路径。尖峰夹具 7907 节点，约为用户真机
> （3958）的 2 倍，按节点数折算 p95 约 13–27ms（4x 限速），低于 30ms 目标。

### 4.4 CPU profile（流式 5s，4x）

| 函数 | 0.3.9 self | 0.3.10 self |
|---|---|---|
| `hasInteractionInBlocks` | **19.3–24.5%** | 不入榜（<0.1%） |
| `querySelectorAll` | 2.3% | 0.2% |
| `(program)`（样式/布局/绘制） | 39–56% | 69%（宿主侧，见 4.1 注） |

---

## 5. 功能不回归核对

- 真实浏览器（0.3.10 部署字节）与 0.3.9 在同一会话的结构性输出逐项一致：
  组计数徽标 44、原生指标 span 4、`hidden=until-found` 214、组根内联 style 0、
  展开组 0（冷启动）、`data-dshcf-state=active` 且无 error。
- 会话 A→B→A 切换后实时行恢复、无错误态；实时行秒表持续走表。
- 自动化：`node test/run-all.mjs` **39 个测试文件全绿**；新增
  `test/fold-perf-pass.test.mjs`（P1–P5）覆盖轻量路径、自写过滤（含删除方向
  自愈）、交互状态、公告文本替换与秒表续期，并做 7 组变异实测（全部被杀死，
  见 `docs/changelog.md` 0.3.10 一节）。

---

## 6. 复现脚本（本地）

测量脚本不入库（依赖本机 DSH 会话与 Chrome），流程：

1. `node build.mjs`，把 `lib/client.js` 拷进 `~/.dsh/profiles/web/node_modules/dsh-auto-collapse/lib/`；
2. Chrome 启动 `--remote-debugging-port=9333`，CDP 依次执行
   `Emulation.setDeviceMetricsOverride` → `setCPUThrottlingRate(4)` → 打开会话；
3. 注入测量脚本：rAF→16ms shim、`#dshcf-style` 属性 MutationObserver（pass 计数）、
   `PerformanceObserver('longtask')`，然后按 §1 的三种夹具施加 mutation；
4. `Performance.getMetrics` 取前后差值，除以墙钟时间得到占比。
