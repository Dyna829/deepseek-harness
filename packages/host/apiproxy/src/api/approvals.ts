/**
 * @file `approvals` domain contract——approval 请求/回答的 wire 形态。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「approval requested = server-request (stable rpcId)」**：host
 *     在 mux stream 上发 `approval/requested` frame 时**mint**一个稳定
 *     `rpcId`——client 端必须能在「我点了 Yes / No」之后找到原 frame。
 *   - **「answer = client-response echo 那个 rpcId」**：回答走
 *     `POST /api/respond` 走 client-response（**不**是 unary method，
 *     **不**进 `RpcMethodMap`），**不** mint 新 id——`rpcId` 是「发起方
 *     mint，响应方 echo」的那条不变量在这里**仍然**成立。
 *   - **`POST /api/respond` 的 response body 是 `RpcReceipt`**（carrier
 *     收据）——**不**是 business result（business result 走 mux stream
 *     的 `approval/resolved` frame）。这条「**先**收 carrier receipt，
 *     **再**等 mux stream 上的 resolved」的两段形态是「host 收到
 *     response」与「host 真正 apply 完审批」分离的根。
 *   - **`outcome: 'allowed-once' | 'rejected'` 只两个值**：`cancelled`
 *     / `unavailable` 是 **host 侧** outcome（client 撤了 / host 端
 *     资源没了）——**不**让 client 端主动造这两个值。
 *   - **`approvalId` 是 core 端 audit 关联**（reconcile `approval/asked` /
 *     `decided` 事件）——**不**是 wire 关联，wire 关联走 `rpcId`。
 *
 * 与其他模块的连接点：
 *   - `dsh-user-approval` 的 `ApprovalRequestId` brand
 *   - `dsh-session` 的 `SessionId`
 *   - `rpc.ts` 的 `ClientResponse` / `RpcReceipt` 形态
 *   - `approvals.schema.ts` 是 zod 形态
 *   - `api-proxy.ts` 是 host 端实现
 *   - `events.ts` 的 `approval/requested` / `approval/resolved` frame
 *     是这条 contract 的 stream 出口
 */
 */

import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Approval answer payload (the result.value slot of a client-response). outcome accepts only
 * the two values a client can give (cancelled/unavailable are host-side outcomes). approvalId
 * is the core audit correlation (used by the impl to reconcile `approval/asked`/`decided`;
 * passes through core's existing brand); wire correlation is governed by the echoed rpcId.
 */
export interface ApprovalResponsePayload {
  sessionId: SessionId
  approvalId: ApprovalRequestId
  outcome: 'allowed-once' | 'rejected'
}
