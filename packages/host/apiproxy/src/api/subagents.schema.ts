/**
 * @file `subagents` domain 的 zod schema。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **`subagentListEntrySchema` 是 three-way discriminated union**：
 *     `kind: 'child'` + `mode: 'one-shot' | 'continuable'` 两个 mode 的
 *     `label` 字段规则**不**同（`one-shot` 可选，`continuable` 必填
 *     ——「continuable 必有可让用户重新接入的标题」），还有
 *     `kind: 'diagnostic'` 占位行。zod 端必须**两个** `child` 分支独立
 *     写，**不**用 `mode: z.union(...)` 一行带过去——TS 端 `label: string | undefined`
 *     对不上 continuable 必有 label 的语义。
 *   - **`messageIdSchema` 是本文件唯一的 brand cast**（`MessageId`）。
 *     跟 `SessionId` / `WorkspaceId` 的「全文件一处」惯例一致。
 *   - **`prompt` 强约束 `mode: z.literal('continuable')`**：`subagent.prompt`
 *     **只**对 continuable 合法——one-shot 不能 prompt，**只能**看 history。
 *     这条 schema 卡住 wire 上「one-shot 上 prompt」的非法请求。
 *   - **`as unknown as z.ZodType<...>` 用于 cross-domain 复用**：
 *     `contentBlockSchema` / `historyEntrySchema` / `sessionIdSchema` /
 *     `sessionProjectionsBlockSchema` 全部从 `sessions.schema.ts` 复
 *     用——**不**在 wire 上再独立写一份。
 *
 * 与其他模块的连接点：
 *   - `rpc-map.ts` 提供 `RequestPayload` / `ResponseValue`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `sessions.schema.ts` 复用 `contentBlockSchema` / `historyEntrySchema` /
 *     `sessionIdSchema` / `sessionProjectionsBlockSchema`
 *   - `subagents.ts` 是 type-only 入口
 *   - `dsh-llm/brand` 的 `MessageId` 是 `messageIdSchema` cast 目标
 *   - `api-proxy.ts` 验证 / 翻译
 */

import { z } from 'zod'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import {
  contentBlockSchema, historyEntrySchema, sessionIdSchema, sessionProjectionsBlockSchema,
} from './sessions.schema.ts'
import type { SubagentListEntry } from './subagents.ts'

/** Healthy and diagnostic durable catalog rows. */
export const subagentListEntrySchema = z.union([
  z.object({
    kind: z.literal('child'),
    id: sessionIdSchema,
    mode: z.literal('one-shot'),
    activity: z.union([z.literal('running'), z.literal('inactive')]),
    hasChildren: z.boolean(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal('child'),
    id: sessionIdSchema,
    mode: z.literal('continuable'),
    activity: z.union([z.literal('running'), z.literal('inactive')]),
    hasChildren: z.boolean(),
    label: z.string(),
  }),
  z.object({
    kind: z.literal('diagnostic'),
    id: sessionIdSchema,
    reason: z.union([z.literal('corrupt'), z.literal('unsupported'), z.literal('unavailable')]),
  }),
]) satisfies z.ZodType<Wire<SubagentListEntry>>

/** subagent.list request payload. */
export const subagentListRequestSchema = z.object({
  parentSessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'subagent.list'>>>

/** subagent.list response value. */
export const subagentListValueSchema = z.object({
  entries: z.array(subagentListEntrySchema),
  parentAvailable: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'subagent.list'>>>

/** subagent.history request payload. */
export const subagentHistoryRequestSchema = z.object({
  parentSessionId: sessionIdSchema,
  childSessionId: sessionIdSchema,
  mode: z.union([z.literal('one-shot'), z.literal('continuable')]),
  beforeSeq: z.number().int().nonnegative().optional(),
  maxMessages: z.number().int().positive().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'subagent.history'>>>

/** subagent.history response value. */
export const subagentHistoryValueSchema = z.object({
  events: z.array(historyEntrySchema),
  hasMore: z.boolean(),
  projections: sessionProjectionsBlockSchema.optional(),
}) as unknown as z.ZodType<Wire<ResponseValue<'subagent.history'>>>

/** subagent.prompt request payload. */
export const subagentPromptRequestSchema = z.object({
  parentSessionId: sessionIdSchema,
  childSessionId: sessionIdSchema,
  mode: z.literal('continuable'),
  content: z.array(contentBlockSchema),
  clientTimeZone: z.string().optional(),
}) as unknown as z.ZodType<RequestPayload<'subagent.prompt'>>

/** subagent.interrupt request payload. */
export const subagentInterruptRequestSchema = z.object({
  parentSessionId: sessionIdSchema,
  childSessionId: sessionIdSchema,
  mode: z.literal('continuable'),
}) satisfies z.ZodType<Wire<RequestPayload<'subagent.interrupt'>>>

/** subagent.interrupt response value. */
export const subagentInterruptValueSchema = z.object({
  accepted: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'subagent.interrupt'>>>

const messageIdSchema = z.string() as unknown as z.ZodType<MessageId>

/** subagent.prompt response value. */
export const subagentPromptValueSchema = z.object({
  messageId: messageIdSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'subagent.prompt'>>>
