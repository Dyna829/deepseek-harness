/**
 * @file `rpc` message-layer 的 zod schema——四个 wire full form + error body
 * + carrier receipt。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「Two-level parse discipline」**：full-form schema 的 `payload`
 *     槽是 `z.unknown()`——business payload **不**在这里 parse。**第一**
 *     次 parse envelope（rpcId / result 形态）→ routing via `method` →
 *     **第二**次 parse `result.value` 走各 domain 的具体 schema。两
 *     段失败给**不同**错（envelope 坏 → `bad-request`；payload 坏 →
 *     业务错 + host 端可重发让 client 重答）。
 *   - **`Wire<T>` 类型 widen**：`exactOptionalPropertyTypes` 开 + zod
 *     `.optional()` 输出 `T | undefined`——`satisfies z.ZodType<T>` 直
 *     接挂钩会**编译失败**。`Wire<T>` 把每个 property deep widen 成
 *     `T | undefined`：「absent」和「value undefined」wire JSON 上是
 *     **同一**（`JSON.stringify` 不写 `undefined`）——**没**丢任何
 *     验证语义。
 *   - **`rpcIdSchema` 是 `z.string()`**（**不** min(1)）：id 是**不透
 *     明** echo token，handler 在 id 不可读时**替**一个 sentinel——
 *     拒 client 端的 id 只是把「可关联 error 报告」变成「client 端
 *     parse 失败」。
 *   - **`rpcErrorSchema` 是 `discriminatedUnion('code', ...)`**：加一个
 *     code = 在 union 加一项 + 在 `rpc.ts` 的 `RpcErrorDetailsMap` 加
 *     一行——两处都得改，**不**会让 details 类型**不一致**。
 *   - **`details: z.object(...)` 都是 required（**不**可选）**：error
 *     response 永远**有** machine-readable 详情（**不**留空 `{}`）——
 *     client 端可以**总是**拿 details 做路由/重试/UI。
 *
 * 与其他模块的连接点：
 *   - `rpc.ts` 的 `ClientRequest` / `ClientResponse` / `ServerRequest` /
 *     `ServerResponse` / `RpcError` / `RpcId` / `RpcReceipt` 是 type-only 入口
 *   - `rpc-map.ts` 派生 `RequestPayload` / `ResponseValue`
 *   - 任何 `*.schema.ts` 的 `Wire<...>` 都用本文件
 *   - `fetch/handler.ts` / `fetch/client.ts` 走本 schema 验 envelope
 *   - `api-proxy.ts` 走 `rpcErrorSchema` 形态构造 error response
 */

import { z } from 'zod'
import type { z as zCore } from 'zod'
type ZodIssue = zCore.core.$ZodIssue
import type { ClientRequest, ClientResponse, RpcError, RpcId, RpcReceipt, ServerRequest, ServerResponse } from './rpc.ts'

/**
 * Wire widening of a contract type: widens every property (deeply) to `original | undefined`.
 * The repo enables exactOptionalPropertyTypes while zod `.optional()` outputs `T | undefined`,
 * so `satisfies z.ZodType<ContractType>` is unusable across the board; anchoring is always
 * written `satisfies z.ZodType<Wire<ContractType>>` — the widening only adds undefined, so
 * missing fields / wrong types still fail to compile. On the JSON wire, "absent" and
 * "value undefined" serialize identically, so the widening loses no validation semantics.
 */
export type Wire<T> = T extends readonly (infer E)[] ? Wire<E>[]
  : T extends object ? { [K in keyof T]: Wire<T[K]> | undefined }
    : T

/**
 * RpcId: one brand cast after schema validation (the only cast point in this
 * file). No min-length: the id is an opaque echo token, and rejecting values
 * here would only turn a correlatable error report into a client-side parse
 * failure (the handler substitutes a sentinel when a request's id is unreadable).
 */
export const rpcIdSchema = z.string() as unknown as z.ZodType<RpcId>

/** Error body: discriminated by code, per-branch details aligned to RpcErrorDetailsMap; details is required. */
export const rpcErrorSchema: z.ZodType<RpcError> = z.discriminatedUnion('code', [
  z.object({ code: z.literal('bad-request'), message: z.string(), details: z.object({ issues: z.array(z.custom<ZodIssue>()) }) }),
  z.object({ code: z.literal('cancelled'), message: z.string(), details: z.object({}) }),
  z.object({ code: z.literal('session-not-found'), message: z.string(), details: z.object({ sessionId: z.string() }) }),
  z.object({ code: z.literal('model-unavailable'), message: z.string(), details: z.object({ provider: z.string(), model: z.string() }) }),
  z.object({ code: z.literal('session-conflict'), message: z.string(), details: z.object({ sessionId: z.string(), requestedCwd: z.string(), existingCwd: z.string().optional() }) }),
  z.object({ code: z.literal('invalid-time-zone'), message: z.string(), details: z.object({ value: z.string() }) }),
  z.object({ code: z.literal('workspace-attach-failed'), message: z.string(), details: z.object({ sessionId: z.string(), workspaceId: z.string() }) }),
  z.object({ code: z.literal('workspace-not-found'), message: z.string(), details: z.object({ workspaceId: z.string() }) }),
  z.object({ code: z.literal('workspace-invalid-path'), message: z.string(), details: z.object({ path: z.string() }) }),
  z.object({ code: z.literal('workspace-name-conflict'), message: z.string(), details: z.object({ name: z.string() }) }),
  z.object({ code: z.literal('workspace-move-invalid'), message: z.string(), details: z.object({ workspaceId: z.string(), sessionId: z.string(), beforeSessionId: z.string().optional() }) }),
  z.object({ code: z.literal('directory-unreadable'), message: z.string(), details: z.object({ path: z.string() }) }),
  z.object({ code: z.literal('directory-exists'), message: z.string(), details: z.object({ path: z.string() }) }),
  z.object({ code: z.literal('directory-create-failed'), message: z.string(), details: z.object({ path: z.string() }) }),
  z.object({ code: z.literal('directory-picker-unavailable'), message: z.string(), details: z.object({ capability: z.string() }) }),
  z.object({ code: z.literal('agent-preset-read-only'), message: z.string(), details: z.object({ agentPreset: z.string(), reason: z.string() }) }),
  z.object({ code: z.literal('agent-preset-locked'), message: z.string(), details: z.object({ sessionId: z.string(), agentPreset: z.string() }) }),
  z.object({ code: z.literal('agent-preset-conflict'), message: z.string(), details: z.object({ sessionId: z.string(), requestedPreset: z.string(), existingPreset: z.string().optional() }) }),
  z.object({ code: z.literal('agent-preset-not-found'), message: z.string(), details: z.object({ agentPreset: z.string(), available: z.array(z.string()) }) }),
  z.object({ code: z.literal('agent-preset-invalid'), message: z.string(), details: z.object({ agentPreset: z.string(), reason: z.string() }) }),
  z.object({ code: z.literal('agent-busy'), message: z.string(), details: z.object({ reason: z.string() }) }),
  z.object({ code: z.literal('attachment-error'), message: z.string(), details: z.object({ reason: z.string() }) }),
  z.object({ code: z.literal('queue-item-not-found'), message: z.string(), details: z.object({ itemId: z.string() }) }),
  z.object({ code: z.literal('steer-unavailable'), message: z.string(), details: z.object({ itemId: z.string() }) }),
  z.object({ code: z.literal('command-error'), message: z.string(), details: z.object({}) }),
  z.object({ code: z.literal('unknown-command'), message: z.string(), details: z.object({}) }),
  z.object({ code: z.literal('settings-rejected'), message: z.string(), details: z.object({ ns: z.string() }) }),
  z.object({ code: z.literal('settings-conflict'), message: z.string(), details: z.object({ ns: z.string(), expected: z.number(), actual: z.number() }) }),
  z.object({ code: z.literal('credential-rejected'), message: z.string(), details: z.object({ ref: z.string() }) }),
  z.object({ code: z.literal('model-discovery-failed'), message: z.string(), details: z.object({ settingsNs: z.string(), baseURL: z.string().optional() }) }),
  z.object({ code: z.literal('title-invalid'), message: z.string(), details: z.object({ sessionId: z.string() }) }),
  z.object({ code: z.literal('fork-unavailable'), message: z.string(), details: z.object({ sessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-parent-unavailable'), message: z.string(), details: z.object({ parentSessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-not-found'), message: z.string(), details: z.object({ parentSessionId: z.string(), childSessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-catalog-diagnostic'), message: z.string(), details: z.object({
    parentSessionId: z.string(),
    childSessionId: z.string(),
    reason: z.union([z.literal('corrupt'), z.literal('unsupported'), z.literal('unavailable')]),
  }) }),
  z.object({ code: z.literal('subagent-not-resumable'), message: z.string(), details: z.object({ childSessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-unauthorized'), message: z.string(), details: z.object({ childSessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-delivery-unavailable'), message: z.string(), details: z.object({ childSessionId: z.string() }) }),
  z.object({ code: z.literal('internal'), message: z.string(), details: z.object({}) }),
]) as unknown as z.ZodType<RpcError>

/**
 * Business success/failure result schema (generic, reusable).
 * @param value - Schema for the business value.
 * @returns Schema for RpcResult<T>.
 */
export function rpcResultSchema<T>(value: z.ZodType<T>): z.ZodUnion<readonly [z.ZodType, z.ZodType]> {
  return z.union([
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: rpcErrorSchema }),
  ])
}

// ---- The four wire full-form schemas (payload/result.value slots stay wide — business layer does the second parse) ----
// The wide value slot is optional: a void business result serializes with no
// `value` field at all. Each endpoint's own second parse still requires its
// declared value, so absence never passes for a method that returns data.

/** ClientRequest full form (payload stays wide — the business layer runs the second parse). */
export const clientRequestSchema = z.object({
  type: z.literal('client-request'),
  rpcId: rpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
}) as unknown as z.ZodType<ClientRequest>

/** ServerResponse full form (result.value stays wide). */
export const serverResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: rpcIdSchema,
  result: rpcResultSchema(z.unknown().optional()),
}) as unknown as z.ZodType<ServerResponse>

/** ServerRequest full form (payload stays wide). */
export const serverRequestSchema = z.object({
  type: z.literal('server-request'),
  rpcId: rpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
}) as unknown as z.ZodType<ServerRequest>

/** ClientResponse full form (result.value stays wide). */
export const clientResponseSchema = z.object({
  type: z.literal('client-response'),
  rpcId: rpcIdSchema,
  result: rpcResultSchema(z.unknown().optional()),
}) as unknown as z.ZodType<ClientResponse>

/** Wire full-form union (discriminated by type). */
export const rpcMessageSchema = z.discriminatedUnion('type', [
  clientRequestSchema as unknown as z.ZodObject<z.ZodRawShape>,
  serverResponseSchema as unknown as z.ZodObject<z.ZodRawShape>,
  serverRequestSchema as unknown as z.ZodObject<z.ZodRawShape>,
  clientResponseSchema as unknown as z.ZodObject<z.ZodRawShape>,
])

/** Carrier receipt schema. */
export const rpcReceiptSchema = z.union([
  z.object({ accepted: z.literal(true) }),
  z.object({ accepted: z.literal(false), reason: z.union([z.literal('not-pending'), z.literal('bad-response')]) }),
]) satisfies z.ZodType<Wire<RpcReceipt>>
