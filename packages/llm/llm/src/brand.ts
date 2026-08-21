/**
 * @file `dsh-llm` 自有的 branded id：tool-call 关联 + provider 请求诊断。
 *
 * 关键观察：`Branded<B>` 原始类型住在 `@deepseek-ai/dsh-brand`（零依赖、纯
 * 类型）——所以**任何**有跨边界 id 的包都能用这套 nominal typing，不用反过来
 * 依赖 `dsh-llm`。本文件只是「我**自己**在 wire 上要带哪些 id」。
 *
 * 四个 id 的语义边界：
 *   - **`MessageId`**：跨 inbox / log / model-request 三层稳定身份。
 *   - **`CallId`**：model-issued 工具调用 ↔ tool result 的关联。真实 adapter
 *     用 provider 发的；mock / assembler fallback 合成。
 *   - **`ProviderRequestId`**：provider-issued 的请求 id，**只**用于诊断——
 *     不要拿它做幂等 / 取消，那是 `AbortSignal` 的事。
 *   - **`ReasoningEffortId`**：adapter 自有（不是 dsh-llm 自己的）——它是
 *     「这个 model 暴露了哪些 effort 档」的索引，由 adapter 暴露在
 *     `resolveModel().reasoning.efforts[]` 上。
 *
 * 与其他模块的连接点：
 *   - `dsh-agent` / `dsh-session` / `dsh-tools` 都会消费 `CallId` / `MessageId`
 *     类的 nominal type
 *   - `assembler.ts` 用 `CallId` 给 tool call 块打标
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity carried by one message across inbox, log, and model-request boundaries. */
export type MessageId = Branded<'MessageId'>

/**
 * Brand a message identifier.
 * @param id - the opaque message identifier.
 * @returns the same string, branded; no validation is performed.
 */
export function MessageId(id: string): MessageId {
  return id as MessageId
}

/**
 * Correlates a model-issued tool call with its result. Provider-issued for
 * real adapters; synthesized by mocks/assembler fallbacks.
 */
export type CallId = Branded<'CallId'>

/**
 * Brand a string as a {@link CallId}.
 * @param id - the provider-issued (or synthesized) call id.
 * @returns the same string, branded; no validation is performed.
 */
export function CallId(id: string): CallId {
  return id as CallId
}

/** Provider-issued request identifier retained for diagnostics across package boundaries. */
export type ProviderRequestId = Branded<'ProviderRequestId'>

/**
 * Brand a provider-issued request identifier.
 * @param id - the opaque provider-issued string.
 * @returns the same string, branded; no validation is performed.
 */
export function ProviderRequestId(id: string): ProviderRequestId {
  return id as ProviderRequestId
}

/** Adapter-owned identifier for one model's selectable reasoning effort. */
export type ReasoningEffortId = Branded<'ReasoningEffortId'>

/**
 * Brand an adapter-owned reasoning-effort identifier.
 * @param id - the opaque identifier exposed by one model capability.
 * @returns the same string, branded; no validation is performed.
 */
export function ReasoningEffortId(id: string): ReasoningEffortId {
  return id as ReasoningEffortId
}
