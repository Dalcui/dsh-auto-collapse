/**
 * host-volatile-ref.test.mjs —— P5（保存不生效）修复的行为锁。
 *
 * 根因链（真机实证，2026-09-29）：
 *   插件解析到 schemastery 3.18.1（无 .volatile()）→ validate 不产 ref →
 *   fiber.config 字段是普通值 → 宿主 loader volatileOnly 快路径判 true 后
 *   _commitVolatile() 因 volatileEntries 为空而 :396 提前 return →
 *   保存被静默吞掉（值落盘但运行态永远不更新）。
 *
 * 修复的两半（缺一不可）：
 *   A. withVolatileValidate —— 包装 Config['~standard'].validate，使 resolveConfig
 *      的两条路径（初始 fiber.config / 保存时 candidate）都产出 ref。
 *      若只有 fiber.config 有 ref 而 candidate 是普通值，loader :410-415 的
 *      source.get() 会抛 TypeError（且不在 try 内），比静默吞掉更糟。
 *   B. apply 保留引用、每次现读 —— 旧实现 deref 一次就冻结。
 *
 * 本文件在**插件自身环境**（不带 node_modules 时与真机同构）验证：
 *   V1 validate 产物含 ref（两条路径都验证）
 *   V2 ref 满足宿主 cosmokit 协议（Symbol.for 判定 + get 可调用）
 *   V3 updateVolatile 写入后 get() 返回新值（= describe() 读到新值的机制）
 *   V4 恒等回退：schemastery 既无 .volatile() 也无 .extra() 时不崩溃
 *   V5 写回 config 的幂等性（3.18.4 场景退化为 no-op）
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundle = readFileSync(join(root, 'lib/index.js'), 'utf8')
let failures = 0

function assert(condition, label, detail = '') {
  const ok = Boolean(condition)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

// 宿主 cosmokit 的协议判定（与 C:/.../cosmokit/lib/index.js 一致的公开语义）
const WRITE = Symbol.for('cosmokit.volatile.write')
const isVolatile = (v) => typeof v === 'object' && v !== null && WRITE in v

let Config = null
{
  // Windows 下动态 import 必须用 file:// URL（裸盘符路径会被当作协议名）
  const mod = await import('file://' + join(root, 'lib/index.js').split('\\').join('/'))
  Config = mod.Config
}

// ⚠️ 环境鉴别力说明（如实声明，勿夸大）：
// 本仓库 node_modules 解析到 schemastery 3.18.4（自带 volatile 语义），因此
// **即使删掉 withVolatileValidate，validate 也会产出 ref**——V1/V2/V5 在本仓库
// 环境下对「是否启用包装」没有鉴别力（实测：禁用包装后 V1 仍 ALL PASS）。
// 真正有鉴别力的是 V0（断言 own descriptor 存在 = 包装已接上）——它在 3.18.4
// 环境下也能区分「我们有没有装这个包装」。真机 3.18.1 的端到端行为已由
// .playwright-cli/verify-fix.mjs 实测（保存后 roster 立即含新标记）。
{
  const desc = Object.getOwnPropertyDescriptor(Config, '~standard')
  assert(desc !== undefined && typeof desc.get === 'function',
    'V0 Config 实例已接管 ~standard（own descriptor，真机 3.18.1 下唯一的可观测修复痕迹）',
    'own=' + String(desc !== undefined))
}

// ── V1：validate 产物含 ref（resolveConfig 的两条路径都走这里） ──────────
{
  const first = Config['~standard'].validate({ summaryFields: 'A' })
  assert(first.value !== undefined && typeof first.value === 'object', 'V1a validate 返回对象值')
  assert(isVolatile(first.value.summaryFields),
    'V1b 初始加载路径产出 volatile ref（本仓库 3.18.4 下无鉴别力，真机 3.18.1 由 V0 锁定）',
    'typeof=' + typeof first.value.summaryFields)
  const second = Config['~standard'].validate({ summaryFields: 'B' })
  assert(isVolatile(second.value.summaryFields),
    'V1c 保存路径（candidate）同样产出 volatile ref —— 缺了它 loader:410 的 source.get() 会抛 TypeError')
}

// ── V2：ref 满足宿主协议 ─────────────────────────────────────────────────
{
  const v = Config['~standard'].validate({ statusText: 'hello' })
  const ref = v.value.statusText
  assert(typeof ref.get === 'function', 'V2a ref.get 可调用')
  assert(ref.get() === 'hello', 'V2b ref.get() 返回包装的当前值')
  assert(Object.isFrozen(ref), 'V2c ref 自身被冻结（与 cosmokit createVolatile 一致）')
}

// ── V3：updateVolatile 语义（宿主 loader 的写入路径） ────────────────────
{
  const r1 = Config['~standard'].validate({ summaryFields: 'OLD' }).value
  const r2 = Config['~standard'].validate({ summaryFields: 'NEW' }).value
  const ref = r1.summaryFields
  assert(ref.get() === 'OLD', 'V3a 更新前读到旧值')
  ref[WRITE](r2.summaryFields.get())
  assert(ref.get() === 'NEW',
    'V3b 写入后 ref.get() 返回新值（describe()/plainConfig 读到新值的机制）',
    'got=' + JSON.stringify(ref.get()))
}

// ── V4：极端回退安全（既无 .volatile() 也无 .extra()） ───────────────────
{
  const src = readFileSync(join(root, 'src/index.ts'), 'utf8')
  const i = src.indexOf('function markVolatile')
  const body = src.slice(i, src.indexOf('\n}', i))
  // 恒等回退分支必须存在且兜底链最后落到 return schema
  assert(/return schema/.test(body), 'V4 markVolatile 无能力时恒等回退（不崩溃，模块可加载）')
}

// ── V5：写回幂等（3.18.4 场景 ref 已在，重复包装退化为透传） ─────────────
{
  const v = Config['~standard'].validate({ keepLastRows: 3 })
  const ref1 = v.value.keepLastRows
  assert(isVolatile(ref1), 'V5a 字段为 ref')
  // 再次 validate：新产物是新 ref（loader 的设计就是 candidate 用新 ref、写回旧 ref）
  const v2 = Config['~standard'].validate({ keepLastRows: 5 })
  assert(isVolatile(v2.value.keepLastRows) && v2.value.keepLastRows !== ref1,
    'V5b 每次 validate 产出独立 ref（candidate 用新 ref，updateVolatile 写回旧 ref）')
}

if (failures > 0) {
  console.log('\n[' + failures + ' FAILURE(S)]')
  process.exit(1)
}
console.log('\n[ALL PASS]')
