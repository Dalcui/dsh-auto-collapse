/**
 * 安全部署：build → 校验安装目标 → 备份 → 替换 → 仅重启已确认的 DSH web
 * 进程 → 校验服务端 bundle。任一步失败都会恢复备份并重启旧版本。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
      throw new Error(`端口 ${WEB_PORT} 的页面不是当前 DSH profile，拒绝停止`)
    }
  }
  const unexpected = active.filter(processInfo => !isExpectedDshWeb(processInfo))
  if (unexpected.length > 0) {
    const detail = unexpected.map(processInfo => `${processInfo.pid}: ${processInfo.commandLine ?? '<unknown>'}`).join('\n')
    throw new Error(`端口 ${WEB_PORT} 被非 DSH web 进程占用，拒绝停止:\n${detail}`)
  }
  for (const processInfo of active) {
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Stop-Process -Id ${Number(processInfo.pid)} -ErrorAction Stop`,
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
  return active.length
}

function startWeb() {
  mkdirSync(LOG_DIR, { recursive: true })
  const outFd = openSync(join(LOG_DIR, 'web.out.log'), 'a')
  const errFd = openSync(join(LOG_DIR, 'web.err.log'), 'a')
  let child
  try {
    child = spawn(process.execPath, [join(DSH_DIR, 'lib/bin.js'), 'web'], {
      cwd: DSH_DIR,
      detached: true,
      stdio: ['ignore', outFd, errFd],
    })
  } finally {
    closeSync(outFd)
    closeSync(errFd)
  }
  if (child.pid === undefined) throw new Error('DSH web 进程启动失败')
  child.unref()
  return child.pid
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function verifyServedBundle(expectedHash) {
  const html = (await fetchBytes(`http://127.0.0.1:${WEB_PORT}/`)).toString('utf8')
  const match = html.match(/dsh-auto-collapse\/client\.js\?rev=([a-f0-9]+)/)
  if (match === null) throw new Error('首页未找到 dsh-auto-collapse client 入口')
  const bytes = await fetchBytes(
    `http://127.0.0.1:${WEB_PORT}/plugins/dsh-auto-collapse/client.js?rev=${match[1]}`,
  )
  const servedHash = sha256Bytes(bytes)
  if (servedHash !== expectedHash) throw new Error(`服务端 bundle 哈希不匹配: ${servedHash}`)
  return match[1]
}

console.log('[1/5] 构建并校验目标')
run(process.execPath, [join(root, 'build.mjs')])
validateTargets()

const built = join(root, 'lib/client.js')
const target = join(INSTALLED_LIB_DIR, 'client.js')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${target}.backup-${stamp}`
const expectedHash = sha256File(built)
let replaced = false

console.log('[2/5] 备份并替换安装副本')
copyFileSync(target, backup)
console.log(`      备份: ${backup}`)

try {
  copyFileSync(built, target)
  replaced = true
  if (sha256File(target) !== expectedHash) throw new Error('复制后哈希不一致')

  console.log('[3/5] 核验并停止旧 DSH web')
  const stopped = await stopExpectedWeb()
  console.log(`      已停止 ${stopped} 个已确认进程`)

  console.log('[4/5] 启动 DSH web')
  const pid = startWeb()
  console.log(`      新进程 PID ${pid}`)
  await sleep(4000)

  console.log('[5/5] 验证服务端 bundle')
  const revision = await verifyServedBundle(expectedHash)
  console.log(`      rev=${revision} sha256=${expectedHash.slice(0, 12)}...`)
  console.log('\n部署完成；浏览器刷新后生效。')
} catch (error) {
  console.error(`\n部署失败: ${error instanceof Error ? error.message : String(error)}`)
  if (replaced) {
    console.error('正在恢复备份并重启旧版本...')
    copyFileSync(backup, target)
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
