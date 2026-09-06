/**
 * remote-config.test.mjs —— R6 远程配置兜底链单测。
 * 覆盖：sanitizeRemoteConfig 校验 / createRemoteConfigStore 通知 /
 * wrapScopeWithRemote 优先级与只读写保护 / 看门狗 onBody 透传与容错。
 * 与 roster-watch.test.mjs 相同：经真实构建产物 lib/client.js 加载模块。
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
const { sanitizeRemoteConfig, createRemoteConfigStore, wrapScopeWithRemote, installRosterWatchdog, rosterSignature } = moduleExports
for (const fn of [sanitizeRemoteConfig, createRemoteConfigStore, wrapScopeWithRemote, installRosterWatchdog, rosterSignature]) {
  if (typeof fn !== 'function') throw new Error('remote-config exports missing from bundle')
}

// ── sanitizeRemoteConfig ──────────────────────────────────────────────────
{
  const ok = sanitizeRemoteConfig({
    statusText: '',
    summaryFields: 'duration, outputTokens()',
    codeDescription: 'hover',
    keepLastRows: 3.7,
    keepLastBodySteps: -2,
    extra: 'x',
  })
  assert(ok !== null, '合法对象返回配置')
  assert(ok.statusText === '', 'statusText 空串透传')
  assert(ok.summaryFields === 'duration, outputTokens()', 'summaryFields 透传')
  assert(ok.codeDescription === 'hover', 'codeDescription 透传')
  assert(ok.keepLastRows === 3, 'keepLastRows 归一 3.7→3')
  assert(ok.keepLastBodySteps === 0, 'keepLastBodySteps 负值归 0')
  assert(!('extra' in ok), '未知字段丢弃')
}
{
  assert(sanitizeRemoteConfig(null) === null, 'null → null')
  assert(sanitizeRemoteConfig('str') === null, '非对象 → null')
  assert(sanitizeRemoteConfig({}) === null, '空对象（无合法字段）→ null')
  assert(sanitizeRemoteConfig({ statusText: 42, keepLastRows: '3' }) === null, '全字段类型非法 → null')
  assert(sanitizeRemoteConfig({ statusText: 42, keepLastRows: 5 }) !== null, '部分字段合法 → 只保留合法字段')
  assert(sanitizeRemoteConfig({ keepLastRows: NaN }) === null, 'NaN 数字 → null')
}

// ── createRemoteConfigStore ──────────────────────────────────────────────
{
  const store = createRemoteConfigStore()
  let notified = 0
  const off = store.subscribe(() => { notified += 1 })
  assert(store.get() === null, '初始为空')
  assert(store.set(null) === false, '相同值 set 返回 false')
  assert(notified === 0, '相同值不通知')
  const cfg = sanitizeRemoteConfig({ keepLastBodySteps: 2 })
  assert(store.set(cfg) === true, '新值 set 返回 true')
  assert(notified === 1, 'set 通知订阅者一次')
  assert(store.get() === cfg, 'get 返回新值')
  store.set(cfg)
  assert(notified === 1, '再次 set 相同引用不通知')
  const cfg2 = sanitizeRemoteConfig({ keepLastBodySteps: 3 })
  store.set(cfg2)
  assert(notified === 2, '值变化再次通知')
  // 看门狗每轮 poll 都新造对象：内容相同但引用不同的 set 不应通知
  // （否则桌面页每 1.5s 一次无意义全量 fold pass）。
  store.set(sanitizeRemoteConfig({ keepLastBodySteps: 3 }))
  assert(notified === 2 && store.get() === cfg2, '内容相同不同引用不通知（保留旧引用）')
  store.set(sanitizeRemoteConfig({ keepLastBodySteps: 3, statusText: '' }))
  assert(notified === 3, '字段集变化（含空串）通知')
  off()
  store.set(sanitizeRemoteConfig({ keepLastBodySteps: 4 }))
  assert(notified === 3, '退订后不再通知')
}

// ── wrapScopeWithRemote ──────────────────────────────────────────────────
function fakeScope(status, value) {
  const state = { status, value, base: { statusText: 'Deep sleeping...' }, user: undefined, writable: status === 'ready', setCalls: [], unsetCalls: [] }
  const listeners = new Set()
  return {
    state,
    listeners,
    scope: {
      getSnapshot: () => ({ status: state.status, value: state.value, base: state.base, user: state.user, writable: state.writable }),
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
      set: async (f, v) => { state.setCalls.push([f, v]) },
      unset: async (f) => { state.unsetCalls.push(f) },
    },
  }
}

// 1) scope ready → 透传内层快照（可写）
{
  const inner = fakeScope('ready', { keepLastBodySteps: 2 })
  const store = createRemoteConfigStore()
  store.set(sanitizeRemoteConfig({ keepLastBodySteps: 9 }))
  const wrapped = wrapScopeWithRemote(inner.scope, store)
  const snap = wrapped.getSnapshot()
  assert(snap.status === 'ready' && snap.value?.keepLastBodySteps === 2, 'scope ready 时优先内层值')
  assert(snap.writable === true, 'scope ready 时可写')
  await wrapped.set('keepLastBodySteps', 5)
  assert(inner.state.setCalls.length === 1 && inner.state.setCalls[0][1] === 5, 'scope ready 时 set 转发')
  await wrapped.unset('statusText')
  assert(inner.state.unsetCalls.length === 1, 'scope ready 时 unset 转发')
}

// 2) scope unavailable + 远程有值 → ready 只读快照
{
  const inner = fakeScope('unavailable', undefined)
  const store = createRemoteConfigStore()
  store.set(sanitizeRemoteConfig({ keepLastBodySteps: 2, statusText: '' }))
  const wrapped = wrapScopeWithRemote(inner.scope, store)
  const snap = wrapped.getSnapshot()
  assert(snap.status === 'ready', '远程值兜底时 status=ready')
  assert(snap.value?.keepLastBodySteps === 2 && snap.value?.statusText === '', 'value=远程真值（含空串）')
  assert(snap.writable === false, '远程兜底只读')
  assert(snap.base?.statusText === 'Deep sleeping...', 'base 沿用内层')
  await wrapped.set('keepLastBodySteps', 5)
  await wrapped.unset('statusText')
  assert(inner.state.setCalls.length === 0 && inner.state.unsetCalls.length === 0, '远程兜底时 set/unset 静默 no-op（不开放远程写通道）')
}

// 3) scope undefined + 远程有值 → 仍能兜底
{
  const store = createRemoteConfigStore()
  store.set(sanitizeRemoteConfig({ keepLastRows: 4 }))
  const wrapped = wrapScopeWithRemote(undefined, store)
  const snap = wrapped.getSnapshot()
  assert(snap.status === 'ready' && snap.value?.keepLastRows === 4 && snap.writable === false, '无 settingsScope 时远程值仍兜底')
}

// 4) scope loading + 远程有值 → 远程兜底（等 scope ready 后订阅自动切回）
{
  const inner = fakeScope('loading', undefined)
  const store = createRemoteConfigStore()
  store.set(sanitizeRemoteConfig({ keepLastRows: 4 }))
  const wrapped = wrapScopeWithRemote(inner.scope, store)
  assert(wrapped.getSnapshot().status === 'ready', 'scope loading 时远程值兜底')
  inner.state.status = 'ready'
  inner.state.value = { keepLastRows: 7 }
  inner.state.writable = true
  assert(wrapped.getSnapshot().value?.keepLastRows === 7, 'scope 转 ready 后自动切回内层值')
}

// 5) 双无 → unavailable（保持旧行为）
{
  const wrapped = wrapScopeWithRemote(undefined, createRemoteConfigStore())
  const snap = wrapped.getSnapshot()
  assert(snap.status === 'unavailable' && snap.writable === false, '双无时 unavailable')
}

// 6) subscribe 合并通知
{
  const inner = fakeScope('unavailable', undefined)
  const store = createRemoteConfigStore()
  const wrapped = wrapScopeWithRemote(inner.scope, store)
  let notified = 0
  const off = wrapped.subscribe(() => { notified += 1 })
  store.set(sanitizeRemoteConfig({ keepLastRows: 2 }))
  assert(notified === 1, '远程配置到达触发通知')
  inner.listeners.forEach((fn) => fn())
  assert(notified === 2, '内层 scope 变化也触发通知')
  off()
  store.set(sanitizeRemoteConfig({ keepLastRows: 3 }))
  assert(notified === 2, '退订后不再通知')
}

// ── 看门狗 onBody 透传与容错 ─────────────────────────────────────────────
{
  const seen = []
  const h = {
    pending: null,
    responses: [
      { body: { sig: rosterSignature(['dsh-auto-collapse']), own: true, config: { keepLastBodySteps: 2 } } },
      { body: { sig: rosterSignature(['dsh-auto-collapse']), own: true, config: null } },
      { body: { sig: rosterSignature(['dsh-auto-collapse']), own: true, config: { keepLastRows: 4 } } },
    ],
  }
  const fetchFn = async () => {
    const next = h.responses.shift()
    if (next === undefined) throw new Error('no more mocked responses')
    return { status: 200, ok: true, json: async () => next.body }
  }
  const off = installRosterWatchdog({
    bootGraph: { entries: [{ id: 'dsh-auto-collapse' }] },
    fetchFn,
    setTimer: (fn) => { h.pending = fn; return 1 },
    clearTimer: () => { h.pending = null },
    reload: () => {},
    pollMs: 100,
    onBody: (body) => { seen.push(body) },
  })
  for (let i = 0; i < 3; i++) {
    const fn = h.pending
    h.pending = null
    fn()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
  off()
  assert(seen.length === 3, '每次 200 响应都回调 onBody')
  assert(seen[0].config?.keepLastBodySteps === 2, 'config 载荷透传')
  assert(seen[1].config === null, 'config=null 透传（订阅方据此清空兜底）')
  assert(seen[2].config?.keepLastRows === 4, '后续轮询继续透传新值')
  assert(seen.every((b) => b.sig === rosterSignature(['dsh-auto-collapse']) && b.own === true), 'sig/own 同步透传')
}

// 7) onBody 抛错不打断轮询链
{
  const h = {
    pending: null,
    responses: [
      { body: { sig: rosterSignature(['dsh-auto-collapse']), own: true, config: {} } },
      { body: { sig: rosterSignature(['dsh-auto-collapse']), own: true, config: {} } },
    ],
    tickCount: 0,
  }
  const fetchFn = async () => {
    const next = h.responses.shift()
    if (next === undefined) throw new Error('no more mocked responses')
    return { status: 200, ok: true, json: async () => next.body }
  }
  const off = installRosterWatchdog({
    bootGraph: { entries: [{ id: 'dsh-auto-collapse' }] },
    fetchFn,
    setTimer: (fn) => { h.pending = fn; return 1 },
    clearTimer: () => { h.pending = null },
    reload: () => {},
    pollMs: 100,
    onBody: () => { h.tickCount += 1; throw new Error('subscriber-boom') },
  })
  for (let i = 0; i < 2; i++) {
    const fn = h.pending
    if (fn === null) break
    h.pending = null
    fn()
    // tick 的 async 链含 fetch/json 两层 await，给足微任务让第二轮完成 schedule
    for (let w = 0; w < 6; w++) await Promise.resolve()
  }
  assert(h.tickCount === 2, 'onBody 抛错后第二轮照常触发（轮询链未断）')
  assert(h.pending !== null, 'onBody 抛错后仍重新 schedule（下一轮继续轮询）')
  off()
}

console.log(failures === 0 ? '\nremote-config: all passed' : '\nremote-config: ' + failures + ' failure(s)')
if (failures > 0) process.exit(1)
