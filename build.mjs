/**
 * dsh-auto-collapse 构建脚本。
 *
 * 产出：
 *   lib/index.js   —— host half：esbuild 从 src/index.ts 编译（esm、node、
 *                     external schemastery、target es2020），纯 JS 产物。
 *                     单一事实源在 src/index.ts，杜绝「改 src 忘同步手工
 *                     版」的双源漂移（R4）。
 *   lib/client.js  —— browser bundle：自包含 iife，执行时向
 *                     window.__ModuleLoader__.load({ id, factory }) 注册。
 *
 * 构建器：本地 devDependency esbuild（JS API）。不用 spawn CLI：Windows 下
 * 经 shell 传 banner/footer 这类含引号与括号的参数会被 cmd 拆坏。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** P7：从 esbuild metafile 取 src 实际导出符号，与手工维护的 lib/types/*.d.ts
 * 声明比对——声明缺失会中止构建（d.ts 漂移挡在构建期），声明多余只告警。
 * 已知盲区：声明正则只覆盖 export const/function 形式（当前 d.ts 全为此形式）；
 * export default/export{a,b}/class 等形式将来出现时会产生假阴性——届时扩展正则。 */
function declaredExports(dtsPath) {
  const text = readFileSync(dtsPath, 'utf8')
  const names = new Set()
  // 只比对值导出（const/function）：interface/type 是纯类型，esbuild 元数据
  // 不可见（类型在运行时被剥离），其漂移由下游 tsc 消费报错兜底。
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:const|function)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1])
  }
  return names
}

async function checkDtsExports(entryPoints, dtsPath, label) {
  const probe = await esbuild.build({
    entryPoints,
    bundle: false,
    format: 'esm',
    platform: 'node',
    target: 'es2020',
    write: false,
    metafile: true,
  })
  const outputs = Object.values(probe.metafile.outputs)
  const actual = new Set(outputs.flatMap(o => o.exports ?? []))
  const declared = declaredExports(dtsPath)
  for (const name of actual) {
    if (!declared.has(name)) {
      throw new Error(
        `[dsh-auto-collapse] ${dtsPath} 缺少导出声明: ${name}（${label} 导出面已变，请同步 d.ts——它仍是手工维护的）`,
      )
    }
  }
  for (const name of declared) {
    if (!actual.has(name)) {
      console.warn(`[dsh-auto-collapse] ${dtsPath} 声明了 ${label} 已不存在的导出: ${name}`)
    }
  }
  console.log(`[dsh-auto-collapse] ${label} d.ts export guard: ok`)
}

const CLIENT_OPTIONS = {
  entryPoints: ['src/client.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__dshcfBundle',
  platform: 'browser',
  target: 'es2020',
  outfile: 'lib/client.js',
  external: ['react'],
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-auto-collapse",factory:function(require){' },
  footer: { js: 'return __dshcfBundle;}});' },
}

/** host half：src/index.ts → lib/index.js。bundle:false 保留 import 语句
 * （schemastery 由 DSH 提供，不得打进产物）；format esm 与 package.json
 * type:module 匹配；esbuild 天然剥离全部 TS 类型注解。 */
const HOST_OPTIONS = {
  entryPoints: ['src/index.ts'],
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'es2020',
  outfile: 'lib/index.js',
}

let esbuild
try {
  esbuild = require('esbuild')
} catch (error) {
  if (error?.code === 'MODULE_NOT_FOUND') {
    throw new Error(
      '[dsh-auto-collapse] esbuild is a devDependency of this package; run "npm install" first',
      { cause: error },
    )
  }
  throw error
}

console.log('[dsh-auto-collapse] building lib/client.js …')
await esbuild.build(CLIENT_OPTIONS)
console.log('[dsh-auto-collapse] done: lib/client.js')

console.log('[dsh-auto-collapse] building lib/index.js (host half) …')
await esbuild.build(HOST_OPTIONS)
console.log('[dsh-auto-collapse] done: lib/index.js')

// P7：d.ts 导出面守卫（lib/types 仍为手工维护，此守卫把「src 加了导出但
// 忘同步 d.ts」挡在构建期；d.ts 多余的声明只告警）。
await checkDtsExports(['src/index.ts'], 'lib/types/index.d.ts', 'host')
await checkDtsExports(['src/client.ts'], 'lib/types/client/index.d.ts', 'client')

// 守卫 1：宿主产物 lib/index.js 是纯 JS ESM，由 DSH 直接加载。任何 TS
// 类型注解（如 export const inject: string[] = []）都会在服务启动时抛
// SyntaxError 并让整棵插件树加载失败。这里用 node --check 兜底，把这类
// 回归挡在构建/部署之前。
// 守卫 2（U9）：lib/client.js 是 esbuild iife + banner/footer 手工拼接，
// 拼接错误（引号/括号不匹配）同样会让浏览器端加载失败——对拼接产物也跑
// node --check（只查语法不执行，window 未定义不影响检查）。
{
  const { spawnSync } = require('node:child_process')
  const checkHost = spawnSync(process.execPath, ['--check', 'lib/index.js'], { stdio: 'pipe' })
  if (checkHost.status !== 0) {
    throw new Error(
      '[dsh-auto-collapse] lib/index.js is not valid plain-JS ESM (TS annotations?). dsh web would fail to boot:\n' +
        (checkHost.stderr?.toString() ?? '').trim(),
    )
  }
  console.log('[dsh-auto-collapse] host half syntax check: ok')
  const checkClient = spawnSync(process.execPath, ['--check', 'lib/client.js'], { stdio: 'pipe' })
  if (checkClient.status !== 0) {
    throw new Error(
      '[dsh-auto-collapse] lib/client.js (bundle + banner/footer) is not valid JS:\n' +
        (checkClient.stderr?.toString() ?? '').trim(),
    )
  }
  console.log('[dsh-auto-collapse] client bundle syntax check: ok')
}
