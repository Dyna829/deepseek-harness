/**
 * @file `questions` domain contract——user-question 请求/回答的 wire 形态。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「question requested = server-request whose rpcId is **那个 question
 *     的稳定 id**」**：host 端 `ask()` accept 时 mint 这个 `rpcId`——core
 *     `user-questions` 在 request-level **没有**自己的 id（**只**有
 *     question.id，是 batch 内每条 question 的 id），所以 wire-level
 *     「ask 这件事」的稳定身份**就**是 `rpcId`。
 *   - **「answer 是 client-response echo 那个 rpcId」**：跟 approval
 *     同一形态——回答走 `POST /api/respond`，**不** mint 新 id，**不**
 *     是 unary method，**不**进 `RpcMethodMap`。
 *   - **「Payload 不带 question resource id」**：`rpcId` 本身就够——
 *     不必再在 payload 里塞一个 question id（这是 wire 关联**唯一**标识，
 *     不需要 second-tier）。
 *   - **「回答是 batch 级别，不是 per-question」**：core 的语义是「一个
 *     `ask` = 多条 question = **一个** answer」——client **不**能 split
 *     per-question 答。wire payload 只带 `answer` 一个字段，类型是
 *     `AskUserQuestionAnswer`（per-question 结构）。
 *
 * 与其他模块的连接点：
 *   - `dsh-user-questions` 的 `AskUserQuestionAnswer`
 *   - `dsh-session` 的 `SessionId`
 *   - `rpc.ts` 的 `ClientResponse` 形态
 *   - `questions.schema.ts` 是 zod 形态
 *   - `events.ts` 的 `question/requested` / `question/resolved` frame
 *     是 stream 出口
 *   - `api-proxy.ts` 是 host 端实现
 */

import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Question answer payload (the result.value slot of a client-response):
 * answers one ask() as a whole batch (core: one ask, many questions, one
 * answer — never split per question).
 */
export interface QuestionResponsePayload {
  sessionId: SessionId
  answer: AskUserQuestionAnswer
}
