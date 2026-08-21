/**
 * dsh-auto-collapse — browser half（客户端插件入口）。
 *
 * 职责：
 * 1. 把会话正文之外的工具 display（read / bash / web_search / think 推理
 *    块等非正文卡片）折叠成内联的一行，折叠行实时显示当前正在进行的工作
 *    （工具名 + 正在执行的命令/参数，或思考的最新一行）；运行中标题与摘
 *    要带平滑呼吸动画（Pulse）。点击展开/收起。
 * 2. 把官方 ChatView 尾部运行状态行 "Deep diving..." 替换为
 *    "Deep sleeping..."（流光特效不变，始终生效）。
 *
 * 实现方式：纯 DOM 层（MutationObserver + rAF 合并），零核心改动、零运行时
 * 依赖、不注册任何 slot key。识别依据是 ChatView 渲染时写死的稳定 data
 * 属性（data-chat-flow / data-chat-call-id / data-tool / data-state /
 * data-variant / data-chat-anchor-key / data-subcalls / data-follow-end /
 * data-disclosure-row），与官方 Web 客户端的 DOM 契约对齐。
 */
import { FoldController } from './fold.ts'

export const name = 'dsh-auto-collapse'

/** 需要的宿主服务：无 —— 纯 DOM 操作，不依赖任何 client 服务。 */
export const inject: string[] = []

/** 客户端根上下文的最小结构化类型（仅用 cordis 标准 effect，无运行时依赖）。 */
export interface FoldClientCtx {
  effect(fn: () => unknown, label?: string): unknown
}

export function apply(ctx: FoldClientCtx): void {
  // 注意:cordis 的 ctx.effect(fn) 会【立即执行】fn,并把 fn 的返回值当作
  // 插件卸载时的清理函数(与 ui-slash 等官方插件同款写法)。
  ctx.effect(() => {
    const controller = new FoldController()
    controller.start()
    return () => controller.stop()
  }, 'dsh-auto-collapse: fold observer')
}
