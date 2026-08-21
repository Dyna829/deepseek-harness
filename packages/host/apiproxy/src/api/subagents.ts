/**
 * @file browser-safe 的 `subagents` domain contract。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「持久化 transcript 读 = 不激活 Agent」**：`subagent.history` 是
 *     只读拉取，**不**会顺手把 subagent Agent 拉起来——读历史是「无
 *     副作用」的纯 IO。
 *   - **「Continuable prompt 走**精确** live direct parent」**：
 *     `subagent.prompt` 通过**那一个** live direct parent 的 inbox
 *     路由给 child Agent——**不**走 `createAgent` 路径（那是新建），
 *     **不**走通用 `session.prompt` 路径（那是顶层）。这条精确路由
 *     让「continuable」语义在 wire 上守得住。
 *   - **`SubagentListEntry` 是 discriminated union**：
 *     - `kind: 'child'` 必带 `mode: 'one-shot' | 'continuable'`；前者的
 *       `label` 可缺，后者的 `label` 必填（continuable 必有可让用户重新
 *       接入的标题）；
 *     - `kind: 'diagnostic'` 是 corrupt / unsupported / unavailable 状态
 *       下的占位行——可被列但**不**可被 prompt / interrupt。
 *   - **`SubagentAddress` 是 client 端 subagent transport 的 selector**：
 *     client 看 `address` 决定「该走 subagent 路径」还是「走顶层 RPC」。
 *
 * 与其他模块的连接点：
 *   - `dsh-session` / `dsh-llm` 的 `SessionId` / `MessageId` / `ContentBlock`
 *   - `dsh-subagent` 提供 host 端 inbox / continuation 实现
 *   - `dsh-agent` 的 live parent → child Agent inbox 路由
 *   - `rpc.ts` / `rpc-map.ts` 提供 wire 协议
 *   - `sessions.ts` 的 `HistoryEntry` / `SessionProjectionsBlock` 在 history 响应里
 */
 */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { HistoryEntry, SessionProjectionsBlock } from './sessions.ts'

/** Complete durable direct-child catalog row. */
export type SubagentListEntry =
  | {
    kind: 'child'
    id: SessionId
    /** Whether the child Agent driver is running at the Host sampling boundary. */
    activity: 'running' | 'inactive'
    /** Whether a direct descendant has durable `origin: 'subagent'`. */
    hasChildren: boolean
  } & (
    | {
      mode: 'one-shot'
      label?: string
    }
    | {
      mode: 'continuable'
      label: string
    }
  )
  | {
    kind: 'diagnostic'
    id: SessionId
    reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/** Inbox identity returned once the continuation accepts one human message. */
export interface SubagentPromptReceipt {
  messageId: MessageId
}

/** Uniform acknowledgement that one interrupt request was admitted. */
export interface SubagentInterruptReceipt {
  accepted: true
}

/** Durable parent/child address that selects subagent transport in the client. */
export type SubagentAddress =
  & {
    parentSessionId: SessionId
    childSessionId: SessionId
  }
  & (
    | { mode: 'one-shot' }
    | { mode: 'continuable' }
  )

/** Complete direct-child catalog plus the delivery-time parent availability hint. */
export interface SubagentCatalog {
  entries: SubagentListEntry[]
  parentAvailable: boolean
}

/** Subagent-domain unary methods. */
export interface SubagentsApi {
  /**
   * Lists direct session-backed children without loading either side. Parent
   * availability is a hint; continuable prompt performs the authoritative
   * check.
   */
  list(
    request: RpcRequest<{ parentSessionId: SessionId }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<SubagentCatalog>>

  /**
   * Reads one healthy catalog child's transcript — the in-memory snapshot of
   * a live child, the persisted log of a cold one — with ordinary
   * message-aligned pagination and render intents, without Agent activation.
   */
  history(
    request: RpcRequest<SubagentAddress & { beforeSeq?: number; maxMessages?: number }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{
    events: HistoryEntry[]
    hasMore: boolean
    projections?: SessionProjectionsBlock
  }>>

  /**
   * Delivers human content to a continuable child through the exact live
   * parent's continuation owner. Success identifies the message accepted by
   * the child's FIFO inbox; later execution is independent of this request.
   * Optional browser-zone provenance is validated and logged on that message.
   */
  prompt(
    request: RpcRequest<
      Extract<SubagentAddress, { mode: 'continuable' }> & {
        content: ContentBlock[]
        /** Optional browser zone sampled for this exact human prompt. */
        clientTimeZone?: string
      }
    >,
    signal: AbortSignal,
  ): Promise<RpcResponse<SubagentPromptReceipt>>

  /**
   * Interrupts a live continuable child's current turn under the address's
   * durable direct-parent authority, without requiring a live parent Agent,
   * consulting the catalog, or resuming anything. Fire-and-return: `accepted`
   * acknowledges the admitted cancel signal, not target quiescence, so the
   * child may remain visibly running briefly. Unclaimed queued follow-ups are
   * kept and parked; an absent, idle, or already-completed target is likewise
   * `accepted`.
   */
  interrupt(
    request: RpcRequest<Extract<SubagentAddress, { mode: 'continuable' }>>,
  ): Promise<RpcResponse<SubagentInterruptReceipt>>
}
