/**
 * @file LLM adapter 边界 throw 出来的值的「归一化」——把任意值（Error / 普通
 * throw / SDK Error 副本）转成可序列化的 `LlmFailure`。
 *
 * 关键约束（写在那里但必须理解才能改）：
 *   - **跨 package 拷贝 `instanceof` 不可信**：SDK 抛出来的 `LlmError` 经过
 *     structured-clone / cross-realm 之后 class identity 可能丢。所以本模块
 *     走「读 own data property」路线，**不**靠 `instanceof HarnessError`。
 *   - **`failure` / `code` 都用 own property descriptor 读**：用 `getOwnPropertyDescriptor`
 *     拿 data descriptor 而不是直接 `error.failure`——后者会触发 SDK 写的
 *     accessor，里面可能抛 `TypeError`（SDK property trap）。要的就是「读 own
 *     data，绕过 accessor」。
 *   - **信任门**：只有「`carried.code === ownErrorCode(error)`」完全一致，才
 *     采用 SDK 自带的 `failure` 快照；否则只用 `message` + `harnessErrorCode`
 *     重做一个——任何字段对不上就当「这个 SDK 不可信」。
 *   - **hostile value 容错**：`String(value)` / `error.message` 都用 try/catch
 *     兜底——adapter 抛「getter throws」之类病态对象不能让归一化函数自己挂。
 *
 * 与其他模块的连接点：
 *   - `LlmRuntime.adapterStream` 在 adapter 失败时调 `normalizeLlmFailure`，
 *     再产 `finish: error` chunk
 *   - `retry-policy` 读 `LlmFailure.code` 决定要不要重试
 */

import { HarnessError } from './error.ts'
import type { LlmFailure } from './types.ts'

/**
 * Detach serializable provider facts from a value thrown by an adapter.
 * @param value - arbitrary value thrown during adapter dispatch or iteration.
 * @returns immutable provider-neutral facts suitable for a terminal finish chunk.
 * @internal
 */
export function normalizeLlmFailure(value: unknown): LlmFailure {
  const error = value instanceof Error
    ? value
    : new HarnessError(thrownMessage(value), 'UNKNOWN', { cause: value })
  // Cross-package copies preserve own data but not class identity. Trust the
  // carried facts only when both own properties agree after validation.
  const carried = ownFailureSnapshot(error)
  if (carried !== undefined && carried.code === ownErrorCode(error)) return carried
  return Object.freeze({
    message: errorMessage(error),
    code: harnessErrorCode(error),
  })
}

/** Render a non-Error throw without letting hostile coercion escape normalization. */
function thrownMessage(value: unknown): string {
  try {
    const message = String(value)
    return message.length > 0 ? message : 'LLM adapter failed'
  } catch (_hostileThrownValue) {
    return 'LLM adapter failed'
  }
}

/** Read a foreign error's own data-backed `code` without invoking accessors. */
function ownErrorCode(error: Error): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
  } catch (_sdkPropertyTrap) {
    return undefined
  }
}

/** Snapshot an own data property without invoking an SDK-defined accessor. */
function ownFailureSnapshot(error: Error): LlmFailure | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'failure')
    return descriptor !== undefined && 'value' in descriptor
      ? failureSnapshot(descriptor.value)
      : undefined
  } catch (_sdkPropertyTrap) {
    return undefined
  }
}

/** Validate and detach an arbitrary serializable failure payload. */
function failureSnapshot(value: unknown): LlmFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    const candidate = value as Partial<LlmFailure>
    const message = candidate.message
    const code = candidate.code
    const status = candidate.status
    const providerRetryAfterMs = candidate.providerRetryAfterMs
    const requestId = candidate.requestId
    if (typeof message !== 'string' || message.length === 0
      || typeof code !== 'string' || code.length === 0
      || (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599))
      || (providerRetryAfterMs !== undefined
        && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0))
      || (requestId !== undefined && (typeof requestId !== 'string' || requestId.length === 0))) return undefined
    return Object.freeze({
      message,
      code,
      ...status === undefined ? {} : { status },
      ...providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs },
      ...requestId === undefined ? {} : { requestId },
    })
  } catch (_sdkFailureGetter) {
    return undefined
  }
}

/** Read an SDK error message without letting an accessor replace the primary failure. */
function errorMessage(error: Error): string {
  try {
    const message: unknown = error.message
    if (typeof message === 'string' && message.length > 0) return message
  } catch (_sdkMessageGetter) {
    // The fallback below preserves a serializable failure beside the original Error.
  }
  return 'LLM adapter failed'
}

/** Trust only Harness-owned codes; third-party SDK codes are not our taxonomy. */
function harnessErrorCode(error: Error): string {
  return error instanceof HarnessError ? error.code : 'UNKNOWN'
}
