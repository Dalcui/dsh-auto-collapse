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
