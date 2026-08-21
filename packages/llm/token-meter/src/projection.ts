/**
 * @file 纯 client-safe 的 token projection 词表。
 *
 * 三个 projection 配套使用，但**关注点不同**：
 *   - **`TokenUsageProjection`**：**累加**到整个 session log 的 provider
 *     报 usage；四个 disjoint 桶（**特别** `outputTokens` 已含 reasoning，
 *     不再累一遍）。
 *   - **`ContextPressureProjection`**：状态栏的「context 还剩多少」——
 *     **`pressureTokens` ≠ `projectedTokens`**，前者是「最近一次 provider
 *     报的 prompt 大小」，后者是「pressure + 自那之后的 surface 启发式
 *     reprice」。「切 model 时 capacity 新了但 usage 还没来」是个**有意的**
 *     妥协——这是给用户看的参考，不是 billing / gating 的输入。
 *   - **`ContextBreakdownProjection`**：启发式**组成**拆解（system / tools /
 *     message），**不**是总 token。estimator 系统性**低估** CJK 文本 / JSON
 *     schema，所以三个数加起**来不会**等于 `projectedTokens`——这条**故意**
 *     留下的偏差由 `projectedTokens` 锚定 provider usage 来兜住。
 *
 * 选位通过 `declare module '@deepseek-ai/dsh-session-projection/types'` 接
 * `SessionProjectionMap`——任何拿到 `ctx.sessionProjections` 的 composition
 * 都能订阅这三个 projection。
 *
 * 与其他模块的连接点：
 *   - `dsh-llm.TokenUsage` 字段语义沿用
 *   - `dsh-session-projection/types` 的 `SessionProjectionMap` 选择位
 *   - `usage-projection.ts` / `breakdown-projection.ts` 实现这三个
 *     projection 的 fold
 *   - 任何能调 `ctx.sessionProjections` 的 plugin 都能读
 */
 *
 * @module @deepseek-ai/dsh-token-meter/projection
 */

/**
 * Durable cumulative provider usage for a complete session log.
 *
 * The four buckets are disjoint. In particular, reasoning tokens are already
 * included in `outputTokens` and are not accumulated again.
 */
export interface TokenUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * Approximate context occupancy for a status display.
 *
 * The fields, when present, are deliberately NOT one atomic request
 * observation: each is a last-wins record of a different moment. Switching
 * models can therefore pair a fresh capacity with the previous route's
 * pressure until the next request reports usage. This is an intentional trade
 * — the value is a user-facing reference, not a billing or gating input. See
 * the token-meter README for the full rationale.
 */
export interface ContextPressureProjection {
  /**
   * Provider-reported prompt size of the most recent request: uncached input
   * plus cache reads and writes. Response output is excluded, so this does not
   * grow as the current turn streams. Absent until a provider reports usage.
   */
  pressureTokens?: number
  /**
   * What the NEXT request's prompt would cost: {@link pressureTokens} plus the
   * heuristic repricing of everything the surface gained or lost since that
   * sample. Only the delta is estimated, so the figure stays anchored to the
   * provider while still reacting the moment a compaction shadows a span —
   * which `pressureTokens` alone cannot do, since compaction reports no usage
   * of its own. Absent until a provider reports usage.
   */
  projectedTokens?: number
  /** Newest recorded route capacity; absent when no adapter advertised one. */
  contextWindow?: number
}

/**
 * Heuristic composition of the next request's context: what the prompt is
 * made of, not what it costs. All three figures use the meter's fixed
 * density estimate, so they will not sum to the provider-anchored
 * `projectedTokens`: the estimator systematically underprices CJK text and
 * JSON schemas, which is exactly the error the anchoring in
 * {@link ContextPressureProjection.projectedTokens} keeps out of the occupancy
 * figure. Present these as approximations of composition, never as a total.
 */
export interface ContextBreakdownProjection {
  /** Heuristic tokens of the newest request envelope's system prompt; 0 before any request. */
  systemTokens: number
  /** Heuristic tokens of the newest request envelope's tool schemas; 0 before any request. */
  toolsTokens: number
  /** Heuristic tokens of the current model-visible conversation surface. */
  messageTokens: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Provider-reported usage accumulated across the complete durable log. */
    tokenUsage: TokenUsageProjection
    /** Newest request pressure paired with the newest known route capacity. */
    contextPressure: ContextPressureProjection
    /** Heuristic system/tools/message composition of the next request. */
    contextBreakdown: ContextBreakdownProjection
  }
}
