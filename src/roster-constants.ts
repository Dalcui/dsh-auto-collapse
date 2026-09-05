/**
 * roster 探针的共享常量与签名算法（client 侧）。
 *
 * host half（src/index.ts）的构建产物是单文件（build.mjs 对 host 用
 * bundle:false，部署的 lib/ 下只有 index.js），不能跨文件 import——
 * index.ts 内联了一份逐字镜像（M8：一侧漂移会导致看门狗误判反复重载）。
 * 两侧一致性由 host-roster / roster-watch 两组单测用相同样例锁定。
 */
export const ROSTER_ROUTE = '/dsh-auto-collapse/roster'
export const OWN_CLIENT_ID = 'dsh-auto-collapse'

/** roster 中 id 集合的稳定签名：去重、排序、以不可见字符连接。
 * 与 src/index.ts 的 rosterSignatureOf 严格同算法。 */
export function rosterSignature(ids: readonly string[]): string {
  return [...new Set(ids.map(String))].sort().join('\u0000')
}
