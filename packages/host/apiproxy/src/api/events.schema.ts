/**
 * @file `events` domain 的 zod schema——`MuxFrame` / `HostFrame` 两条
 * server-stream union。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **`discriminatedUnion('type', ...)`**：每条 frame 在 wire 上是 tagged
 *     union；未知 `type` 直接 reject（**不**是 silently generic render）。
 *   - **`session/event` frame 复用 `sessions.schema.ts` 的 `sessionEventSchema`**
 *     ——strict envelope + wide data passthrough 模式，**不**在 events
 *     schema 重新定义一份。
 *   - **`question/requested` `questions.min(1)`**：wire contract 上**强
 *     制**至少 1 个问题——`dsh-user-questions` 的 `ask()` 已经在 host 端
 *     拒空 batch（`EMPTY_QUESTIONS`），所以**空**的 frame 是 host 端
 *     损坏，**必须**在这里 fail loud，**不**让它到 composer。
 *   - **`session/projection.value` / `host/remote-event.args` 是 `z.unknown()`**：
 *     值已经在它**自己** unit 的 schema 里验过；在这里**再**深验意味着
 *     carrier schema import 全部 domain schema。这条**故意**保持 wide
 *     ——host 端在 forward 之前**已经**验过 JSON-safety。
 *   - **`askUserQuestionItem.intent` 是 `discriminatedUnion('kind', ...)`**：
 *     presentation intent 在 wire 上 tagged union；未知 `kind` 直接
 *     reject frame。
 *
 * 与其他模块的连接点：
 *   - `rpc.schema.ts` 提供 `rpcErrorSchema` / `rpcIdSchema`
 *   - `sessions.schema.ts` 复用 `sessionEventSchema` / `sessionIdSchema` /
 *     `messageIdSchema` / `contentBlockSchema` / `toolEventViewSchema`
 *   - `approvals.schema.ts` 提供 `approvalRequestIdSchema`
 *   - `jobs.schema.ts` 提供 `taskViewSchema`
 *   - `workspace.schema.ts` 提供 `workspaceViewSchema` / `workspaceIdSchema`
 *   - `events.ts` 是 type-only 入口
 *   - `api-proxy.ts` / `fetch/handler.ts` 验
 */

import { z } from 'zod'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import type { HostFrame, MuxFrame } from './events.ts'
import type { Wire } from './rpc.schema.ts'
import { rpcErrorSchema, rpcIdSchema } from './rpc.schema.ts'
import { approvalRequestIdSchema } from './approvals.schema.ts'
import {
  contentBlockSchema, messageIdSchema, sessionEventSchema, sessionIdSchema, toolEventViewSchema,
} from './sessions.schema.ts'
import { taskViewSchema } from './jobs.schema.ts'
import { workspaceIdSchema, workspaceViewSchema } from './workspace.schema.ts'

/** Question fields validated strictly against core dsh-user-questions. */
export const askUserQuestionItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  header: z.string().optional(),
  detail: z.string().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })).optional(),
  multiSelect: z.boolean().optional(),
  // Presentation intent: a tagged union on the wire, so an unknown tag is a
  // rejected frame rather than a silently generic render.
  intent: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('plan-review'), approve: z.string() }),
  ]).optional(),
}) satisfies z.ZodType<Wire<AskUserQuestionItem>>

/** Unified message envelope carried by transient queue frames. */
const messageSchema = z.object({
  id: z.string().min(1),
  role: z.union([z.literal('system'), z.literal('user'), z.literal('assistant')]),
  content: z.array(contentBlockSchema),
  source: z.looseObject({ kind: z.string() }),
})

/** MuxFrame union (payload slot of a mux-stream ServerRequest). */
export const muxFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session/event'), sessionId: sessionIdSchema, event: sessionEventSchema, view: toolEventViewSchema.optional() }),
  z.object({ type: z.literal('session/subscribed'), sessionId: sessionIdSchema, lastSeq: z.number().int() }),
  z.object({ type: z.literal('approval/requested'), sessionId: sessionIdSchema, approvalId: approvalRequestIdSchema, toolName: z.string(), callId: z.string().optional(), reason: z.string().optional() }),
  z.object({ type: z.literal('approval/resolved'), sessionId: sessionIdSchema, approvalId: approvalRequestIdSchema, outcome: z.union([z.literal('allowed-once'), z.literal('rejected'), z.literal('cancelled'), z.literal('unavailable')]) }),
  // Non-empty by wire contract: the user-questions service rejects empty
  // batches at ask() (EMPTY_QUESTIONS), so an empty frame is host breakage
  // and must fail loud here, not reach the composer.
  z.object({ type: z.literal('question/requested'), sessionId: sessionIdSchema, questions: z.array(askUserQuestionItemSchema).min(1) }),
  z.object({ type: z.literal('question/resolved'), sessionId: sessionIdSchema, questionRpcId: rpcIdSchema, outcome: z.union([z.literal('answered'), z.literal('cancelled')]) }),
  z.object({
    type: z.literal('session/queue'),
    sessionId: sessionIdSchema,
    items: z.array(z.object({
      id: messageIdSchema,
      placement: z.union([z.literal('queued'), z.literal('steering'), z.literal('context')]),
      message: messageSchema,
    })),
  }),
  z.object({ type: z.literal('session/jobs'), sessionId: sessionIdSchema, jobs: z.array(taskViewSchema) }),
  // value stays wide: it already passed its unit's own schema on the host,
  // and deep-validating here would import every domain's schema into the carrier.
  z.object({ type: z.literal('session/projection'), sessionId: sessionIdSchema, key: z.string().min(1), value: z.unknown(), seq: z.number().int().nonnegative() }),
  z.object({ type: z.literal('stream/error'), error: rpcErrorSchema }),
]) as unknown as z.ZodType<MuxFrame>

/** HostFrame union (payload slot of a host-stream ServerRequest). */
export const hostFrameSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('host/session-added'),
    sessionId: sessionIdSchema,
    blank: z.boolean(),
    parentSessionId: sessionIdSchema.optional(),
    origin: z.literal('subagent').optional(),
    cwd: z.string().optional(),
    agentPreset: z.string().optional(),
  }),
  z.object({ type: z.literal('host/session-removed'), sessionId: sessionIdSchema }),
  z.object({ type: z.literal('host/session-status'), sessionId: sessionIdSchema, running: z.boolean() }),
  z.object({ type: z.literal('host/agent-error'), sessionId: sessionIdSchema, message: z.string() }),
  z.object({ type: z.literal('host/workspace-changed'), workspace: workspaceViewSchema }),
  z.object({ type: z.literal('host/workspace-removed'), workspaceId: workspaceIdSchema }),
  z.object({ type: z.literal('host/workspace-order-changed'), workspaceIds: z.array(workspaceIdSchema) }),
  z.object({ type: z.literal('host/archived-sessions-changed'), archivedSessionIds: z.array(sessionIdSchema) }),
  // args stays wide, the same posture as session/projection's value: the frame
  // arrives from JSON.parse, so every element is already a JSON value, and the
  // structural contract belongs to the owner package's cordis `Events`
  // declaration — the host validated JSON-safety before forwarding.
  z.object({ type: z.literal('host/remote-event'), event: z.string().min(1), args: z.array(z.unknown()) }),
  z.object({ type: z.literal('stream/error'), error: rpcErrorSchema }),
]) as unknown as z.ZodType<HostFrame>
