/**
 * @file 启发式「context 组成」projection 的纯 fold。
 *
 * 三个数字（system / tools / message）从**不同来源**取：
 *   - **system / tools**：**last-wins** per `request/header`——「最近一次
 *     request envelope」上的 system prompt 和 tool schema 估价。
 *   - **message**：走 `foldSurfaceProjection`（**和** context-pressure
 *     projection **用同一个 O(1) fold**）——完全 metered 的 log 在每条
 *     event 边界上 `messageTokens === measure().surfaceTokens`。
 *
 * 关键不变量：
 *   - **Estimator 共用**：`estimateSystemTokens` / `estimateToolsTokens`
 *     从 `./estimate.ts` 直接拿，**和** `TokenMeter` 走的是同一套
 *     `CHARS_PER_TOKEN` / `ROLE_OVERHEAD` 常量。projection 数字**不会**
 *     跟 `measure()` 数字漂。
 *   - **`stateVersion: 2`**：持久化 checkpoint 的 schema 版本。改 state
 *     shape 时**必须** bump 数字，老的 persisted state 走迁移或丢弃。
 *   - **「replacement 没 claim」= 保留 message 总价**：跟 context-pressure
 *     projection 的语义一致——compaction 没记 shadow 价就别无端抹掉。
 *   - **`messageTokens + systemTokens + toolsTokens` ≠ provider 报 total**：
 *     estimator 系统性低估 CJK / JSON schema，**故意**留下的偏差由
 *     `projectedTokens` 锚定 provider 兜住。
 *
 * 与其他模块的连接点：
 *   - `surface-projection.ts` 的 `foldSurfaceProjection`（O(1) fold）
 *   - `estimate.ts` 的 `estimateSystemTokens` / `estimateToolsTokens`
 *   - `dsh-session.canonicalHeader` 拿规范化 envelope
 *   - `dsh-session-projection.ProjectionDefinition` 是接口
 *   - `projection.ts` 的 `SessionProjectionMap` 选择位（通过 `declare module` 接入）
 *   - `index.ts` 的 `ctx.sessionProjections.register` 挂上
 */

import { z } from 'zod'
import { canonicalHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { estimateSystemTokens, estimateToolsTokens } from './estimate.ts'
import { foldSurfaceProjection } from './surface-projection.ts'
import type { ShadowPriceClaim } from './surface-projection.ts'
// Import for the `contextBreakdown` SessionProjectionMap key merge.
import type {} from './projection.ts'

interface ContextBreakdownState {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
  /** Shadow price armed by the immediately preceding metering event. */
  claim?: ShadowPriceClaim
}

const breakdownSchema = z.object({
  systemTokens: z.number().int().nonnegative(),
  toolsTokens: z.number().int().nonnegative(),
  messageTokens: z.number().int().nonnegative(),
}).strict()

/**
 * Token-meter's context-composition projection unit.
 *
 * Envelope figures are last-wins per `request/header`; the message figure
 * rides {@link foldSurfaceProjection} — the same O(1) fold the occupancy
 * projection uses — so fully metered logs equal `measure().surfaceTokens` at
 * every event boundary and compaction shrinks the figure by its logged shadow
 * price. A replacement without a claim preserves the previous total. The
 * state is a fixed handful of numbers, so the persisted checkpoint stays
 * O(1) over the session's life.
 */
export const contextBreakdownProjectionDefinition:
ProjectionDefinition<'contextBreakdown', ContextBreakdownState> = {
  key: 'contextBreakdown',
  schema: breakdownSchema,
  init: () => ({ systemTokens: 0, toolsTokens: 0, messageTokens: 0 }),
  apply: (state, event) => {
    const fold = foldSurfaceProjection(state.claim, event)
    let systemTokens = state.systemTokens
    let toolsTokens = state.toolsTokens
    if (event.type === 'request/header') {
      const header = canonicalHeader(event.data.header)
      systemTokens = estimateSystemTokens(header)
      toolsTokens = estimateToolsTokens(header)
    }
    if (systemTokens === state.systemTokens
      && toolsTokens === state.toolsTokens
      && fold.deltaTokens === 0
      && fold.claim === undefined
      && state.claim === undefined) return state
    return {
      systemTokens,
      toolsTokens,
      messageTokens: state.messageTokens + fold.deltaTokens,
      ...fold.claim === undefined ? {} : { claim: fold.claim },
    }
  },
  view: ({ systemTokens, toolsTokens, messageTokens }) => ({ systemTokens, toolsTokens, messageTokens }),
  stateVersion: 2,
}
