/**
 * 安全部署：build → 校验安装目标 → 备份 → 替换 → 仅重启已确认的 DSH web
 * 进程 → 校验服务端 bundle。任一步失败都会恢复备份并重启旧版本。
 *
 * --verify：只读验证模式——默认跳过构建，只对运行中的服务执行 bundle
 *   校验（基于工作区现有 lib/client.js 字节），不触碰安装副本、不重启服务；
 *   加 --build（--verify --build）先重建再校验。
 * 登录态：DSH web 启用登录时，设置环境变量 DSH_WEB_COOKIE=<浏览器登录后
 *   的 Cookie 串>，所有页面请求自动携带；未设置则匿名请求（默认无鉴权部署）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import net from 'node:net'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const userProfile = process.env.USERPROFILE
const appData = process.env.APPDATA
if (userProfile === undefined || appData === undefined) {
  throw new Error('缺少 USERPROFILE 或 APPDATA，无法定位 DSH 安装目录')
}

const INSTALLED_LIB_DIR = process.env.DSH_AUTO_COLLAPSE_LIB
  ?? join(userProfile, '.dsh/profiles/web/node_modules/dsh-auto-collapse/lib')
const DSH_DIR = process.env.DSH_DIR
  ?? join(appData, 'npm/node_modules/@deepseek-ai/dsh')
const WEB_PORT = Number(process.env.DSH_WEB_PORT ?? 3080)
const LOG_DIR = process.env.DSH_LOG_DIR ?? join(userProfile, '.dsh/logs')
if (!Number.isInteger(WEB_PORT) || WEB_PORT < 1 || WEB_PORT > 65535) {
  throw new Error(`无效 DSH_WEB_PORT: ${process.env.DSH_WEB_PORT ?? ''}`)
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${command} 退出码 ${result.status}${detail === '' ? '' : `:\n${detail}`}`)
  }
  return (result.stdout ?? '').trim()
}

function readPackageName(directory) {
  const file = join(directory, 'package.json')
  if (!existsSync(file)) throw new Error(`缺少 package.json: ${file}`)
  return JSON.parse(readFileSync(file, 'utf8')).name
}

function validateTargets() {
  const pluginRoot = dirname(INSTALLED_LIB_DIR)
  if (readPackageName(pluginRoot) !== 'dsh-auto-collapse') {
    throw new Error(`部署目标不是 dsh-auto-collapse: ${pluginRoot}`)
  }
  if (readPackageName(DSH_DIR) !== '@deepseek-ai/dsh') {
    throw new Error(`DSH_DIR 不是 @deepseek-ai/dsh: ${DSH_DIR}`)
  }
  const target = join(INSTALLED_LIB_DIR, 'client.js')
  if (!existsSync(target)) throw new Error(`安装副本不存在: ${target}`)
}

function listeners() {
  const script = [
    `$items = Get-NetTCPConnection -LocalPort ${WEB_PORT} -State Listen -ErrorAction SilentlyContinue`,
    '$result = @()',
    'foreach ($item in $items) {',
    '  $ownerId = [int]$item.OwningProcess',
    '  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction SilentlyContinue',
    '  if ($null -ne $process) {',
    '    $result += [pscustomobject]@{ pid = $ownerId; commandLine = $process.CommandLine; executablePath = $process.ExecutablePath }',
    '  }',
    '}',
    '$result | ConvertTo-Json -Compress',
  ].join('; ')
  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  if (output === '') return []
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function isExpectedDshWeb(processInfo) {
  const command = String(processInfo.commandLine ?? '').replaceAll('\\', '/').toLowerCase()
  const expectedDir = resolve(DSH_DIR).replaceAll('\\', '/').toLowerCase()
  const absoluteEntry = command.includes(expectedDir) && command.includes('lib/bin.js')
  const legacyRelativeEntry = /(?:^|\s)["']?lib\/bin\.js["']?(?:\s|$)/.test(command)
  return (absoluteEntry || legacyRelativeEntry) && /\bweb\b/.test(command)
}

async function stopExpectedWeb() {
  const active = listeners()
  if (active.length > 0) {
    const html = (await fetchBytes(`http://127.0.0.1:${WEB_PORT}/`)).toString('utf8')
    if (!html.includes('dsh-auto-collapse/client.js')) {
      throw new Error(homeMismatchHint(html, WEB_PORT))
    }
  }
  const unexpected = active.filter(processInfo => !isExpectedDshWeb(processInfo))
  if (unexpected.length > 0) {
    const detail = unexpected.map(processInfo => `${processInfo.pid}: ${processInfo.commandLine ?? '<unknown>'}`).join('\n')
    throw new Error(`端口 ${WEB_PORT} 被非 DSH web 进程占用，拒绝停止:\n${detail}`)
  }
  for (const processInfo of active) {
    // TOCTOU 收紧：快照到停止之间进程可能退出/被替换（pid 复用会误杀）。
    // 停止前对该 pid 重取身份复验；已消失则跳过，身份不符则拒绝。
    const current = listeners().find(p => Number(p.pid) === Number(processInfo.pid))
    if (current === undefined) continue
    if (!isExpectedDshWeb(current)) {
      throw new Error(`pid ${current.pid} 在停止前身份变化，拒绝停止: ${current.commandLine ?? '<unknown>'}`)
    }
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Stop-Process -Id ${Number(current.pid)} -ErrorAction Stop`,
    ])
  }
  for (let attempt = 0; attempt < 20 && listeners().length > 0; attempt++) await sleep(250)
  const remaining = listeners()
  for (const processInfo of remaining) {
    if (!isExpectedDshWeb(processInfo)) throw new Error(`端口 ${WEB_PORT} 的监听进程在等待期间发生变化`)
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Stop-Process -Id ${Number(processInfo.pid)} -Force -ErrorAction Stop`,
    ])
  }
  // 端口「无 LISTEN 行」≠「可绑定」：Windows 下旧 socket 释放有延迟，
  // 新进程立刻 bind 会 EADDRINUSE 进 cordis 慢重试，部署验证窗口内起不来
  // （实测两次连续复现）。启动前显式等待端口可绑定。
  await waitForPortBindable(WEB_PORT, 15000)
  return active.length
}

/** 探测端口当前是否可绑定（试绑后立即释放）。 */
function portBindable(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen({ port, host: '127.0.0.1' })
  })
}

async function waitForPortBindable(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!(await portBindable(port))) {
    if (Date.now() > deadline) throw new Error(`端口 ${port} 在 ${timeoutMs}ms 内仍不可绑定`)
    await sleep(250)
  }
}

function startWeb() {
  mkdirSync(LOG_DIR, { recursive: true })
  const outLog = join(LOG_DIR, 'web.out.log')
  const errLog = join(LOG_DIR, 'web.err.log')
  const nodeBin = process.execPath
  const bin = join(DSH_DIR, 'lib/bin.js')
  // node 原生 detached spawn：windowsHide 抑制「无控制台父进程的 console 子
  // 进程新建可见控制台」的弹窗问题（等价旧 Start-Process -WindowStyle Hidden，
  // 但路径作为 argv 数组传递，无引号拼接/注入脆弱性；PS 5.1 的 Start-Process
  // 配重定向会同步等待子进程退出卡死部署，故弃用）。stdio 落日志文件，
  // 部署失败后有持久输出可排错。追加模式保留历史。
  const out = openSync(outLog, 'a')
  const err = openSync(errLog, 'a')
  try {
    const child = spawn(nodeBin, [bin, 'web'], {
      cwd: DSH_DIR,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err],
    })
    child.unref()
    return child.pid ?? null
  } finally {
    closeSync(out)
    closeSync(err)
  }
}

/** 登录态 Cookie（DSH_WEB_COOKIE 环境变量）；空串 = 匿名请求。 */
const WEB_COOKIE = process.env.DSH_WEB_COOKIE ?? ''

async function fetchBytes(url) {
  const headers = WEB_COOKIE === '' ? undefined : { cookie: WEB_COOKIE }
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers })
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** 从首页 HTML 提取本插件 client bundle 的 rev 参数。新版 DSH 把多个客户端
 * 插件合并为一个 bundle：/plugins/??a/client.js,b/client.js&rev=xxx（分隔符
 * &，本插件在逗号列表内）；单插件时代为 /plugins/x/client.js?rev=xxx。两种都认。 */
function extractClientRev(html) {
  // rev 要求 8-64 位 hex 且带边界断言：避免非 hex 字符场景取到前缀子串
  // 拼出错误 URL（当前 DSH 实测为 12 位 hex + 字面 &，两种格式都命中）。
  const merged = html.match(/dsh-auto-collapse\/client\.js(?:,[^"'&\s]*)?&rev=([a-f0-9]{8,64})(?=["'&\s]|$)/)
  if (merged !== null) return merged[1]
  const single = html.match(/dsh-auto-collapse\/client\.js\?rev=([a-f0-9]{8,64})(?=["'&\s]|$)/)
  return single === null ? null : single[1]
}

/** 首页内容与预期不符时的报错提示；识别登录页给出可操作的修复指引。 */
function homeMismatchHint(html, port) {
  if (!html.includes('__DSH_BOOT__')) {
    return `端口 ${port} 的页面不是 DSH web 首页（疑似登录页：DSH web 启用登录时匿名请求拿不到真实首页）。请设置 DSH_WEB_COOKIE 为浏览器登录后的 Cookie 后重试，或确认端口指向目标 profile`
  }
  return `端口 ${port} 的页面未引用 dsh-auto-collapse client 入口，拒绝继续`
}

async function verifyServedBundle(expectedBytes) {
  // 参数断言：本函数做字节包含校验，传 sha256 hex 字符串会恒不命中
  // （曾因此让每次完整部署必然失败并回滚——审查 P0）。
  if (!Buffer.isBuffer(expectedBytes)) {
    throw new Error(`verifyServedBundle 需要 Buffer 参数，收到 ${typeof expectedBytes}`)
  }
  // 新进程可能经 cordis 慢重试才完成端口绑定（EADDRINUSE 竞态），轮询等服务就绪
  const deadline = Date.now() + 30000
  let html
  for (;;) {
    try {
      html = (await fetchBytes(`http://127.0.0.1:${WEB_PORT}/`)).toString('utf8')
      break
    } catch (error) {
      if (Date.now() > deadline) throw error
      await sleep(500)
    }
  }
  const rev = extractClientRev(html)
  if (rev === null) throw new Error(homeMismatchHint(html, WEB_PORT))
  // 新 DSH 单插件路由 /plugins/<id>/client.js?rev= 已 404（实测），只有合并
  // 路由 /plugins/??<id>/client.js&rev= 返回 200；统一走合并路由。
  const servedBytes = await fetchBytes(
    `http://127.0.0.1:${WEB_PORT}/plugins/??dsh-auto-collapse/client.js&rev=${rev}`,
  )
  // 实测（2026-09）：合并路由响应 = 参与合并的各插件 bundle 按序拼接 + 尾部
  // sourcemap 注释，并非单插件字节原样返回，整包 hash 与本地构建永不相等。
  // 校验口径改为「响应包含本地构建的完整字节」：新构建内容与旧字节不同，
  // 旧服务不会包含新字节——与整包 hash 等价的强校验。
  if (servedBytes.indexOf(expectedBytes) === -1) {
    throw new Error(
      `服务端合并 bundle 未包含本次构建的 client.js（本地 sha ${sha256Bytes(expectedBytes).slice(0, 12)}…，服务端 ${servedBytes.length} 字节）`,
    )
  }
  return rev
}

// --verify 默认跳过构建（真只读：不重写工作区 lib/ 产物；仍会改写时加 --build）。
const verifyOnly = process.argv.includes('--verify')
const rebuildForVerify = verifyOnly && process.argv.includes('--build')
if (!verifyOnly || rebuildForVerify) {
  console.log('[1/5] 构建并校验目标')
  run(process.execPath, [join(root, 'build.mjs')])
}
validateTargets()

const built = join(root, 'lib/client.js')
const target = join(INSTALLED_LIB_DIR, 'client.js')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${target}.backup-${stamp}`
const expectedBytes = readFileSync(built)
const expectedHash = sha256Bytes(expectedBytes)

// --verify：只读验证模式。构建与目标校验之后、备份替换之前退出，只对运行
// 中的 DSH web 执行 bundle 校验，不触碰安装副本、不重启服务。用于部署后核
// 对与部署脚本本身的安全联调（验证逻辑与完整部署共用同一份代码）。
if (verifyOnly) {
  try {
    console.log('[verify] 只读校验运行中的服务端 bundle（不修改安装副本）')
    const rev = await verifyServedBundle(expectedBytes)
    console.log(`      rev=${rev} 校验通过`)
  } catch (error) {
    console.error(`[verify] 校验失败: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
} else {
  await deploy()
}

/**
 * 完整部署主流程（--verify 模式不进入）。
 * 注意：本文件禁用 process.exit 提前终止——undici fetch 的 AbortSignal.timeout
 * 定时器句柄在 exit 时可能处于 closing 状态，Windows 上触发 libuv 断言崩溃
 * （实测 Node 24）。统一用自然退出 + process.exitCode。
 */
async function deploy() {
// 除 client.js 外还需与仓库保持一致的运行时文件：package.json 的 dsh.client.inject
// 决定宿主向 client 注入哪些服务（缺服务则设置卡片静默不渲染），lib/index.js 是
// 宿主半（settings 命名空间注册）。deploy 只做热同步，不触发 npm 安装。
const extraFiles = [
  { rel: 'package.json', src: join(root, 'package.json') },
  { rel: 'lib/index.js', src: join(root, 'lib', 'index.js') },
]
let replaced = []   // { target, backup } —— 失败时按序恢复

console.log('[2/5] 备份并替换安装副本')
copyFileSync(target, backup)
replaced.push({ target, backup })
for (const { rel, src } of extraFiles) {
  const dest = join(INSTALLED_LIB_DIR, '..', rel)
  if (!existsSync(dest)) continue
  const b = `${dest}.backup-${stamp}`
  copyFileSync(dest, b)
  copyFileSync(src, dest)
  replaced.push({ target: dest, backup: b })
}
console.log(`      备份: ${backup} 等 ${replaced.length} 个文件`)
try {
  copyFileSync(built, target)
  if (sha256File(target) !== expectedHash) throw new Error('复制后哈希不一致')

  console.log('[3/5] 核验并停止旧 DSH web')
  const stopped = await stopExpectedWeb()
  console.log(`      已停止 ${stopped} 个已确认进程`)

  console.log('[4/5] 启动 DSH web')
  const pid = startWeb()
  console.log(`      新进程 PID ${pid}`)
  await sleep(4000)

  console.log('[5/5] 验证服务端 bundle')
  const revision = await verifyServedBundle(expectedBytes)
  console.log(`      rev=${revision} sha256=${expectedHash.slice(0, 12)}...`)
  console.log('\n部署完成；浏览器刷新后生效。')
} catch (error) {
  console.error(`\n部署失败: ${error instanceof Error ? error.message : String(error)}`)
  if (replaced.length > 0) {
    console.error('正在恢复备份并重启旧版本...')
    for (const { target: t, backup: b } of replaced) copyFileSync(b, t)
    try {
      await stopExpectedWeb()
      startWeb()
      await sleep(2000)
      console.error('旧 bundle 已恢复。')
    } catch (rollbackError) {
      console.error(`回滚后重启失败: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
    }
  }
  process.exitCode = 1
}
}
