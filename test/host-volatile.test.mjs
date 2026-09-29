/**
 * host-volatile.test.mjs —— host Config 的 volatile 标记必须真正落到 meta 上。
 *
 * ## 为什么单独立一个文件（P1 回归锁，2026-09-29 真机故障）
 * 症状：设置 → 插件 → dsh-auto-collapse 的配置页**恒显示**
 *       「当前部署未提供该插件的可写配置。」，四个输入框一个都不出现。
 *
 * 根因链（已逐环真机核实）：
 * 1. 宿主 DSH 0.1.7-rc.2 自带的 schemastery 是 **3.18.4**（有 `.volatile()`）；
 * 2. 但本插件**不带 node_modules**，Node 解析 `@deepseek-ai/schemastery` 时从
 *    插件安装目录逐级向上找，命中的是 `~/.dsh/profiles/web/node_modules` 下的
 *    **3.18.1**——而 3.18.1 **没有** `.volatile()`；
 * 3. 旧的 markVolatile 是「没有 volatile 方法就恒等返回」→ 静默退化，
 *    schema 上一个 volatile 标记都没有；
 * 4. 宿主 `SettingsForms.describe()` 调 `volatileForm(schema)`，它逐个字段查
 *    `meta.volatile`，全都没有 → 返回 undefined → 该 entry **整个不进
 *    describe 镜像**（`if (form === void 0) return []`）；
 * 5. 插件的 `configForms.get(ns)` 因此拿不到可写表单 → 卡片渲染兜底文案。
 *
 * 修法：markVolatile 增加 `.extra('volatile', true)` 兜底——它是 3.18.1 就有的
 * 通用元数据写入，标记同样落在 `meta.volatile` 上，宿主读得到。
 *
 * ## 本文件的判别力（如实分档，勿夸大）
 * · **V3/V4/V6（运行时锁，本环境无鉴别力）**：本仓库 node_modules 解析到的是
 *   schemastery **3.18.4**（有 `.volatile()`），所以即使删掉 extra 兜底，标记
 *   依然成立。它们锁的是「最终形态正确」，不锁那条真机故障路径。
 * · **W4（强锁，有鉴别力）**：从 src/index.ts 抽出 markVolatile 的**真实实现**，
 *   用它包装一个「没有 .volatile()、只有 extra()」的 schema（= 真机 profile 的
 *   3.18.1），断言标记仍落到 meta.volatile。实测：删掉 extra 兜底 → W4 立即
 *   FAIL（meta={"default":"x"}）。
 *
 * 同时用**宿主同款 volatileForm 语义**做一次端到端投影：只有当字段带 volatile
 * 时，表单才非空。这条断言与宿主 dsh-settings 的实现逐行同构。
 */
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

const mod = await import(pathToFileURL(join(root, 'lib/index.js')).href)
const { Config } = mod

// ── 1. Config.toJSON() 的 meta.volatile 面 ─────────────────────────────────
const json = Config.toJSON()
const refs = json.refs ?? {}
/** 解引用：schemastery 的 toJSON 用 uid→refs 表共享子树。 */
const deref = (node) => (typeof node === 'number' ? refs[node] : node)
const rootNode = deref(json.uid ?? json)
assert(rootNode !== undefined && rootNode.type === 'object',
  'V1 Config.toJSON() 的根节点可解引用且是 object',
  'type=' + String(rootNode?.type))

const fields = Object.keys(rootNode?.dict ?? {})
assert(fields.length === 5,
  'V2 Config 暴露 5 个配置字段（statusText / summaryFields / codeDescription / keepLastRows / keepLastBodySteps）',
  'fields=' + fields.join(','))

const marked = []
const unmarked = []
for (const key of fields) {
  const child = deref(rootNode.dict[key])
  if (child?.meta?.volatile === true) marked.push(key)
  else unmarked.push(key + '(meta=' + JSON.stringify(child?.meta ?? null) + ')')
}
assert(unmarked.length === 0,
  'V3 全部 5 个字段带 meta.volatile 标记（本环境经 .volatile() 通道达成；3.18.1 路径由下方 W4 强锁覆盖）',
  'unmarked=' + unmarked.join(' | '))
assert(marked.length === 5, 'V4 volatile 标记数量恰为 5', 'marked=' + marked.length)

// ── 2. 宿主 volatileForm 同款投影（端到端：字段真的会进表单）───────────────
// 与 @deepseek-ai/dsh-settings/lib/types/schema.js 的 volatileForm 逐行同构。
function hasVolatileCoverage(node) {
  const n = deref(node)
  if (n?.meta?.volatile === true) return true
  if (n?.type === 'object') {
    return Object.values(n.dict ?? {}).some(child => hasVolatileCoverage(child))
  }
  return false
}
assert(hasVolatileCoverage(rootNode),
  'V5 宿主 volatileForm 口径下本命名空间有可投影字段（否则整个 entry 不进 describe 镜像）')
// 逐字段口径：宿主是「每个字段各自查 meta.volatile」，任一字段缺标记就会从
// 表单里消失（而不是整体消失）——这正是「部分配置项不可见」的形态。
for (const key of fields) {
  assert(hasVolatileCoverage(rootNode.dict[key]),
    'V6.' + key + ' 该字段在宿主表单投影中可见（逐字段 volatile 覆盖）')
}

// ── 3. 解析语义未被破坏（标记不改变「取得到值」这一事实）───────────────────
// ⚠️ 值的**形状**随 schemastery 版本而变（真机两种都出现，均为正确行为）：
//   · 3.18.4（有 .volatile()，本仓库 node_modules 解析到的就是它）→ cordis 解析
//     后把字段包成 { get() } 引用对象（见 src/index.ts 的 deref 注释）；
//   · 3.18.1（profile 里解析到的那个）→ extra('volatile', true) 只写 meta，
//     解析结果仍是普通值。
// 因此这里**不锁定形状**，只锁定「值取得出来」——形状由 apply 的 deref 统一收口，
// 其行为已由 host-settings.test.mjs 的引用对象用例覆盖。
const unwrap = (v) => (v !== null && typeof v === 'object' && typeof v.get === 'function' ? v.get() : v)
const parsed = Config({ statusText: 'custom-text' })
assert(unwrap(parsed?.statusText) === 'custom-text',
  'V7 显式值可取得（解引用后等于输入；形状随 schemastery 版本而变是已知且正确的）',
  'raw=' + JSON.stringify(parsed?.statusText) + ' unwrapped=' + JSON.stringify(unwrap(parsed?.statusText)))
const defaults = Config({})
for (const key of fields) {
  assert(unwrap(defaults?.[key]) !== undefined && unwrap(defaults?.[key]) !== null,
    'V8.' + key + ' 缺省时有默认值（表单初值可渲染）',
    'got=' + JSON.stringify(defaults?.[key]))
}


// ── 4. 真机路径复现：**无 .volatile() 的 schemastery** 下标记仍须成立 ───────
// 上面 V3/V4 用的是宿主解析到的那份 schemastery——在本仓库里它是 3.18.4，
// 自带 .volatile()，所以「删掉 extra 兜底」这种变异**在这里抓不到**。
// 真机故障恰恰发生在 profile 解析到 **3.18.1**（无 .volatile()）的路径上。
//
// 因此这里**直接在测试里复刻那条路径**：取出 src/index.ts 里 markVolatile 的
// 实际实现（用正则抽出函数体，避免双份实现漂移的假绿），把 `candidate.volatile`
// 抹掉模拟 3.18.1，再断言标记仍然落到 meta 上。
// 这是**强锁**：删掉 extra 兜底 → 本段即刻 FAIL。
const hostSource = readFileSync(join(root, 'src/index.ts'), 'utf8')
const fnMatch = hostSource.match(/function markVolatile<[^>]*>\(schema: T\): T \{([\s\S]*?)\n\}/)
assert(fnMatch !== null, 'W1 能从 src/index.ts 抽出 markVolatile 实现（防双份实现漂移）')
if (fnMatch !== null) {
  const body = fnMatch[1]
  assert(/extra\('volatile', true\)/.test(body),
    "W2 markVolatile 体内保留 extra('volatile', true) 兜底（3.18.1 无 .volatile() 时的唯一标记途径）")
  assert(/\.volatile\(\)/.test(body),
    'W3 markVolatile 仍优先使用官方 .volatile()（有该能力时不走兜底）')

  // 复刻真实 3.18.1 的 schema 对象：**没有** volatile 方法，但有 extra。
  // 抽出真实实现后用它包装，观察标记是否落到 meta。
  const makeSchema3181 = () => {
    const meta = { default: 'x' }
    const schema = {
      meta,
      extra(key, value) { meta[key] = value; return schema },
      toJSON() { return { uid: 1, refs: { 1: { type: 'string', meta } } } },
    }
    return schema
  }
  // 剥离 TS 类型注解后才能交给 new Function：本片段只含 `as unknown as {...}`
  // 形式的断言（src/index.ts 的 markVolatile 体内没有别的 TS 语法）。
  // 若将来加入其它 TS 语法，这里会抛错——宁可显式失败，也不要静默假绿。
  const jsBody = body
    .replace(/ as unknown as \{[^}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
  const markVolatileImpl = new Function('schema', jsBody)
  const marked = markVolatileImpl(makeSchema3181())
  assert(marked.meta.volatile === true,
    'W4 无 .volatile() 的 schemastery（3.18.1 真机路径）下标记仍落到 meta.volatile —— 删掉 extra 兜底即 FAIL',
    'meta=' + JSON.stringify(marked.meta))
  // 有 .volatile() 时必须走官方通道（extra 不被调用）。
  let extraCalls = 0
  const schema3184 = {
    meta: {},
    volatile() { this.meta.volatile = true; return this },
    extra() { extraCalls++; return this },
  }
  const viaOfficial = markVolatileImpl(schema3184)
  assert(viaOfficial.meta.volatile === true && extraCalls === 0,
    'W5 有 .volatile() 时优先走官方通道（不被兜底抢走）',
    'volatile=' + String(viaOfficial.meta.volatile) + ' extraCalls=' + extraCalls)
}

if (failures > 0) {
  console.log('\n[' + failures + ' FAILURE(S)]')
  process.exit(1)
}
console.log('\n[ALL PASS]')
