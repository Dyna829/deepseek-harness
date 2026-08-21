/**
 * @file token-meter projection 单元共用的 **O(1)** surface-token fold。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「projection state 必须 bounded」**：持久化的 projection cache
 *     **整**存 unit state，**不**存 priced surface（`TokenMeter` 那种
 *     O(surface) 的节点列表）——因为那会让 checkpoint 随 session 寿命
 *     无限增长。所以**这**是 O(1) 的 fold。
 *   - **Shadow-price 协议**：replacement（`compaction/summary` /
 *     `compaction/prune`）**不**自己估被替换的 range；它前面的 metering
 *     event 把这个 range 的启发式 token 价**直接**写进 event。fold
 *     只保留一个 running total + 至多一个 pending claim，**永远不**留
 *     per-node 价。
 *   - **数字 exact by construction**：shadow-price producer 跟本模块
 *     **同**用 `./estimate.ts` 的固定 estimator——所以 fold 的 running
 *     total 在每条 event 边界上**等于** `measure().surfaceTokens`。
 *   - **「Claim 只能活一条 event」**：`compaction/*` event arm 一个 claim，
 *     **紧跟的** surface event 必须**消费**它。任何中间插队（非 shadow
 *     event / 不消费 claim）就让 claim 过期——producers 必须**同步相邻**
 *     写 shadow event 和 replacement。
 *   - **「Replacement 没 armed claim」= zero delta**：bounded state 算不
 *     出被替换 range 的价，**折中**保 replay 不挂（**代价**是数字漂）。
 *     这种情况只在**老 log**（shadow-price 协议**之前**录的）出现，
 *     新 session 不会有。
 *   - **「Claim 范围对不上 replace 范围」= throw**：这是**活的** producer
 *     在违反 shadow-price 合同——**不**是历史数据，**必须** fail loud，
 *     **不**让 total 漂。
 *
 * 与其他模块的连接点：
 *   - `estimate.ts.estimateMessage` 共用
 *   - `dsh-session.deriveEventMessage` 抽 surface event message
 *   - `dsh-session.isSurfaceEvent` 判 surface event
 *   - `dsh-compaction` 提供 `compaction/summary` / `compaction/prune` 事件
 *   - `usage-projection.ts` / `breakdown-projection.ts` 的 fold **共享**本模块
 *   - `index.ts` 的 `TokenMeter` **不**用本 fold（它走 `surface-fold.ts` 的
 *     O(surface) fold）——但**两套**数字必须对账
 */
 *
 * A projection state must stay bounded — the persisted projection cache
 * checkpoints every unit's whole state, so carrying the priced surface
 * (one node per model-visible message) would grow a checkpoint without
 * bound over the session's life. Instead, replacements ride the compact
 * seam's shadow-price protocol: the metering event immediately before a
 * surface `replace` (`compaction/summary` or `compaction/prune`) states the
 * heuristic price of the exact replaced range, so the fold keeps a running
 * total plus at most one pending claim and never retains per-node prices.
 * The counts are exact by construction: producers derive them from the same
 * fixed estimator this module prices appends with. A replacement without an
 * armed claim folds with zero delta because bounded state cannot reconstruct
 * the replaced range; this preserves replay at the cost of possible drift.
 *
 * @module @deepseek-ai/dsh-token-meter/surface-projection
 */

import { deriveEventMessage, isSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: the `compaction/*` SessionEventMap merges (shadow-price events).
import type {} from '@deepseek-ai/dsh-compaction'
import { estimateMessage } from './estimate.ts'

/**
 * One armed shadow price: the heuristic tokens of the surface range the
 * IMMEDIATELY following event replaces. Plain JSON — it is part of the
 * persisted unit state while armed.
 */
export interface ShadowPriceClaim {
  /** Declared inclusive first surface-node seq of the priced range. */
  start: number
  /** Declared inclusive last surface-node seq of the priced range. */
  end: number
  /** Heuristic tokens of the priced range under the fixed estimator. */
  tokens: number
}

/** One event's effect on a running surface-token total. */
export interface SurfaceTokensFold {
  /** Signed change in the surface total; 0 for events off the surface. */
  readonly deltaTokens: number
  /** Claim to carry into the next event; undefined when none survives. */
  readonly claim: ShadowPriceClaim | undefined
}

/**
 * Fold one committed event onto a running surface-token total.
 *
 * A shadow-price event arms a claim; any other event expires it, and a
 * surface `replace` consumes the claim naming its exact range — the
 * producers append the metering event and the replacement synchronously
 * adjacent, so a surviving claim always prices the very next event.
 * A replace with no claim folds with zero delta because the bounded state
 * cannot reconstruct the replaced range. An armed claim for another range
 * still fails because the adjacent events contradict each other.
 * @param claim - the claim armed by the immediately preceding event, if any.
 * @param event - the next committed session event.
 * @returns the signed token delta and the claim state after this event.
 * @throws when a replacement arrives with an armed claim for a different
 *   range — the metering event was adjacent, so this is a live producer's
 *   shadow-price contract violation, not historical data, and must fail
 *   loud rather than let the total drift.
 */
export function foldSurfaceProjection(
  claim: ShadowPriceClaim | undefined,
  event: SessionEvent,
): SurfaceTokensFold {
  if (event.type === 'compaction/summary' || event.type === 'compaction/prune') {
    const { shadowedRange, shadowedTokenCount } = event.data
    return {
      deltaTokens: 0,
      claim: { start: shadowedRange.start, end: shadowedRange.end, tokens: shadowedTokenCount },
    }
  }
  if (!isSurfaceEvent(event)) return { deltaTokens: 0, claim: undefined }
  const message = deriveEventMessage(event)
  const tokens = message === null ? 0 : estimateMessage(message)
  const op = event.surfaceOp
  if (op === 'append') return { deltaTokens: tokens, claim: undefined }
  // Sessions recorded before the shadow-price protocol log replacements with
  // no adjacent metering event; the bounded state cannot reconstruct the
  // replaced range's price, so fold those neutrally — historical replay
  // degrades to drift instead of failing.
  if (claim === undefined) return { deltaTokens: 0, claim: undefined }
  if (claim.start !== op.start || claim.end !== op.end) {
    throw new Error(
      `token surface: replace at seq ${event.seq} over range ${op.start}-${op.end} has no adjacent shadow price`
      + ` (armed claim covers ${claim.start}-${claim.end})`,
    )
  }
  return { deltaTokens: tokens - claim.tokens, claim: undefined }
}
