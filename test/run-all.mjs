import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const files = [
  'test/fold-behavior.test.mjs',
  'test/fold-regression.test.mjs',
  'test/fold-reconcile.test.mjs',
  'test/fold-animation.test.mjs',
  'test/fold-retry.test.mjs',
  'test/fold-live.test.mjs',
  'test/fold-metrics.test.mjs',
  'test/fold-single.test.mjs',
  'test/fold-record.test.mjs',
  'test/fold-round2.test.mjs',
  'test/fold-issue-round3.test.mjs',
  'test/fold-issue-round4.test.mjs',
  'test/fold-keep-last-rows.test.mjs',
  'test/metrics-unit.test.mjs',
  'test/adversarial-race.mjs',
  'test/adversarial-session.mjs',
]

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run([join(root, 'build.mjs')])
for (const file of files) run([join(root, file)])

