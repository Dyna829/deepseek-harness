/**
 * @file `skills` domain 的 zod schema。
 *
 * 关键设计：
 *   - **schema 名从 `rpc-map.ts` 派生**：`skillListRequestSchema` /
 *     `skillListValueSchema` 机械对应。加 method 时三处都得改。
 *   - **`name: z.string().min(1)`**：`/name` token 在 composer 里是
 *     「引用入口」——空字符串在 UI 上**没**意义，**也不**是合法 skill id。
 *   - **`description: z.string()`**（**不** min(1)）：description 可
 *     缺 / 可空 host 在 catalog 里允许「no description」skill，schema
 *     不**强**制。
 *   - **`modelInvocable` 强 `z.boolean()`**：`true` = model 也能调；
 *     `false` = `disable-model-invocation`（仅 user 在 composer 调）。
 *     client 端用此决定「这个 skill 进不进 model 的 system prompt」——
 *     boolean 必须是**明确**值，**不**是 optional。
 *
 * 与其他模块的连接点：
 *   - `rpc-map.ts` 的 `RequestPayload` / `ResponseValue`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `sessions.schema.ts` 的 `sessionIdSchema`
 *   - `skills.ts` 是 type-only 入口
 *   - `dsh-skill` 提供 host 端 catalog / `isUserInvocable`
 *   - `api-proxy.ts` 验 + 翻译
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { SkillEntry } from './skills.ts'

/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<SkillEntry>>

/** skill.list request payload. */
export const skillListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.list'>>>

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.list'>>>
