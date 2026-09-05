/**
 * roster-watch.test.mjs —— 插件启停热生效看门狗单元测试。
 * 通过真实构建产物 lib/client.js 加载插件模块，对导出的纯函数与
 * installRosterWatchdog（全依赖注入）做行为断言，不碰真实网络/DOM。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

function loadModule() {
  const env = installDomGlobals()
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) { moduleExports = spec.factory(() => { throw new Error('require unsupported in stub') }) },
  }
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  return { env, moduleExports }
}

const { moduleExports } = loadModule()
const { rosterSignature, shouldReloadRoster, installRosterWatchdog } = moduleExports
for (const fn of [rosterSignature, shouldReloadRoster, installRosterWatchdog]) {
  if (typeof fn !== 'function') throw new Error('roster-watch exports missing from bundle')
}

// ── 纯函数 ────────────────────────────────────────────────────────────────
assert(rosterSignature(['b', 'a', 'b']) === rosterSignature(['a', 'b']), 'rosterSignature 去重且与顺序无关')
assert(rosterSignature(['a']) !== rosterSignature(['a', 'b']), 'rosterSignature 区分不同集合')
assert(rosterSignature([]) !== rosterSignature(['a']), 'rosterSignature 区分空集与非空集')

assert(shouldReloadRoster(null, 'x') === false, '基线缺失不触发')
assert(shouldReloadRoster('x', null) === false, '探测缺失不触发')
assert(shouldReloadRoster('a', 'a') === false, '签名相同不触发')
assert(shouldReloadRoster('a', 'b') === true, '签名变化触发')

// ── 看门狗行为（响应载荷与 node 侧探针一致：{ sig, own }）──────────────────
function sigOf(ids) {
  return rosterSignature(ids)
}

function makeHarness({ responses = [], bootIds = ['dsh-auto-collapse', 'other-plugin'], minReloadIntervalMs = 3000, storage = null } = {}) {
  let reloadCount = 0
  const state = {
    pending: null,
    responses: [...responses],
    reloadCount: () => reloadCount,
    urls: [],
  }
  const store = storage ?? new Map()
  const storageFacade = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value) },
  }
  const fetchFn = async (url, init) => {
    state.urls.push(String(url))
    const next = state.responses.shift()
    if (next === undefined) throw new Error('no more mocked responses')
    if (next === null) return { status: 404, ok: false, json: async () => ({}) }
    if (next instanceof Error) throw next
    if (next === '__hang__') {
      // 模拟 TCP 挂起：尊重 init.signal（与真实 fetch 一致），abort 后抛
      // AbortError；无 signal 时永不 settle（超时功能被禁用的兜底路径）。
      return new Promise((resolve, reject) => {
        if (init?.signal) {
          if (init.signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }
      })
    }
    return {
      status: next.status ?? 200,
      ok: next.status === undefined || next.status === 200,
      json: async () => next.body,
    }
  }
  const off = installRosterWatchdog({
    bootGraph: { entries: bootIds.map((id) => ({ id })) },
    fetchFn,
    setTimer: (fn) => { state.pending = fn; return 1 },
    clearTimer: (handle) => { if (state.pending === null) return; state.pending = null },
    reload: () => { reloadCount += 1 },
    storage: storageFacade,
    minReloadIntervalMs,
    pollMs: 100,
  })
  return { state, off, storageFacade }
}

async function flush(state, maxTicks = 6) {
  for (let i = 0; i < maxTicks; i++) {
    const fn = state.pending
    if (fn === null) return
    state.pending = null
    fn()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
}

// 1) roster 签名不变：不重载，继续轮询
{
  const h = makeHarness({ responses: [{ body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin']), own: true } }] })
  await flush(h.state)
  assert(h.state.reloadCount() === 0, 'roster 不变不重载')
  assert(h.state.pending !== null, 'roster 不变继续轮询')
  h.off()
}

// 2) 签名变化（自身被移除）：重载一次
{
  const h = makeHarness({ responses: [{ body: { sig: sigOf(['other-plugin']), own: false } }] })
  await flush(h.state)
  assert(h.state.reloadCount() === 1, '自身被移除时自动重载')
  h.off()
}

// 3) 签名变化（任意其他插件新增）：同样重载（通用启停感知）
{
  const h = makeHarness({ responses: [{ body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin', 'brand-new-plugin']), own: true } }] })
  await flush(h.state)
  assert(h.state.reloadCount() === 1, '其他插件启用时自动重载')
  h.off()
}

// 4) 404（自身 node half 被卸载）：重载
{
  const h = makeHarness({ responses: [null] })
  await flush(h.state)
  assert(h.state.reloadCount() === 1, '探针 404 视为自身被禁用并重载')
  h.off()
}

// 5) 404 但基线里本就不含自身：不重载
{
  const h = makeHarness({ responses: [null], bootIds: ['other-plugin'] })
  await flush(h.state)
  assert(h.state.reloadCount() === 0, '基线无自身时 404 不重载')
  h.off()
}

// 5b) 未显式传 endpoint 时轮询默认探针路由（M8 路由常量镜像锁定）
{
  const h = makeHarness({ responses: [{ body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin']), own: true } }] })
  await flush(h.state)
  assert(h.state.urls.length > 0 && h.state.urls[0] === '/dsh-auto-collapse/roster', '默认轮询 /dsh-auto-collapse/roster（与 host 侧镜像一致）', JSON.stringify(h.state.urls))
  h.off()
}

// 6) 网络异常：不重载，继续轮询
{
  const h = makeHarness({ responses: [new Error('network down'), { body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin']), own: true } }] })
  await flush(h.state)
  assert(h.state.reloadCount() === 0, '网络异常静默忽略')
  assert(h.state.pending !== null, '网络异常后继续轮询')
  h.off()
}

// 6b) fetch 挂起 → AbortSignal.timeout 超时 abort → 继续轮询（M9）
{
  const h = makeHarness({
    responses: [
      '__hang__',
      { body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin']), own: true } },
    ],
  })
  // 触发首轮 tick：同步部分跑完，async 部分 await 挂起的 fetch
  const first = h.state.pending
  assert(first !== null, '首轮轮询已调度')
  h.state.pending = null
  first()
  await Promise.resolve()
  await Promise.resolve()
  // pollMs=100：等真实超时窗口（>100ms）让 AbortSignal.timeout 触发 abort；
  // 250ms 余量防重负载 CI 下 100ms 超时未及时触发的 flake
  await new Promise(resolve => setTimeout(resolve, 250))
  await Promise.resolve()
  await Promise.resolve()
  assert(h.state.pending !== null, '挂起 fetch 超时 abort 后轮询链继续（schedule 被调）')
  assert(h.state.reloadCount() === 0, '超时不重载（静默忽略）')
  h.off()
}

// 7) 首次变化触发重载，重载后停止轮询（页面即将刷新）
{
  const h = makeHarness({
    responses: [
      { body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin', 'p1']), own: true } },
      { body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin', 'p1', 'p2']), own: true } },
    ],
    minReloadIntervalMs: 60_000,
  })
  await flush(h.state)
  assert(h.state.reloadCount() === 1, '首次变化触发重载')
  assert(h.state.pending === null, '重载后停止轮询（页面即将刷新）')
  h.off()
}

// 8) 间隔保护跨“页面重载”（共享 sessionStorage 时间戳）：窗口内不重复刷新，
//    压住后保留旧基线继续观察，窗口过后同一差异会再次触发并收敛
{
  const store = new Map()
  {
    const h = makeHarness({
      responses: [{ body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin', 'p1']), own: true } }],
      minReloadIntervalMs: 60_000,
      storage: store,
    })
    await flush(h.state)
    assert(h.state.reloadCount() === 1, '首次页面触发重载并写入时间戳')
    h.off()
  }
  {
    const h = makeHarness({
      responses: [{ body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin', 'p1']), own: true } }],
      minReloadIntervalMs: 60_000,
      storage: store,
    })
    await flush(h.state)
    assert(h.state.reloadCount() === 0, '重载风暴保护：窗口内不重复刷新')
    assert(h.state.pending !== null, '压住后继续观察（保留旧基线，窗口后收敛）')
    h.off()
  }
}

// 9) 卸载清理：off 后不再轮询、不再触发
{
  const h = makeHarness({ responses: [{ body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin']), own: true } }] })
  h.off()
  assert(h.state.pending === null, 'off 后停止轮询')
}

// 10) 空基线：no-op，不发起任何请求
{
  let fetched = 0
  const off = installRosterWatchdog({
    bootGraph: { entries: [] },
    fetchFn: async () => { fetched += 1; return { status: 200, ok: true, json: async () => ({ sig: '', own: false }) } },
    setTimer: () => { throw new Error('空基线不应安装定时器') },
    clearTimer: () => {},
    reload: () => { throw new Error('空基线不应重载') },
  })
  assert(fetched === 0, '空基线 no-op 不发起轮询')
  off()
}

// 11) 响应载荷畸形（无 sig）：不重载，继续轮询
{
  const h = makeHarness({ responses: [{ body: { own: true } }, { body: { sig: sigOf(['dsh-auto-collapse', 'other-plugin']), own: true } }] })
  await flush(h.state)
  assert(h.state.reloadCount() === 0, '载荷缺 sig 不触发')
  assert(h.state.pending !== null, '载荷畸形后继续轮询')
  h.off()
}

console.log(failures === 0 ? '\nroster-watch: all passed' : '\nroster-watch: ' + failures + ' failure(s)')
if (failures > 0) process.exit(1)
