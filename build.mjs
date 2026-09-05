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
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

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

// 守卫：宿主产物 lib/index.js 是纯 JS ESM，由 DSH 直接加载。任何 TS
// 类型注解（如 export const inject: string[] = []）都会在服务启动时抛
// SyntaxError 并让整棵插件树加载失败。这里用 node --check 兜底，把这类
// 回归挡在构建/部署之前。
{
  const { spawnSync } = require('node:child_process')
  const check = spawnSync(process.execPath, ['--check', 'lib/index.js'], { stdio: 'pipe' })
  if (check.status !== 0) {
    throw new Error(
      '[dsh-auto-collapse] lib/index.js is not valid plain-JS ESM (TS annotations?). dsh web would fail to boot:\n' +
        (check.stderr?.toString() ?? '').trim(),
    )
  }
  console.log('[dsh-auto-collapse] host half syntax check: ok')
}
