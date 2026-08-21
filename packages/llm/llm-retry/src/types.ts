/**
 * @file `dsh-llm-retry` 的「session event 类型 + 选择位」——
 * 声明合并到 `dsh-session` 的 `SessionEventMap` 上。
 *
 * 两条 event 配套使用：
 *   - **`llm/retry`**：在 `cancellableDelay` **之前** append 的「**计划**
 *     重试」——记录 retry chain 起点 / 失败 facts / policy key / 计算的
 *     delay。**不** surface-rendered，是给 invariant + replay 用的。
 *   - **`llm/retry-started`**：delay 完成、**下一次** request attempt 真要
 *     发起之前 append 的「重试开始」——和 scheduled event 配对，让
 *     「计划中」vs「正在重试」在 log 里能区分。
 *
 * `LlmRetryEventData` 是按 `mode` discriminated 的 union：
 *   - `normal` 模式必带 `maxRetries`（invariant 会卡 `retry <= maxRetries`）；
 *   - `always` 模式**不能**带 `maxRetries`（invariant 也会拒）。
 *   - 两者都带 `policyKey`——同一 policy chain 共享一个 key + `retryId`，
 *     跨 fiber / 跨重启连续计数（重启不重置 retry 配额）。
 *
 * 与其他模块的连接点：
 *   - `dsh-session` 的 `SessionEventMap` 通过 declaration merge 接住
 *   - `dsh-llm` 的 `LlmFailure` 是 `failure` 字段的 schema
 *   - `brand.ts` 的 `RetryId` 标 retry chain
 *   - `invariant.ts` 校验这条 event 序列的不变量
 */

import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { RetryId } from './brand.ts'

export type { RetryId }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable, non-surface record of one provider-routed retry scheduled after a failed request attempt. */
    'llm/retry': LlmRetryEventData
    /** Durable transition written after a retry wait succeeds and before the next request attempt starts. */
    'llm/retry-started': LlmRetryStartedEventData
  }
}

/** Durable payload recorded before one provider-routed model-request retry wait. */
export type LlmRetryEventData =
  | {
    retryId: RetryId
    turn: number
    step: number
    provider: string
    mode: 'normal'
    policyKey: string
    retry: number
    maxRetries: number
    delayMs: number
    failure: LlmFailure
  }

  | {
    retryId: RetryId
    turn: number
    step: number
    provider: string
    mode: 'always'
    policyKey: string
    retry: number
    delayMs: number
    failure: LlmFailure
  }

/** Durable transition recorded after one retry delay completes. */
export interface LlmRetryStartedEventData {
  retryId: RetryId
  turn: number
  step: number
  retry: number
}
