/**
 * @file `skills` domain contract——只读 skill catalog，按 session 查。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **只有 list 一个 RPC**：invocation 走普通 `session.prompt`（leading
 *     `/name` token 在 pre-step 边界由 host 识别，`dsh-tool-skill` 在
 *     那里注入渲染好的 body）——**没有**专用的 invocation wire。每个
 *     client 共享**一条**确定性路径，**不**分裂「prompt 路径」和
 *     「skill 路径」。
 *   - **「Client 不传 raw path」**：session header 的 cwd 解析到 canonical
 *     project root 是 host 端的事。**不**让 client 提路径——避免
 *     「client 拼错 path 列出错的 skill 目录」。
 *   - **`modelInvocable: false` 标 `disable-model-invocation`**：user-only
 *     skill——composer 里可调，**不**进 model 的 skill catalog。`true`
 *     是「model 也能 invoke」（默认）。
 *
 * 与其他模块的连接点：
 *   - `dsh-session` 的 `SessionId`
 *   - `dsh-skill` 提供 host 端 catalog / `isUserInvocable`
 *   - `dsh-tool-skill` 注入 pre-step 边界的 `/name` 识别
 *   - `rpc.ts` / `rpc-map.ts` 提供 wire 协议
 */
 * The session's header cwd resolves to the canonical project root host-side —
 * the client never submits a raw path, and skill lookup never creates or
 * resumes an Agent.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  readonly modelInvocable: boolean
}

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap). Listing
 * is the domain's only RPC: invocation itself is a plain `session.prompt`
 * whose leading `/name` token the host recognizes at the pre-step boundary
 * (`dsh-tool-skill` injects the rendered body there), so every client shares
 * one deterministic path with no dedicated invocation wire.
 */
export interface SkillsApi {
  /** Lists the user-invocable skill catalog for the session's project. */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>
}
