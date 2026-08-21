/**
 * @file `workspace` domain 的 zod schema。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **schema 名从 `rpc-map.ts` 派生**：跟其它 domain 同惯例。
 *   - **`workspaceIdSchema` 住在 `sessions.schema.ts` 不是本文件**：
 *     `session.create` 引用它，本文件反过来引用 `sessionIdSchema`——
 *     schema 模块**必须**保持 DAG（顶层 import 互引 = 加载期 TDZ）。
 *     本文件**只是 re-export** 作为本域「本地名」，不重新 cast。
 *   - **`rename.title` 走 `.refine(... .trim() !== '', { message })`**：
 *     「rename 但 title 全是空白」在 wire 边界 fail loud（`bad-request` +
 *     zod issues），**不**让 host 写一条「实际无变化」的 `workspace/updated`
 *     事件（`trim() === ''` 跟「rename 到 current title」是同一类反信号）。
 *   - **`insertBefore` / `insertSessionBefore.beforeWorkspaceId?` /
 *     `beforeSessionId?`**：anchor **缺省 = append to end**——是合法
 *     「我想挪到最后」语义，**不**是「忘了填」。
 *   - **`archiveSession` 返 `archivedSessionIds: z.array(...)` 的全集**：
 *     让 client 不用「archive 一个拿回一个」轮询——`workspace.list`
 *     已经**不**返 archived，archive 自身的 response 是「权威完整集」，
 *     跟 `host/archived-sessions-changed` frame 内容**一致**。
 *   - **`create.created: z.boolean()`**：`true` = 真的新建；`false` =
 *     path 已被另一 workspace 拥有（**幂等**返回那个 workspace）。
 *     client 端靠 `created` 字段决定「toast「Workspace created」」
 *     vs 「toast「Already in your workspaces」」。
 *
 * 与其他模块的连接点：
 *   - `rpc-map.ts` 的 `RequestPayload` / `ResponseValue`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `sessions.schema.ts` 的 `sessionIdSchema` / `workspaceIdSchema`（DAG）
 *   - `workspace.ts` 是 type-only 入口
 *   - `dsh-workspace` 提供 host 端 registry / ordering
 *   - `api-proxy.ts` 验 + 翻译
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { WorkspaceView } from './workspace.ts'
import { sessionIdSchema, workspaceIdSchema } from './sessions.schema.ts'

export { workspaceIdSchema } from './sessions.schema.ts'

/** WorkspaceView row of every workspace.* response. */
export const workspaceViewSchema = z.object({
  workspaceId: workspaceIdSchema,
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(sessionIdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Wire<WorkspaceView>>

/** workspace.list request payload (empty object literal). */
export const workspaceListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'workspace.list'>>>

/** workspace.list response value. */
export const workspaceListValueSchema = z.object({
  items: z.array(workspaceViewSchema),
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.list'>>>

/** workspace.create request payload: the existing directory to adopt. */
export const workspaceCreateRequestSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.create'>>>

/** workspace.create response value. */
export const workspaceCreateValueSchema = z.object({
  workspace: workspaceViewSchema,
  created: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.create'>>>

/** workspace.rename request payload: the new title must be non-blank. */
export const workspaceRenameRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  title: z.string(),
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'workspace.rename requires a non-blank title' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.rename'>>>

/** workspace.rename response value. */
export const workspaceRenameValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.rename'>>>

/** workspace.delete request payload. */
export const workspaceDeleteRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.delete'>>>

/** workspace.delete response value. */
export const workspaceDeleteValueSchema = z.object({
  deleted: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.delete'>>>

/** workspace.insertBefore request payload (anchor omitted = append to end). */
export const workspaceInsertBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  beforeWorkspaceId: workspaceIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertBefore'>>>

/** workspace.insertBefore response value: the complete durable display order. */
export const workspaceInsertBeforeValueSchema = z.object({
  workspaceIds: z.array(workspaceIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertBefore'>>>

/** workspace.insertSessionBefore request payload (anchor omitted = append to end). */
export const workspaceInsertSessionBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  sessionId: sessionIdSchema,
  beforeSessionId: sessionIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertSessionBefore'>>>

/** workspace.insertSessionBefore response value. */
export const workspaceInsertSessionBeforeValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertSessionBefore'>>>

/** workspace.archiveSession request payload. */
export const workspaceArchiveSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.archiveSession'>>>

/** workspace.archiveSession response value: the full updated archive set. */
export const workspaceArchiveSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.archiveSession'>>>
