/**
 * @file `approvals` domain 的 zod schema——`/api/respond` 在 routing 到
 * pending table 之后**第二**次 parse 的 schema。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「respond 是 client-response，不是 unary」**：`/api/respond` 在
 *     carrier 端**第一**次 parse 是 `clientResponseSchema`（rpcId /
 *     result 形态），routing 用 rpcId 找 pending table；找到之后**第
 *     二**次 parse `result.value` 用本 schema 验。**两次 parse**是
 *     关键：第一次失败（坏 envelope）→ `bad-request`；第二次失败（坏
 *     payload shape）→ 业务错（host 端可以重发 `approval/requested`
 *     让 client 重答）。
 *   - **`approvalRequestIdSchema` 是本域唯一 `ApprovalRequestId` brand
 *     cast**——同 DAG 约定（**不**自己 `as ApprovalRequestId` 一份）。
 *   - **`outcome` union 只两个 literal**：`allowed-once` / `rejected`。
 *     `cancelled` / `unavailable` 是 host 侧 outcome，**不**让 client
 *     主动造。
 *   - **`sessionIdSchema` 复用** `sessions.schema.ts` 的 cast——schema
 *     模块 DAG 保持。
 *
 * 与其他模块的连接点：
 *   - `dsh-user-approval` 的 `ApprovalRequestId` brand
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `sessions.schema.ts` 的 `sessionIdSchema`（同 DAG）
 *   - `approvals.ts` 是 type-only 入口
 *   - `api-proxy.ts` 是 `/api/respond` 路由 + 二次 parse
 */

import { z } from 'zod'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { ApprovalResponsePayload } from './approvals.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** ApprovalRequestId: one brand cast after schema validation (the only cast point in this domain). */
export const approvalRequestIdSchema = z.string().min(1) as unknown as z.ZodType<ApprovalRequestId>

/** Approval answer payload (the result.value slot of a client-response). */
export const approvalResponsePayloadSchema = z.object({
  sessionId: sessionIdSchema,
  approvalId: approvalRequestIdSchema,
  outcome: z.union([z.literal('allowed-once'), z.literal('rejected')]),
}) satisfies z.ZodType<Wire<ApprovalResponsePayload>>
