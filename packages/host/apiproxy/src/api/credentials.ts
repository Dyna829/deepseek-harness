/**
 * @file `credentials` domain contract——`ctx.credentials` 的 web 出口。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「读 = 结构上没值」**：`CredentialView` 永远**只**带 `configured` /
 *     `source` / `writable`——**没有** value slot。credential value 跨
 *     wire **只**走一条路径：`credentials.set` 的入参。**任何** read
 *     RPC 拿不到值，这是**结构**保证不是「约定」。
 *   - **「没有 enumeration method by design」**：`credentials.*` 里
 *     **没有**「列出所有 ref」的 RPC。client 端从 settings schema 和
 *     values（`apiKeyEnv` 之类字段）**间接**知道哪些 ref 存在——
 *     避免「client 端能枚举所有 host 上配过的 secret name」（即使不
 *     拿值也是 reconnaissance 级的泄露）。
 *   - **「write-only direction」**：`credentials.set` 的 `value` 是**唯
 *     一**跨 wire 走 secret 值的方向；`set` / `unset` 在**只读层**
 *     （live environment 阴影）shadow 时被拒——否则 write 看起来成功，
 *     但 resolution 仍返 shadowing 值（**写成功但读不出自己写的**），
 *     是个反信号。
 *   - **`unset` 对 absent ref 是 idempotent**：删一个本来就没的 ref
 *     **静默成功**，**不**报错（避免 client 端需要 try/probe 才知道
 *     「到底存不存在」）。
 *   - **`describe` 批量 + unknown-but-valid**：`describe` 一次拉一批
 *     ref；「不存在但格式合法」的 ref 描述成 `unconfigured`（**不**
 *     报错）——client 端不必**先** probe 存在再 describe。
 *
 * 与其他模块的连接点：
 *   - `dsh-credentials` 提供 host 端 seam + `credentialRef` 解析
 *   - `dsh-settings` 提供 secret 字段在 settings schema 里的 role 声明
 *   - `dsh-llm` 的 `assertUsableApiKey` 在 host 端解析后兜底验 value
 *   - `rpc.ts` / `rpc-map.ts` 提供 wire 协议
 *   - `api-proxy.ts` 翻译（`api/remotes` 的 `createApiRemoteAgentResolver`
 *     也是同一份 credentials seam 的用户）
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire view of one credential reference's state. */
export interface CredentialView {
  /** Whether any layer currently supplies a non-empty value. */
  configured: boolean
  /** Winning layer when configured (`env`, `file`, …); provider vocabulary. */
  source?: string
  /** Whether `credentials.set`/`credentials.unset` can affect this reference. */
  writable: boolean
}

/** Credentials-domain unary methods (the map keys credentials.* of RpcMethodMap). */
export interface CredentialsApi {
  /**
   * Describe the named references (batch): configured state, winning source,
   * and writability — never values. An invalid reference name is a
   * `bad-request`; an unknown-but-valid one describes as unconfigured.
   */
  describe(request: RpcRequest<{ refs: string[] }>): Promise<RpcResponse<{ credentials: Record<string, CredentialView> }>>

  /**
   * Store one credential value in the writable layer. Rejected with
   * `credential-rejected` while a read-only layer (the live environment)
   * shadows the reference — the write would otherwise appear to succeed while
   * resolution keeps returning the shadowing value.
   */
  set(request: RpcRequest<{ ref: string; value: string }>): Promise<RpcResponse<{}>>

  /**
   * Remove one credential from the writable layer; same shadowing rejection
   * as `set`. Unsetting an absent reference succeeds (idempotent).
   */
  unset(request: RpcRequest<{ ref: string }>): Promise<RpcResponse<{}>>
}
