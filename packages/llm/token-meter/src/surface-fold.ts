/**
 * @file `TokenMeter.measure()` 服务的位置化 surface 折叠：把每条 surface
 * event 折成「token 价 + 新 surface + signed delta」。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「**两份** fold 各管一份」**：本文件是 measurement service 用的
 *     positional fold（O(surface) per fold，但能给出完整 surface 节点
 *     列表给 UI / compaction plan）。projection 单元**不**复用本 fold——
 *     它们要 O(1) 持久化 checkpoint，所以走 `surface-projection.ts` 的
 *     shadow-price 协议。两套 fold **数字对账**靠都过 `estimate.ts`
 *     + replace producer 的 shadow price 从本 fold 的 nodes 派生出来。
 *   - **「不可变 total」**：本函数**不** mutate 输入 `nodes`——caller
 *     拿到 `next` 后**自己**赋回 state。中间 throw（replacement 找不
 *     到范围）会保留 caller 的 state 完整，**不**会留半改的 fold。
 *     「同一条坏 event 在每次 retry 都同样 fail」是这个语义的副产品。
 *   - **「replacement 找不到范围 = log 损坏」**：committed log 在 append
 *     期就**验过** surface 一致性，fold 阶段再 fail = 持久化层破坏了
 *     invariant。**必须** fail loud——skip 掉就静默丢一条 surface
 *     事件，压力读数悄悄错。
 *   - **`deriveEventMessage` 拿不到 message → `tokens = 0`**：有些
 *     surface event 不派生 message（比如纯 metadata 类的 op）；不抛，
 *     让「0-token 节点」也合法地进入 surface（shadow 用）。
 *   - **`deltaTokens = tokens - removed`**（replace 路径）：**signed**
 *     delta 让 caller 直接 update「surface 总价变了多少」；不是「
 *     绝对值」。
 *
 * 与其他模块的连接点：
 *   - `dsh-session.deriveEventMessage` 抽 surface event 的 message
 *   - `dsh-session.SurfaceEvent` 是输入
 *   - `estimate.ts` 的 `estimateMessage` 调作纯函数
 *   - `index.ts` 的 `_foldEvent` 调本文件，把 `deltaTokens` 加到
 *     `state.surfaceTokens`
 *   - `surface-projection.ts` 的 shadow price 与本 fold 数字必须**对账**
 */
 *
 * @module @deepseek-ai/dsh-token-meter/surface-fold
 */

import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import type { SurfaceEvent } from '@deepseek-ai/dsh-session'
import type { TokenSurfaceNode } from './types.ts'
import { estimateMessage } from './estimate.ts'

/** One surface event's placement and cost against the surface preceding it. */
export interface SurfaceTokenFold {
  /** Heuristic price of the event's own message; 0 when it derives none. */
  readonly tokens: number
  /** The surface after the event, detached from the input. */
  readonly nodes: TokenSurfaceNode[]
  /** Signed change in the surface total: `tokens` minus anything shadowed. */
  readonly deltaTokens: number
}

/**
 * Fold one surface event onto a priced surface.
 *
 * Total and allocation-fresh: the caller assigns the result rather than
 * mutating in place, so a throw here leaves the caller's state untouched and
 * the same malformed event fails identically on every retry.
 * @param nodes - the priced surface preceding this event, in model-visible order.
 * @param event - the surface event to place.
 * @returns the event's price, the next surface, and the signed total delta.
 * @throws when a replacement names a range absent from `nodes` — committed
 *   logs are surface-validated at append time, so an unresolvable range is log
 *   corruption and must fail loud rather than skip the event.
 */
export function foldSurfaceTokens(
  nodes: readonly TokenSurfaceNode[],
  event: SurfaceEvent,
): SurfaceTokenFold {
  const message = deriveEventMessage(event)
  const tokens = message === null ? 0 : estimateMessage(message)
  const op = event.surfaceOp
  if (op === 'append') {
    return { tokens, nodes: [...nodes, { seq: event.seq, tokens }], deltaTokens: tokens }
  }
  const startIdx = nodes.findIndex(node => node.seq === op.start)
  const endIdx = nodes.findIndex(node => node.seq === op.end)
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new Error(
      `token surface: replace at seq ${event.seq} has invalid current range ${op.start}-${op.end}`,
    )
  }
  const removed = nodes
    .slice(startIdx, endIdx + 1)
    .reduce((total, node) => total + node.tokens, 0)
  const next = [...nodes]
  next.splice(startIdx, endIdx - startIdx + 1, { seq: event.seq, tokens })
  return { tokens, nodes: next, deltaTokens: tokens - removed }
}
