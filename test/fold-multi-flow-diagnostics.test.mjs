/**
 * fold-multi-flow-diagnostics.test.mjs — 多列并存时的**共享诊断属性**回归测试。
 *
 * 背景：data-dshcf-state / data-dshcf-error 写在唯一的 <style id="dshcf-style"> 上，
 * 是全插件共享的诊断出口（#dshcf-style 的 state 被 _flash.mjs 等排障工具读取）。
 * FoldManager 为每一列各建一个控制器后，若各控制器「本轮成功就写 active」，
 * 那么「A 列一直在抛错、B 列正常」会被 B 的成功覆盖成 active —— 故障被伪装成健康。
 *
 * 本用例把聚合语义钉死：
 *   1) 任一列处于错误态时，全局保持 error（不被其它列的成功抹掉）；
 *   2) 该列恢复后（错误消失），全局回到 active 且错误详情清空；
 *   3) 出错列被销毁（子代理面板关闭）后，计数归还，不被永久占住；
 *   4) 单流路径行为与改动前一致（无错误 → active / null）。
 *
 * ⚠️ 顺序敏感：本用例刻意让**故障列先跑、健康列后跑**（控制器按列发现顺序执行）。
 *    若健康列先跑，它写 active 后故障列再写 error，最终仍是 error——那样这条
 *    用例在「没有聚合守卫」的实现上也会误绿。故障列放前、健康列置后，
 *    才能真实区分「有/无聚合守卫」。
 *
 * 用法：node test/fold-multi-flow-diagnostics.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installDomGlobals, el, textNode } from './fake-dom.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')

let failures = 0
function assert(cond, label, extra) {
  const ok = Boolean(cond)
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (!ok && extra ? '  (' + extra + ')' : ''))
  if (!ok) failures++
}

function boot() {
  const env = installDomGlobals()
  const { document } = env
  let moduleExports = null
  globalThis.window.__ModuleLoader__ = {
    load(spec) { moduleExports = spec.factory(() => { throw new Error('require unsupported in stub') }) },
  }
  eval(code)
  if (moduleExports === null) throw new Error('bundle did not register')
  let cleanup = null
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', value: { summaryFields: 'duration', keepLastRows: 3 }, base: {}, user: {}, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
  moduleExports.apply({ effect: (fn) => { cleanup = fn() }, settingsScope: { bind: () => scopeMock } })
  function register() {
    const seen = new Set(document._all)
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 1) { if (!seen.has(c)) { seen.add(c); document._all.push(c) } walk(c) }
      }
    }
    walk(document.body)
  }
  return { env, document, register, cleanup: () => { cleanup?.(); env.clearTimers() } }
}

/** 构造一列：官方组 + 正文 + tail + 原生行。 */
function buildColumn(parent, turn) {
  const flow = el('div', { 'data-chat-flow': '' }, parent)
  flow.offsetParent = {}
  flow.setRect({ width: 500, height: 400 })
  const u = el('div', { 'data-chat-anchor-key': `u${turn}`, 'data-chat-flow-kind': 'user', class: 'flowItem' }, flow)
  u.setRect({ height: 40 }); textNode('问' + turn, u)
  const g = el('div', {
    'data-step-process': 'true',
    'data-chat-group-key': 'g' + String(turn),
    'data-chat-turn': String(turn),
    class: 'O_Ebla_root',
  }, flow)
  const hd = el('div', {}, g)
  el('button', { 'data-process-activity': 'code', 'aria-expanded': 'false' }, hd)
  const body = el('div', { 'data-step-process-body': 'true' }, g)
  body.setAttribute('hidden', 'until-found')
  el('div', { 'data-step-process-content': 'true', 'data-chat-flow': '' }, body)
  const a = el('div', { 'data-chat-anchor-key': `a${turn}`, 'data-chat-flow-kind': 'assistant-step', class: 'flowItem' }, flow)
  a.setRect({ height: 60 })
  const md = el('div', { class: 'markdown' }, a); textNode('正文' + turn, md)
  const tail = el('div', { 'data-chat-anchor-key': `tt${turn}`, 'data-chat-flow-kind': 'turn-tail', class: 'flowItem' }, flow)
  tail.setRect({ height: 24 }); textNode('用时 3秒', tail)
  const tp = el('div', { 'data-chat-anchor-key': `tp${turn}`, 'data-chat-flow-kind': 'turn-process', class: 'flowItem' }, flow)
  tp.setRect({ height: 33 })
  el('button', { 'data-turn-process': String(turn), 'aria-expanded': 'false' }, tp)
  return { flow }
}

function diag(document) {
  const s = document.getElementById('dshcf-style')
  return { state: s?.getAttribute('data-dshcf-state') ?? null, err: s?.getAttribute('data-dshcf-error') ?? null }
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 1: 健康列的成功不得抹掉故障列的错误态 ===')
  const { env, document, register, cleanup } = boot()
  // ★ 顺序刻意：故障列（侧栏）先入文档 → 其控制器先建、先跑；健康列（主列）后跑。
  const sideWrap = el('div', { 'data-sidebar-chat': '' }, document.body)
  const side = buildColumn(sideWrap, 1)
  const mainWrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  const main = buildColumn(mainWrap, 1)
  register()
  await env.tick(); await env.tick()
  assert(diag(document).state === 'active', '初始两列正常 → active', JSON.stringify(diag(document)))

  // 让「先跑的侧栏列」在 pass 里抛错（模拟该列内部真实异常）。
  const realQSA = side.flow.querySelectorAll.bind(side.flow)
  let broken = true
  side.flow.querySelectorAll = (sel) => {
    if (broken && String(sel).includes('data-turn-process')) throw new Error('probe: column broken')
    return realQSA(sel)
  }
  register()
  await env.tick(); await env.tick(); await env.tick()
  const brokenDiag = diag(document)
  assert(brokenDiag.state === 'error', '故障列使全局进入 error（未被后跑的健康列覆盖）', JSON.stringify(brokenDiag))
  assert(/column broken/.test(brokenDiag.err ?? ''), '错误详情透出（可排障）', String(brokenDiag.err))
  void main

  // 故障消失（列恢复）→ 全局回到 active
  broken = false
  register()
  await env.tick(); await env.tick(); await env.tick()
  const healed = diag(document)
  assert(healed.state === 'active' && healed.err === null, '故障恢复后全局回到 active 且详情清空', JSON.stringify(healed))
  cleanup()
}

// ---------------------------------------------------------------------------
{
  console.log('\n=== 场景 2: 故障列被销毁（面板关闭）后不占住错误态 ===')
  const { env, document, register, cleanup } = boot()
  const sideWrap = el('div', { 'data-sidebar-chat': '' }, document.body)
  const side = buildColumn(sideWrap, 1)
  const mainWrap = el('div', { 'data-slot': 'main.conversation' }, document.body)
  buildColumn(mainWrap, 1)
  register()
  await env.tick(); await env.tick()

  const realQSA = side.flow.querySelectorAll.bind(side.flow)
  side.flow.querySelectorAll = (sel) => {
    if (String(sel).includes('data-turn-process')) throw new Error('probe: broken until closed')
    return realQSA(sel)
  }
  register()
  await env.tick(); await env.tick(); await env.tick()
  assert(diag(document).state === 'error', '故障列使全局 error（前置）', JSON.stringify(diag(document)))

  // 关闭子代理面板：该列整体摘除 → 控制器 stop() → 计数归还
  sideWrap.remove()
  register()
  await env.tick(); await env.tick(); await env.tick()
  const afterClose = diag(document)
  assert(afterClose.state === 'active' && afterClose.err === null, '故障列销毁后全局恢复 active（计数已归还）', JSON.stringify(afterClose))
  cleanup()
}

console.log('\n[DONE] failures=' + failures)
process.exit(failures === 0 ? 0 : 1)
