/**
 * @file `goals` domain contract——只暴露**写**接口，读走 session projection。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「Mutations only」**：**没有** `goal.get` / **没有** wire goal view。
 *     读走 `goal` session projection（history tail 的 `SessionProjectionsBlock`
 *     + mux stream 里的 `session/projection` frame）。mutations 的 response
 *     只 ack「新的 CAS ref」——**不**喂 client 状态（committed `goal/change`
 *     event 通过 mux stream 走「同样的整份值」到所有 client）。
 *   - **「CAS-guarded」**：`GoalRef` 是 `{ id, revision }` 元组——每次写
 *     都传 client 持有的「上一次拿到的 revision」，host 端校验**只有**当
 *     当前 revision 跟传的对得上才接受。**不**让 client「我不管你版本
 *     多少了直接写」——`agent-busy`（subagent 路径）/ revision-mismatch
 *     错误让 client 知道「你看到的版本已经旧了，refresh」。
 *   - **「Subagent 路径拒」**：session-backed subagent 的 Agent 拒
 *     `agent-busy`——goal 是**顶层**会话概念，subagent **不**有 goal。
 *   - **「`clear` 留 tombstone」**：清掉当前 goal 但**留** durable tombstone
 *     + history——未来 session 复活时仍能看到「曾经有过这个 goal 已被
 *     clear」的事实。
 *   - **「`edit` 不改 phase」**：objective / `maxGoalRounds` 可改，但 goal
 *     处于 pause / complete / 等状态**不**被 `edit` 翻转；翻转走 `pause`
 *     / `resume` / `complete`。
 *
 * 与其他模块的连接点：
 *   - `dsh-session-projection` 的 `goal` projection key（读路径）
 *   - `dsh-session` 的 `SessionId`
 *   - `dsh-goal` 提供 host 端 CAS 实现 / `GoalError` 错误域
 *   - `dsh-agent` / `dsh-subagent` 提供「session 是 subagent」判定
 *   - `rpc.ts` / `rpc-map.ts` 提供 wire 协议
 *   - `mux` stream 的 `session/projection` frame 广播 goal state
 */
 *
 * Mutations only: the read side is the 'goal' session projection (history
 * tail-page projections block + session/projection frames), so there is no
 * goal.get and no wire goal view — responses acknowledge with the new CAS
 * ref and never feed client state (the committed goal/change event reaches
 * every client through the mux stream carrying the same whole value).
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Identifies one goal across its durable revisions. */
export type GoalId = Branded<'GoalId'>

/** Compare-and-set identity for one exact goal revision. */
export interface GoalRef {
  readonly id: GoalId
  readonly revision: number
}

/**
 * Goal-domain unary methods. Every mutation resolves an ordinary session's
 * Agent and applies one CAS-guarded verb; session-backed subagents reject with
 * `agent-busy`.
 */
export interface GoalsApi {
  /** Create and arm a goal. */
  create(request: RpcRequest<{ sessionId: SessionId; objective: string; maxGoalRounds?: number }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Edit objective and/or round cap without changing phase. */
  edit(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef; objective?: string; maxGoalRounds?: number }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Pause an active goal and disarm automatic continuation. */
  pause(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Resume and arm a stopped goal. */
  resume(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Mark a current non-complete goal complete and disarm it. */
  complete(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Clear the current goal while retaining a durable tombstone and history. */
  clear(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ cleared: true }>>
}
