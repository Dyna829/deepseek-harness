/**
 * @file `workspace` domain contract——host 端 `dsh-workspace` 实体的 wire
 * 投影。
 *
 * 关键设计点（**写代码容易绕过的**）：
 *   - **`WorkspaceId` brand 在本文件**重新声明，**不**从 `dsh-workspace`
 *     导入：`api/` 必须保持「browser-importable + 零 host-package 依赖」；
 *     brand 字符串一致所以两侧**结构上**同意（运行时无校验，brand 是
 *     nominal typing 工具）。
 *   - **`create` 不 mkdir**：传一个**已存在**目录的 path（`workspace-invalid-path`
 *     失败如果缺 / 不是目录）。同 path 已被另一 workspace 拥有 → 返
 *     那个 workspace + `created: false`（**幂等**）。允许 basename 同名
 *     但 canonical path 不同——basename 默认 title 在 registry 里。
 *   - **`rename` 改 current title = no-op success，不写 durable**：
 *     避免「rename A → A」产生一条无意义的 updatedAt 戳。
 *   - **`delete` 只删 registration，**不**删目录 / 文件 / session log**：
 *     Sessions 变成「ungrouped」但**完整**保留——archive 不会让用户掉数据。
 *   - **`sessionIds` 是「manual 顺序」**：attach prepend、`insertSessionBefore`
 *     reorder；**activity 不 reorder**——「最近 active」**不**是 `sessionIds`
 *     顺序的依据，UI 想加「recent」自己另算。
 *   - **`archiveSession` 是 idempotent**：archived 列表里已有该 id → 静
 *     默成功；`session-not-found` 只在「既不 live 又不在 persistence」时
 *     报。Archive session 仍占 `sessionIds` 槽位（unarchive 时原位还
 *     回去）。
 *   - **`list` 返 `archivedSessionIds`**：让 client 不用为 reconnect 单
 *     发一个 `host/archived-sessions-changed` 拉取——`workspace.list`
 *     是权威的 registry 全量视图。
 *
 * 与其他模块的连接点：
 *   - `dsh-session` 的 `SessionId` brand
 *   - `dsh-brand` 的 `Branded<B>` 原始类型
 *   - `rpc.ts` / `rpc-map.ts` 提供 wire 协议
 *   - `dsh-workspace` 提供 host 端实现（`workspaceDomainState` / `workspaceRecord`）
 *   - `api-proxy.ts` 把 wire 调用翻译给 host 服务
 *   - `events.ts` 的 `host/archived-sessions-changed` 帧由本 domain 触发
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Wire-side workspace id brand. Deliberately re-declared here rather than
 * imported from dsh-workspace: api/ must stay browser-importable with zero
 * host-package dependencies, and the brand string matches, so both sides
 * agree structurally.
 */
export type WorkspaceId = Branded<'WorkspaceId'>

/** One workspace row: the record projection every workspace.* value carries. */
export interface WorkspaceView {
  workspaceId: WorkspaceId
  /** Canonical directory path (host-side realpath canon). */
  path: string
  /** Display title (defaults to the path basename at create). */
  title: string
  /**
   * Sessions accounted under this workspace, in manually owned order
   * (attach prepends, insertSessionBefore reorders; activity never does).
   */
  sessionIds: SessionId[]
  /** ISO-8601 creation instant. */
  createdAt: string
  /** ISO-8601 last-mutation instant. */
  updatedAt: string
}

/** Workspace-domain unary methods (the map keys workspace.* of RpcMethodMap). */
export interface WorkspaceApi {
  /**
   * Lists all workspaces in the registry's durable display order, plus the
   * registry-global archive set (the reconnect baseline of
   * `host/archived-sessions-changed`). Archived sessions stay in their
   * workspace's `sessionIds` account; grouping surfaces hide them.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ items: WorkspaceView[]; archivedSessionIds: SessionId[] }>>

  /**
   * Creates (or idempotently resolves) a workspace over an EXISTING directory
   * (no mkdir — a missing or non-directory path fails with
   * `workspace-invalid-path`). A path resolving to a directory already owned
   * by a workspace returns that workspace (`created: false`). Adoption allows
   * distinct canonical paths whose basenames produce the same display title;
   * the registry's basename title default names the new workspace.
   */
  create(request: RpcRequest<{ path: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView; created: boolean }>>

  /**
   * Renames a workspace. `title` is trimmed and must be non-empty
   * (schema-enforced). An unknown id fails with `workspace-not-found`; a
   * title equal to another workspace's fails with `workspace-name-conflict`.
   * Renaming to the current title is a no-op success (no durable write).
   */
  rename(request: RpcRequest<{ workspaceId: WorkspaceId; title: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Removes one Workspace registration. The directory, every user file, and
   * every session log remain untouched; those Sessions consequently become
   * ungrouped. An unknown id fails with `workspace-not-found`.
   */
  delete(request: RpcRequest<{ workspaceId: WorkspaceId }>):
  Promise<RpcResponse<{ deleted: true }>>

  /**
   * Moves one Workspace within the registry display order,
   * DOM-insertBefore-like. An omitted anchor appends to the end.
   */
  insertBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    beforeWorkspaceId?: WorkspaceId
  }>): Promise<RpcResponse<{ workspaceIds: WorkspaceId[] }>>

  /**
   * Moves an accounted session within its workspace's manual order,
   * DOM-insertBefore-like: with `beforeSessionId` the session is inserted
   * before that anchor; omitted appends to the end. An unknown workspace
   * fails with `workspace-not-found`; a session or anchor not accounted by
   * the workspace fails with `workspace-move-invalid`. A move to the current
   * position is a no-op success.
   */
  insertSessionBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    sessionId: SessionId
    beforeSessionId?: SessionId
  }>): Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Adds one session to the registry-global archive set: the session
   * disappears from every grouping surface but keeps its session log and its
   * workspace accounting slot (a future unarchive restores its position).
   * Idempotent for an already archived id. A session neither live nor in
   * session persistence fails with `session-not-found`. Returns the full
   * updated set (same snapshot the changed frame carries).
   */
  archiveSession(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>>
}
