/**
 * @file `agent-presets` domain 的 zod schema——wire 上**唯一**的 schema
 * 守门。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **schema 名从 `rpc-map.ts` 派生**：`agentPresetListRequestSchema` /
 *     `agentPresetListValueSchema` 等**机械**对应 method key。加 method
 *     时 `rpc-map.ts` 加一行 + 本文件加两个 schema，编译期 fail 兜住。
 *   - **`Wire<T>` 包装**：zod schema 验证的是 wire envelope（JSON 形态），
 *     不是 brand-typed TS 类型——所以用 `satisfies z.ZodType<Wire<T>>` 把
 *     schema 跟目标 wire 类型挂钩。`sessionIdSchema` 是从 `sessions.schema.ts`
 *     **复用**（同 DAG 约定），**不**重新 cast 一份 `SessionId` brand。
 *   - **`openDocument` 返 `discriminated union`（`{ opened: true }` /
 *     `{ opened: false, path }`）**：两种语义（真的打开了 / 没 opener
 *     返 path 给 surface 当文本显示）走同一返回值，zod union + 客户端
 *     TS 都能 discriminate。
 *
 * 与其他模块的连接点：
 *   - `rpc-map.ts` 提供 `RequestPayload` / `ResponseValue`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `sessions.schema.ts` 复用 `sessionIdSchema`（brand cast 单点）
 *   - `agent-presets.ts` 是 type-only 入口
 *   - `api-proxy.ts` 验证 / 翻译
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { AgentPresetEntry } from './agent-presets.ts'

/** AgentPresetEntry row of agentPreset.list. */
export const agentPresetEntrySchema = z.object({
  id: z.string().min(1),
  trust: z.union([z.literal('system'), z.literal('user')]),
  isDefault: z.boolean(),
  name: z.string().optional(),
  description: z.string().optional(),
  broken: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<AgentPresetEntry>>

/** agentPreset.list request payload. */
export const agentPresetListRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.list'>>>

/** agentPreset.list response value. */
export const agentPresetListValueSchema = z.object({
  presets: z.array(agentPresetEntrySchema),
  authorable: z.boolean(),
  hasDocument: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.list'>>>

/** agentPreset.select request payload. */
export const agentPresetSelectRequestSchema = z.object({
  sessionId: sessionIdSchema,
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.select'>>>

/** agentPreset.select response value. */
export const agentPresetSelectValueSchema = z.object({
  agentPreset: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.select'>>>

/** agentPreset.read request payload. */
export const agentPresetReadRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.read'>>>

/** agentPreset.read response value. */
export const agentPresetReadValueSchema = z.object({
  agentPreset: z.string(),
  trust: z.union([z.literal('system'), z.literal('user')]),
  content: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.read'>>>

/** agentPreset.copy request payload. */
export const agentPresetCopyRequestSchema = z.object({
  from: z.string().min(1),
  agentPreset: z.string().min(1),
  name: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.copy'>>>

/** agentPreset.copy response value. */
export const agentPresetCopyValueSchema = z.object({
  agentPreset: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.copy'>>>

/** agentPreset.openDocument request payload. */
export const agentPresetOpenDocumentRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.openDocument'>>>

/** agentPreset.openDocument response value. */
export const agentPresetOpenDocumentValueSchema = z.union([
  z.object({ opened: z.literal(true) }),
  z.object({ opened: z.literal(false), path: z.string() }),
]) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.openDocument'>>>

/** agentPreset.remove request payload. */
export const agentPresetRemoveRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.remove'>>>

/** agentPreset.remove response value. */
export const agentPresetRemoveValueSchema = z.object({
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.remove'>>>
