/**
 * @file `questions` domain 的 zod schema——`/api/respond` 在 routing 之后
 * 第二次 parse 的 schema。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「Payload 不带 question resource id」**：wire 关联走 `rpcId`，
 *     payload **不**再带一个 question id（防止「rpcId + question id」
 *     双标识**不**一致时谁说了算的歧义）。
 *   - **「`askUserQuestionAnswerSchema.answers` 是 `z.array(...)`**：核心
 *     端「一个 ask = 多条 question = **一个** answer」语义在 wire 上
 *     是「一个 `answers[]`」——schema 端**不**做「`min(1)`」，因为
 *     「我**没**选任何一条」也是合法答案（`selected: []`），**不**算
 *     「bad request」。
 *   - **`sessionIdSchema` 复用** `sessions.schema.ts` 的 cast——schema
 *     模块 DAG 保持。
 *
 * 与其他模块的连接点：
 *   - `dsh-user-questions` 的 `AskUserQuestionAnswer`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `sessions.schema.ts` 的 `sessionIdSchema`（同 DAG）
 *   - `questions.ts` 是 type-only 入口
 *   - `api-proxy.ts` 是 `/api/respond` 路由 + 二次 parse
 */

import { z } from 'zod'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/types'
import type { QuestionResponsePayload } from './questions.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** AskUserQuestionAnswer validated strictly against core dsh-user-questions. */
export const askUserQuestionAnswerSchema = z.object({
  answers: z.array(z.object({
    id: z.string(),
    selected: z.array(z.string()),
    custom: z.string().optional(),
  })),
}) satisfies z.ZodType<Wire<AskUserQuestionAnswer>>

/** Question answer payload (the result.value slot of a client-response). */
export const questionResponsePayloadSchema = z.object({
  sessionId: sessionIdSchema,
  answer: askUserQuestionAnswerSchema,
}) satisfies z.ZodType<Wire<QuestionResponsePayload>>
