/**
 * @file Host 端 Remote 集成的 BFF（back-end for front-end）入口。
 *
 * 概念分两层：
 *   - **Host 侧**（本包 `index.ts` / `agent-lookup.ts` / `remote-events.ts`）：
 *     解析「请求里的 sessionId → 这个进程里活的 Agent / 已 attach 的 Session
 *     / 需要冷启动的会话」三种身份，把 legacy API Proxy 和新的 Typert Remote
 *     调用都收敛到同一条 `agentFor(sessionId)` 路径。
 *   - **Client 侧**（`client/`）：把 Host 暴露的 Remote 描述符按 namespace 装
 *     到 `ctx.remote.<ns>`，让 consumer 写 `ctx.remote.commands.change(...)`。
 *
 * 关键不变量（**不**写代码就破的那种）：
 *   - `API_REMOTE_FORWARDED_EVENTS` 这条**单一** allowlist：Host 转发哪些事件
 *     给 consumer、consumer 可以 `$on` 哪些 key，都靠这一个数组。`./types.ts`
 *     从它派生出 `ApiRemoteForwardedEvent`，`./index.ts` 末尾的 `satisfies
 *     TypertForwardableEvent[]` 把它钉在三层静态检查上：必须是 `Events` 里
 *     声明过的 key、不能 bind Scope（`ThisParameterType` 必须 `unknown`）、
 *     必须是 one-way（不能是 waterfall / bail 形状）。
 *   - **subagent-owned session 走专门 routing**：`hasApiRemoteSubagentOwner`
 *     用「`origin === 'subagent'` 或 `parentSession` 存在且 agent 由 parent
 *     own」判定，命中后返回 `agent-busy` 而不是冷 resume——这条栅栏守的是
 *     「不让 legacy API 把子 agent 的 session 当顶层 session 拽走」。
 *
 * 与其他模块的连接点：
 *   - `dsh-agent` / `dsh-session` / `dsh-session-persistence` / `dsh-typert-registry`：
 *     身份解析的全部输入
 *   - `dsh-api-gateway`：消费同包 `index.ts` 的 `createApiRemoteAgentResolver`
 *     配 Typert lookup
 *   - `dsh-client-connection`：Client 侧载体的 RPC/事件流
 */

import type { TypertForwardableEvent } from '@deepseek-ai/dsh-typert-protocol'
import { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

// The owner packages' client-safe `./types` exports carry the cordis `Events`
// declarations for every allowlisted event. Pulling them into this face is what
// makes the shape assertion below judge real signatures rather than an empty
// event vocabulary.
import type {} from '@deepseek-ai/dsh-commands/types'
import type {} from '@deepseek-ai/dsh-cordis-host-runner/types'
import type {} from '@deepseek-ai/dsh-credentials/types'
import type {} from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type {} from '@deepseek-ai/dsh-settings/types'

export {
  ApiRemoteSessionNotFound,
  ApiRemoteSubagentSessionOwnership,
  apiRemoteSubagentOwnershipError,
  createApiRemoteAgentResolver,
  hasApiRemoteSubagentOwner,
  inspectApiRemoteSession,
} from './agent-lookup.ts'
export type {
  ApiRemoteAgentOptions,
  ApiRemoteAgentResult,
  ApiRemoteLookupError,
} from './agent-lookup.ts'
export { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'
export type { ApiRemoteForwardedEvent } from './types.ts'

// Shape gate over the allowlist, kept in the Host face because the Host's event
// vocabulary is the authoritative one. It pins three things at compile time:
// every entry NAMES a declared event (the predicate is keyed on `keyof
// Events`), no entry BINDS a Scope (a scoped event's `ThisParameterType` is not
// `unknown`, which is how "must not depend on AgentScope" is stated statically),
// and every entry is ONE-WAY (a waterfall or bail shape returns something other
// than void and is excluded). Widening the array to an event that fails any of
// these fails here, not on the wire.
API_REMOTE_FORWARDED_EVENTS satisfies readonly TypertForwardableEvent[]

/** Host plugin body; the selected contributions mount only in Client environments. */
export function apply(): void {}
