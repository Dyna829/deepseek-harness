/**
 * @file `goals` domain 的 zod schema——**mutations only**。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「所有 value schema 是 `{ ref }` ack（`clear` 是 `{ cleared }`）」**：
 *     wire response **只**回 ack，**不**回当前 goal state——current state
 *     走 `'goal'` session projection（mux stream + history tail 的
 *     `SessionProjectionsBlock`）。这条**双重**约束让「同一份 goal
 *     state」永远从**一条**路径走，**不**会出现「wire response 和
 *     stream frame 不一致」。
 *   - **`goal.edit` `.refine(... objective !== undefined || maxGoalRounds !== undefined)`**：
 *     「edit 但**没**改任何字段」是**没**意义的 RPC；schema 在 wire
 *     边界 fail loud（`bad-request` with zod issues），不让 host 端
 *     写一条「无 op」的 goal/change event。
 *   - **`revision: z.number().int().positive()`**：`GoalRef.revision` 必
 *     须正整数；`0` 是「尚未创建」的 sentinel，**不**允许出现在 wire
 *     上（`create` 走的是不带 `ref` 的 request）。
 *   - **`maxGoalRounds: z.number().int().positive().optional()`**：必须
 *     正整数（**不**能 0 或负），跟 `goal.create` 同约束。
 *
 * 与其他模块的连接点：
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `rpc-map.ts` 的 `RequestPayload` / `ResponseValue`
 *   - `goals.ts` 是 type-only 入口
 *   - `api-proxy.ts` 验 + 翻译
 */

import { z } from 'zod'
import type { Wire } from './rpc.schema.ts'
import type { GoalRef, RequestPayload, ResponseValue } from './index.ts'

/** GoalRef schema. */
export const goalRefSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
}) as unknown as z.ZodType<Wire<GoalRef>>

/** Shared `{ ref }` acknowledgement value of every non-clear mutation. */
const goalRefValueSchema = z.object({ ref: goalRefSchema })

/** goal.create request payload. */
export const goalCreateRequestSchema = z.object({
  sessionId: z.string(),
  objective: z.string().min(1),
  maxGoalRounds: z.number().int().positive().optional(),
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.create'>>>

/** goal.create response value. */
export const goalCreateValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.create'>>>

/** goal.edit request payload. */
export const goalEditRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
  objective: z.string().min(1).optional(),
  maxGoalRounds: z.number().int().positive().optional(),
}).refine(value => value.objective !== undefined || value.maxGoalRounds !== undefined, {
  message: 'goal.edit requires objective or maxGoalRounds',
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.edit'>>>

/** goal.edit response value. */
export const goalEditValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.edit'>>>

/** goal.pause request payload. */
export const goalPauseRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.pause'>>>

/** goal.pause response value. */
export const goalPauseValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.pause'>>>

/** goal.resume request payload. */
export const goalResumeRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.resume'>>>

/** goal.resume response value. */
export const goalResumeValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.resume'>>>

/** goal.complete request payload. */
export const goalCompleteRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.complete'>>>

/** goal.complete response value. */
export const goalCompleteValueSchema = goalRefValueSchema as unknown as z.ZodType<Wire<ResponseValue<'goal.complete'>>>

/** goal.clear request payload. */
export const goalClearRequestSchema = z.object({
  sessionId: z.string(),
  ref: goalRefSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'goal.clear'>>>

/** goal.clear response value. */
export const goalClearValueSchema = z.object({
  cleared: z.literal(true),
}) as unknown as z.ZodType<Wire<ResponseValue<'goal.clear'>>>
