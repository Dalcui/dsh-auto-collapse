/**
 * deploy.mjs — 快速部署：build → 覆盖已安装副本 → 重启 DSH web 服务。
 *
 * 不 bump 版本号：pnpm 对同 spec 的 file: 依赖不会重装（“Already up to
 * date”），但 DSH web 服务的 bundle rev 按文件内容 hash 计算，直接覆盖
 * node_modules 里的 client.js + 重启服务即可生效，无需改版本。
 *
 * 用法：node deploy.mjs
 */
import { execSync, spawnSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync, openSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

// ---- 本机部署路径（按需修改） ----
const INSTALLED_LIB_DIR = 'C:/Users/a179/.dsh/profiles/web/node_modules/dsh-auto-collapse/lib'
const DSH_DIR = 'C:/Users/a179/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh'
const WEB_PORT = 3080
const LOG_DIR = 'C:/Users/a179/.dsh/logs'

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts })
  if (r.status !== 0) throw new Error(`command failed (${cmd}):\n${r.stderr ?? r.stdout}`)
  return r.stdout.trim()
}

console.log('[1/4] build lib/client.js …')
sh(`node "${join(root, 'build.mjs')}"`)

const built = join(root, 'lib/client.js')
const target = join(INSTALLED_LIB_DIR, 'client.js')

console.log('[2/4] 覆盖已安装副本 …')
cpSync(built, target)
const h1 = sha256(built)
const h2 = sha256(target)
if (h1 !== h2) throw new Error('复制后哈希不一致')
console.log(`      client.js ${h1.slice(0, 12)}… ✓`)

console.log('[3/4] 重启 DSH web 服务 …')
try {
  const pid = sh(
    `powershell -Command "(Get-NetTCPConnection -LocalPort ${WEB_PORT} -State Listen).OwningProcess"`,
  )
  if (pid !== '') {
    sh(`powershell -Command "Stop-Process -Id ${pid.trim()} -Force"`)
    console.log(`      旧进程 ${pid.trim()} 已停止`)
  } else {
    console.log('      3080 无监听进程（首次部署）')
  }
} catch {
  console.log('      3080 无监听进程（首次部署）')
}
await new Promise(r => setTimeout(r, 1000))
// 用 node spawn 启动（detached + unref），避免 powershell Start-Process 在
// 管道环境下挂起（子进程继承句柄导致 powershell 不退出）。
const nodeBin = process.execPath
mkdirSync(LOG_DIR, { recursive: true })
const outLog = join(LOG_DIR, 'web.out.log')
const errLog = join(LOG_DIR, 'web.err.log')
const child = spawn(nodeBin, ['lib/bin.js', 'web'], {
  cwd: DSH_DIR,
  detached: true,
  stdio: ['ignore', openSync(outLog, 'a'), openSync(errLog, 'a')],
})
child.unref()
await new Promise(r => setTimeout(r, 4000))

console.log('[4/4] 验证服务端 bundle …')
const html = sh(`curl -s --max-time 8 http://127.0.0.1:${WEB_PORT}/`)
const m = html.match(/dsh-auto-collapse\/client\.js\?rev=([a-f0-9]+)/)
if (m === null) throw new Error('首页未找到 dsh-auto-collapse client 入口')
const tmp = join(root, '.deploy-served.tmp.js')
sh(`curl -s --max-time 8 "http://127.0.0.1:${WEB_PORT}/plugins/dsh-auto-collapse/client.js?rev=${m[1]}" -o ${tmp}`)
const served = sha256(tmp)
rmSync(tmp, { force: true })
if (served !== h1) throw new Error(`服务端 bundle 哈希不匹配：${served}`)
console.log(`      服务端 rev=${m[1]} 哈希一致 ✓`)
console.log('\n部署完成。浏览器 Ctrl+Shift+R 硬刷新生效。')
