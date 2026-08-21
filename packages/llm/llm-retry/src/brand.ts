/**
 * @file `dsh-llm-retry` 自有的 branded id：retry chain 身份。
 *
 * 关键概念：**`RetryId` 是「一次 request-step 的整条重试链」**——
 * 同一个 `(turn, step, provider, policyKey)` 上 N 个 retry 共享**一个**
 * `RetryId`。这让：
 *   - crash 之后从 session log 重建能识别「这 N 个 retry 是同一条链」；
 *   - invariant 能拒绝「`retryId` 出现在两条不同的 chain 上」（即一个
 *     `retryId` 被两个 chain 抢用）。
 *
 * 没有底层校验（`id as RetryId` 强制断言），跟 `dsh-llm/brand.ts` 的
 * 同名 helper 同一惯例——branding 是 nominal typing 工具，**不**是
 * runtime 验证。
 *
 * 与其他模块的连接点：
 *   - `dsh-brand` 提供 `Branded<B>` 原始类型
 *   - `types.ts` 的 `LlmRetryEventData` / `LlmRetryStartedEventData`
 *     都有 `retryId: RetryId` 字段
 *   - `index.ts` 在 `recover` 里给新 chain mint 一个 `RetryId(randomUUID())`
 */

/** Stable identity shared by every attempt in one request-step retry chain. */
export type RetryId = Branded<'RetryId'>

/**
 * Brand an implementation-minted retry-chain identity.
 * @param id - opaque retry identity.
 * @returns the same string, branded; no validation is performed.
 */
export function RetryId(id: string): RetryId {
  return id as RetryId
}
