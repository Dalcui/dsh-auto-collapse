/**
 * dsh-auto-collapse 构建脚本。
 *
 * 产出：
 *   lib/index.js   —— host half（静态文件，见 lib/index.js，无需构建）
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

console.log('[dsh-auto-collapse] building lib/client.js …')
try {
  const esbuild = require('esbuild')
  await esbuild.build(CLIENT_OPTIONS)
} catch (error) {
  if (error?.code === 'MODULE_NOT_FOUND') {
    throw new Error(
      '[dsh-auto-collapse] esbuild is a devDependency of this package; run `npm install` first',
      { cause: error },
    )
  }
  throw error
}
console.log('[dsh-auto-collapse] done: lib/client.js')

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
