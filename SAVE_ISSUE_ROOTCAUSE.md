# 保存后不生效 —— 根因取证报告（只读排查，未改任何文件）

日期：2026-09-29
排查者：lead（真机取证 + 宿主源码核对）

## 结论（一句话）

**保存请求本身是成功的**（值确实写入 `profiles/web/cordis.patch.yml`），
但插件 **host 侧读配置的数据源是"解析后的冻结快照"**，
在 DSH 0.1.7 的 volatile 热更新路径（`loader/volatile-update` 事件）上**没有监听者**，
因此插件继续用**旧的解析值**，表现为「点了保存没反应 / 不生效」。

现象上"保存失败"是**误判**：UI 的失败横幅（"本部署没有接受这些值"）**没有出现**，
落盘也成功——真正的问题是**新值没有回流到正在运行的插件**。

## 证据链

### E1 写入成功（真机）
- POST `http://127.0.0.1:3080/api/settings/mutate` 请求体：
  ```
  {"method":"settings/mutate","payload":{"args":{
     "ns":"dsh-auto-collapse",
     "ops":[{"op":"set","path":["summaryFields"],"value":"…,retryCalls(重试)"}]}}}
  ```
- 落盘结果（`~/.dsh/profiles/web/cordis.patch.yml` 末段）：
  ```yaml
  - id: dsh-auto-collapse
    name: dsh-auto-collapse
    config:
      summaryFields: duration,modelCalls(次模型),…,contextDelta(上下文),retryCalls(重试)
  ```
- UI 侧：无失败横幅（`failedBanner=false`），字段值保持新值。

### E2 解析值没有回流（真机）
直接调 `settings/describe`：
```json
{"ns":"dsh-auto-collapse",
 "value": {"summaryFields":"duration,modelCalls(次模型),…,contextDelta(上下文)"},   // ← 旧值
 "user":  {"summaryFields":"duration,modelCalls(次模型),…,contextDelta(上下文),zzProbe77"}, // ← 新值
 "base":  {"summaryFields":"duration,modelCalls(次模型),…,contextDelta(上下文)"},
 "revision": 5, "autoGenerate": false}
```
**`user` 已是新值、`value` 仍是旧值** —— 写入生效但解析值未更新。

### E3 宿主机制：volatile 热更新走独立事件（源码）
`dsh/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js`：
- :380 判定 `volatileOnly`：变更仅涉及 config 且 `equalExceptVolatile(...)` 为真；
- :382 `const pending = volatileOnly && this._commitVolatile() ? [] : changes` —— volatile-only 时**不重挂插件**；
- :393-425 `_commitVolatile()`：解析新 raw → 对每个 volatile ref 调 `updateVolatile(ref, source)`（:413），
  然后 **`:420 fiber.ctx.emit(self, "loader/volatile-update", paths)`**。
  → **插件要拿到新值，必须监听 `loader/volatile-update` 或直接读 ref。**

### E4 插件的读取路径（源码）
`src/index.ts`：
- :266 `readOwnSettings(settings, ns)` 读的是 `settings.describe()` 里该 ns 的 `descriptor.value`；
- :292 `hooks.setSource(() => readOwnSettings(settings, ns) ?? entry)`；
- :345 `current` 由 setSource 注入，roster 探针 :369 每请求调用 `current()`。
- 全文件 **grep `loader/volatile-update` = 0 命中**（未监听）。

### E5 交叉印证（真机）
host 探针 `/dsh-auto-collapse/roster` 返回的 `config.summaryFields`
**不含** `retryCalls(重试)`，与 E2 的 `value` 一致 → 证明确实停在旧值。

## 修法建议（待用户确认后再实施）

首选：**在 host 侧监听 `loader/volatile-update`，收到后刷新 `current()` 的数据源**。
但更稳的做法是**绕过 describe() 的 value 快照**，直接读运行期 ref：
- 方案 A（推荐）：apply 时保留 `config` 的 volatile ref 对象（`config.summaryFields.get()` 等），
  `current()` 每次调用都 `ref.get()`。ref 由 `_commitVolatile()` 原地更新（:413 `updateVolatile`），
  因此**无需监听任何事件即可拿到最新值**。
  - 现存实现已经在做 `deref()`（把 ref 解成值）并**只解一次** —— 这正是问题所在：
    解引用后拿到的是**当时的快照**，之后 ref 更新与它无关。
  - 改法：把 `cfg` 从"解引用后的普通值"改为"**惰性 getter**"（每个字段存 ref 或值，读时 `deref`）。
- 方案 B：监听 `ctx.on('loader/volatile-update', …)` 后重新 `describe()`。
  - 风险：describe() 的 value 是否在 commit 后就更新，需再验证；且事件可能在 apply 之前触发。

## 尚未验证 / 需进一步确认

1. 方案 A 是否对**旧版 DSH**（0.1.2-alpha.3 ~ 0.1.6 的 `installSection`）也成立——
   那些版本未必把 config 包成 ref。需保留"ref 或普通值"双形态处理。
2. `describe().value` 是否在 volatile commit **之后**的某次 describe 调用中变为新值
   （即是否只是"缓存未失效"而不是"永不更新"）。这决定方案 B 是否可行。
3. 客户端设置卡片的 `form.state.value` 是否也存在同样的陈旧问题（若是，卡片显示也会滞后）。

## 声明
本报告只做只读排查：**未修改任何源文件**。真机操作仅通过 playwright-cli 读页面/发 describe 请求。

---

# 【追加】第二轮取证（决定性）—— 真正的机制

上文的 E3/E4 推断（"插件没监听 loader/volatile-update"）**方向正确但归因不准**。
经第二轮实测，真正的机制如下：

## D1 决定性实验：3.18.1 **根本不生成 volatile 引用对象**

命令（用 profile 解析到的那份 schemastery 实测）：
```js
const z = require('@deepseek-ai/schemastery');        // profile 的 3.18.1
const mod = await import('.../dsh-auto-collapse/lib/index.js');
mod.Config['~standard'].validate({ summaryFields: 'NEW-VALUE-XYZ' })
```
输出：
```
resolved summaryFields = "NEW-VALUE-XYZ"
is {get()} ref? false                      ← ★ 关键
3.18.1 has .volatile()? false
volatile-marked resolve: "X" ref? false    ← 带 volatile 标记也不生成 ref
```
→ **schemastery 3.18.1 对 volatile 字段完全无感**：既不认 `.volatile()`，
也不会在解析时把字段包成 `{ get() }` 引用对象。

## D2 由此推出的完整因果链（与所有真机观测一致）

1. **宿主 DSH 的 schemastery 是 3.18.4**（有 volatile 语义），而**插件解析到 profile 的 3.18.1**；
2. 配置值落盘 `cordis.patch.yml`（真机已验：`retryCalls(重试)`、`zzProbe77` 都在）；
3. cordis-plugin-loader `:380` 判 `volatileOnly` 的条件里用了
   `equalExceptVolatile(legacy.config, options.config, fiber.runtime?.Config)`，
   而 `equal()`（:259-275）**只认 schema 的 `meta.volatile`**；
   本插件 schema 现在**带** volatile 标记（P1 已修），所以这一步**成立** → `volatileOnly = true`；
4. 于是 `:382` 走 `_commitVolatile()`：它 `resolveConfig(fiber.runtime, raw)` 得到 candidate，
   再对 `volatileEntries(fiber.config)` 里的 ref 逐个 `updateVolatile(ref, source)`；
5. **但 fiber.config 里的字段根本不是 ref**（3.18.1 不生成）→
   `volatileEntries()` 返回空数组 → `:396` `if (!refs.length) return true` **直接返回**，
   **既不更新任何值，也不 emit `loader/volatile-update`**；
6. 与此同时 `:382` 的 `pending = []`（因为 `_commitVolatile()` 返回 true）→
   **插件不会被重挂**、`apply()` 不会重跑；
7. 结果：**内存中的解析值永远停在旧值**，只有磁盘上的 raw 更新了。
   真机交叉印证：
   - `settings/describe` 的 `value` = 旧值（新值只出现在 `user` 段）；
   - roster 探针 `config.summaryFields` = 旧值；
   - 磁盘 `cordis.patch.yml` = 新值。

## D3 因此「保存失败」是**误判**，真实症状是「保存成功但运行中的插件读不到新值」

- UI 没有出现失败横幅（实测 `failedBanner=false`）；
- 值确实落盘（实测文件内容）；
- 只有 **重启 DSH web 服务**后，插件才会用新 raw 重新解析、拿到新值。

## D4 与 P1（volatile 标记丢失）的关系——两个 bug 叠加，互相掩盖

- **修 P1 之前**：schema 无 volatile 标记 → `equalExceptVolatile` 判为**有实质变更**（`volatileOnly=false`）
  → 走**普通更新生命周期**（重挂插件）→ 插件重跑 `apply()` → **反而能读到新值**！
  但那时配置页整个不出现（P1 的症状）。
- **修 P1 之后**：标记齐了 → `volatileOnly=true` → 走 `_commitVolatile()` → 因 3.18.1 不生成 ref
  而**静默空转** → 新值再也回不到内存 → 表现为"保存不生效"。
- 这解释了为什么用户是在**本轮修复之后**才报告这个问题的。

## D5 修法（建议，待确认后实施）

要在 **3.18.1 环境下**让 volatile 热更新真正生效，必须让 `fiber.config` 的字段**真的是 ref 对象**，
或者让插件**自己监听变更**。三个候选：

- **方案 A（推荐，改动最小且直击根因）**：在 host 侧显式监听配置来源的变化并重建数据源。
  具体：`apply()` 里 `ctx.on('loader/volatile-update', ...)` **无用**（3.18.1 下永不触发），
  因此改为**在 roster handler 里每次都重新解析 `ctx.fiber.config` 对应的 raw**，
  或直接读 `configEditor.entries()` 里该 entry 的 `options.config`（磁盘真值，每次现读）。
- **方案 B**：让插件**自带** `schemastery ^3.18.2`（声明 dependency 而非 peerDependency），
  使 3.18.1 不再被解析到 → volatile ref 正常生成 → 官方的 `_commitVolatile()` 自然生效。
  代价：多一份依赖；但语义最正、最贴近官方设计。
- **方案 C**：**放弃 volatile**（把 `markVolatile` 退化为恒等），
  让配置变更走普通重挂生命周期（`volatileOnly=false`）。
  代价：每次改配置会重挂插件（丢失运行期状态、可能闪一下折叠），但**功能正确**。
  注：这也解释了为什么旧版本"能保存"——那时正是这条路。

## D6 尚未验证

1. 方案 B 是否与 DSH 的 peer 约束冲突（dsl 期望插件用宿主提供的 schemastery？）。
2. 方案 A 中 `configEditor` 的读取时机：插件 `apply` 期该服务是否已就绪（现有代码用 `ctx.inject` 兜）。
3. 客户端设置卡的 `form.state.value` 是否也滞后（`mirror.acceptView(response.value)` 用的是服务端返回的
   describe 结果，而该结果的 value 也是旧值 → **卡片会显示旧值**，与用户观感一致）。


---

# 【最终修复记录】P5 已解决（2026-09-29）

## 采用的方案

**方案 D（自造 volatile 引用协议）**——审查者提出的 A/B/C 之外的第 4 条路，也是唯一
**不新增依赖、不重装、不改 DSH 源码**就能让官方热更新机制真正跑通的方案。

### 为什么 A/B/C 都不理想

- **方案 A（插件自带 schemastery ^3.18.2）**：需要改 dependencies 并重装 profile；
  且 schemastery 3.18.4 依赖的 cosmokit createVolatile 在 profile 的 1.8.2 里不存在，
  嵌套解析后仍可能崩（风险未验证）。
- **方案 B（插件读磁盘真值）**：绕开宿主解析链，等于重写一套 base⊕user 合并语义，
  脆弱且偏离官方设计。
- **方案 C（放弃 volatile）**：配置页会重新消失（P1 回归），被排除。

### 方案 D 的两半（缺一不可，第一版只做了前一半）

1. **createVolatileRef**：cosmokit 的 volatile 协议是 `Symbol.for('cosmokit.volatile.write')`
   **全局注册符号**（cosmokit:83），判定 `isVolatile(v) = write in v`（:116-118）。
   插件自造一个带该符号、有 `get()`、`Object.freeze` 的普通对象，宿主 1.8.5 侧的
   `volatileEntries` / `updateVolatile` / `plainConfig` 全部认得。
2. **withVolatileValidate**：把 `Config['~standard'].validate` 包装成
   「先原实现校验，再把 volatile 字段包成 ref」。
   **只做 1 不够**：loader 的 `_commitVolatile` 里 `source` 来自
   `resolveConfig(runtime, raw新)`（loader:400），若它产出普通值，
   `source.get()` 在 loader:410-415 **抛 TypeError 且不在 try 内**——比静默吞掉更糟。
   必须让 **fiber.config 与 candidate 两条解析路径都产出 ref**。
3. **apply 现读**：ref 在 fiber.config 上由 cordis 传入（cordis:1068/1071 证实
   `runtime.callback(this.ctx, this.config)` 与 fiber.config 同一对象），
   `volatileRef()` 检测到已是 ref 就沿用；`snapshot()` 每次调用 `ref.get()`，
   因此热更新后下一次 roster 请求就拿到新值。

### 验证链

| 层级 | 结果 |
|---|---|
| 离线（复刻 loader :410-415，宿主 cosmokit + 部署副本） | volatileEntries=5；updateVolatile 成功；describe() 读到新值 |
| 离线变异 | 禁用 withVolatileValidate → V0 FAIL（变异被杀）；恢复 → 全绿 |
| 真机端到端 | 保存后**输入框保留新值**（修复前回弹旧值）；roster 探针**立即含新标记**（修复前需重启） |
| 全量回归 | 32 个测试文件全部通过；npx tsc --noEmit 干净 |

### 遗留事项（如实记录）

1. 上轮审查的 F4（真机 React 下 beforematch 同步回读 aria-expanded 大概率是旧值，
   实际生效机制可能是 focus 中和而非 beforematch）**尚未真机复核**——P2 的用户可见
   效果（视口 0 位移）已实测，但机制归属需要 clicks 计数验证。
2. 上轮审查的 F6/F7/F8（注释与文档措辞问题）已部分修正，F7（covered.length 注释）
   与 D5 文件头的完整修正待本轮终审确认后处理。
3. profile 的 schemastery 3.18.1 由 dsh-custom-provider-settings@0.5.0 的
   `^3.18.1` hoist 造成；若未来该依赖升级，方案 D 的包装会自动退化为透传
   （attachVolatileRefs 检测到已是 ref 就跳过），无需回滚。


---

# 【收尾】终审与提交（2026-09-30）

- **终审**（只读 teammate，逐行核对依赖源码 + 独立复现变异测试）：R1–R7 全部通过，
  无【阻塞】级问题，结论「**可合并**」。
- 终审发现并已修正：
  1. F5 的 restoreUnusedDisplays 此前实际挪错位置（仍在 chip 循环之前）且注释失实——
     已真正移到 chip 循环之后并改正注释；
  2. 死代码 `readVolatileRef` 已删除；
  3. 头部注释里的版本号表述已改为版本无关（当前 profile 实测非 3.18.1，代码是能力检测）。
- **附带事件**：排查期间 profile 的 cordis.patch.yml 曾被并发写入 `disabled: true`
  导致插件整体消失（roster 404 / describe 无 ns）——已移除并重启恢复。与本次代码无关，
  但提示并发 agent 会改 profile，需留意。
- 测试：32 个文件全绿；`npx tsc --noEmit` 干净。
