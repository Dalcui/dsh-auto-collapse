/**
 * host-roster.test.mjs —— node 侧探针路由轻量单测。
 * 直接 import lib/index.js（宿主产物，纯 JS ESM）：如果未来有人把 TS
 * 类型注解写回这个文件，本测试会立即以 SyntaxError 失败——这正是
 * "export const inject: string[] = []" 曾导致 dsh web 启动失败的那类回归。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

const mod = await import(pathToFileURL(join(root, 'lib/index.js')).href)
const { rosterSignatureOf, createRosterHandler } = mod
assert(typeof rosterSignatureOf === 'function' && typeof createRosterHandler === 'function', '宿主产物可被普通 node ESM 直接加载')
// M8：路由常量镜像锁定——host 侧路由漂移会让浏览器侧看门狗 404 误判
// 自身被禁用；client 侧镜像在 roster-constants.ts，两侧必须一致。
assert(mod.ROSTER_ROUTE === '/dsh-auto-collapse/roster', '探针路由与 client 侧镜像一致', String(mod.ROSTER_ROUTE))

// ── 签名与浏览器侧算法一致 ──────────────────────────────────────────────
assert(rosterSignatureOf(['b', 'a', 'b']) === rosterSignatureOf(['a', 'b']), '签名去重且与顺序无关')
assert(rosterSignatureOf(['a']) !== rosterSignatureOf(['a', 'b']), '签名区分不同集合')

// ── handler 正常路径 ──────────────────────────────────────────────────────
function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers },
    end(payload) { this.body = payload ?? '' },
  }
}
{
  const graph = { entries: [{ id: 'dsh-auto-collapse' }, { id: 'other' }, { id: 'dsh-auto-collapse' }] }
  const handler = createRosterHandler(() => ({ graph: () => graph }))
  const req = { method: 'GET' }
  const res = fakeRes()
  handler(req, res)
  assert(res.statusCode === 200, 'GET 返回 200')
  const parsed = JSON.parse(res.body)
  assert(parsed.own === true, 'own=true（自身在列）')
  assert(parsed.sig === rosterSignatureOf(['dsh-auto-collapse', 'other']), 'sig 为去重后的 id 集合签名')
  assert(res.headers['cache-control'] === 'no-store', '响应带 no-store')
  assert(res.headers['content-type'].startsWith('application/json'), '响应为 JSON')
}

// ── R6：无 getConfig 时 config 为 null ────────────────────────────────────
{
  const handler = createRosterHandler(() => ({ graph: () => ({ entries: [{ id: 'dsh-auto-collapse' }] }) }))
  const res = fakeRes()
  handler({ method: 'GET' }, res)
  const parsed = JSON.parse(res.body)
  assert(parsed.config === null, '未接入 getConfig 时 config=null')
}

// ── R6：getConfig 真值透传（5 字段归一） ───────────────────────────────────
{
  const handler = createRosterHandler(
    () => ({ graph: () => ({ entries: [{ id: 'dsh-auto-collapse' }] }) }),
    undefined,
    () => ({
      statusText: '',
      summaryFields: 'duration, outputTokens()',
      codeDescription: 'hover',
      keepLastRows: 3.7,
      keepLastBodySteps: -2,
      extra: 'must-be-dropped',
      nested: { secret: true },
    }),
  )
  const res = fakeRes()
  handler({ method: 'GET' }, res)
  assert(res.statusCode === 200, 'getConfig 正常时 GET 返回 200')
  const parsed = JSON.parse(res.body)
  assert(parsed.config !== null && typeof parsed.config === 'object', 'config 为对象')
  assert(parsed.config.statusText === '', 'statusText 空串透传（用户清空配置是合法值）')
  assert(parsed.config.summaryFields === 'duration, outputTokens()', 'summaryFields 透传')
  assert(parsed.config.codeDescription === 'hover', 'codeDescription 透传')
  assert(parsed.config.keepLastRows === 3, 'keepLastRows 归一为非负整数（3.7→3）')
  assert(parsed.config.keepLastBodySteps === 0, 'keepLastBodySteps 负值归 0')
  assert(!('extra' in parsed.config) && !('nested' in parsed.config), '未知字段被丢弃（不扩大暴露面）')
}

// ── R6：getConfig 异常只丢 config 不丢主响应 ───────────────────────────────
{
  let logged = null
  const handler = createRosterHandler(
    () => ({ graph: () => ({ entries: [{ id: 'dsh-auto-collapse' }] }) }),
    (error) => { logged = error },
    () => { throw new Error('config-boom') },
  )
  const res = fakeRes()
  handler({ method: 'GET' }, res)
  assert(res.statusCode === 200, 'getConfig 异常时 GET 仍 200（配置只是增强）')
  const parsed = JSON.parse(res.body)
  assert(parsed.config === null, 'getConfig 异常时 config=null')
  assert(parsed.own === true, 'getConfig 异常不影响 sig/own')
  assert(logged instanceof Error && logged.message === 'config-boom', 'getConfig 异常被交给日志')
}

// ── handler 非 GET/HEAD ───────────────────────────────────────────────────
{
  const handler = createRosterHandler(() => ({ graph: () => ({ entries: [] }) }))
  const res = fakeRes()
  handler({ method: 'POST' }, res)
  assert(res.statusCode === 405, 'POST 返回 405')
  assert(res.headers.allow === 'GET, HEAD', '405 携带 Allow 头')
}

// ── handler HEAD ──────────────────────────────────────────────────────────
{
  const handler = createRosterHandler(() => ({ graph: () => ({ entries: [{ id: 'dsh-auto-collapse' }] }) }))
  const res = fakeRes()
  handler({ method: 'HEAD' }, res)
  assert(res.statusCode === 200, 'HEAD 返回 200')
}

// ── 模块缺失 / 空图：sig 为空集签名、own=false ───────────────────────────
{
  const handler = createRosterHandler(() => ({}))
  const res = fakeRes()
  handler({ method: 'GET' }, res)
  const parsed = JSON.parse(res.body)
  assert(parsed.own === false, '无 clientModules 时 own=false')
  assert(parsed.sig === rosterSignatureOf([]), '无图时 sig 为空集签名')
}

// ── 异常路径：500 + 不回显内部错误、记录日志 ──────────────────────────────
{
  let logged = null
  const handler = createRosterHandler(() => { throw new Error('boom-secret-detail') }, (error) => { logged = error })
  const res = fakeRes()
  handler({ method: 'GET' }, res)
  assert(res.statusCode === 500, '异常返回 500')
  assert(res.body === 'internal error', '500 不回显内部错误细节')
  assert(logged instanceof Error && logged.message === 'boom-secret-detail', '错误被交给日志')
}

console.log(failures === 0 ? '\nhost-roster: all passed' : '\nhost-roster: ' + failures + ' failure(s)')
if (failures > 0) process.exit(1)
