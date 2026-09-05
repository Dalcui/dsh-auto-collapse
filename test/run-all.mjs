import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// M12：测试清单 glob 化——新增 *.test.mjs 自动纳入，不再手工维护硬编码
// 清单（曾漏掉 _flash.mjs 等被跟踪但不执行的检查）。adversarial-*.mjs 是
// 确定性乱序/多会话对抗测试，后缀不同，单独纳入。fake-dom.mjs 是共享桩
// 模块、_flash.mjs 是辅助脚本、run-all.mjs 是自身，均不执行。
const files = readdirSync(join(root, 'test'))
  .filter(name => name.endsWith('.test.mjs') || name.startsWith('adversarial-'))
  .sort()
  .map(name => join('test', name))

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  })
}

// 构建失败立即中止（产物是全部测试的前置）。
const build = run([join(root, 'build.mjs')])
if (build.error !== undefined) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

// M12：失败后跑完其余文件再汇总——首个失败即 exit 会掩盖后面的失败。
const failed = []
for (const file of files) {
  const result = run([join(root, file)])
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) failed.push(file)
}
if (failed.length > 0) {
  console.error(`\n[run-all] ${failed.length} 个测试文件失败:`)
  for (const file of failed) console.error(`  - ${file}`)
  process.exit(1)
}
console.log(`\n[run-all] ${files.length} 个测试文件全部通过`)
