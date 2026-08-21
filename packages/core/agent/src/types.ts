/**
 * @file Agent 持久化事件的类型扩展。
 *
 * 核心动作：往 `dsh-session` 的 `SessionEventMap` 上挂一个新的事件类型
 * `agent/inbox/spliced`，让别处用 `SessionEvent<'agent/inbox/spliced'>` 这种类型
 * 能直接查到形状。
 *
 * 配合 `inbox.ts`：所有 inbox 改动都会先 append 这个事件，再改内存投影，
 * 所以「session log = inbox 历史的真相之源」。
 */

/**
 * Durable agent session-event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-agent/types
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm/types'

/** One of the two ordered pending-message lists owned by an agent. */
export type InboxTarget = 'next-turn' | 'next-step'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One normalized mutation of an agent's durable pending-message lists.
     * Live dispatch precedes projection mutation, so synchronous observers may
     * read the pre-splice inbox to recover the removed messages.
     */
    'agent/inbox/spliced': {
      target: InboxTarget
      start: number
      removedCount?: number
      inserted: UserMessage[]
      outcome?: 'canceled'
    }
  }
}
