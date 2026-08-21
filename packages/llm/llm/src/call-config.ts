/**
 * @file LLM 调用配置（`LlmCallConfig`）+ 不可变深冻 + 「loop 发的 request」标识。
 *
 * 关键概念：
 *   - **`LlmCallConfig` 是「epoch-level」**：provider / model / reasoning /
 *     sampling 这些**会影响 prompt cache 命中**的值。loop 不让 caller 每个
 *     call 改它们——只在「配置真变了」时记一个新 snapshot 进 session log。
 *     这就是「请求 waterfall 整体替换 / 改了才记」的设计。
 *   - **`AGENT_LOOP_REQUESTS`（WeakSet）**：`markAgentLoopRequest` 给「loop 组装
 *     出来的 `GenerateOptions`」打标，下游 `llm/stream` listener 一看就知道
 *     「这个 request 是 process-local loop 发的，结构是 session log 的纯函数，
 *     不要想着 mutate 它」。手搓 caller 不带这个标。
 *   - **`deepFreeze` 跳过 `AbortSignal`**：signal 是「live cancellation 通道」，
 *     冻住它 abort 链路就坏了。其它一切（包括消息 content / metadata）
 *     **全部**冻——loop / replay / 跨 adapter 转交都靠这个 frozen 不变量。
 *
 * 与其他模块的连接点：
 *   - `LlmRuntime` 在 `prepareCall` / `stream` 路径上 deep-freeze + 比较
 *   - agent-loop 每次组装 request 时 `markAgentLoopRequest` + deep-freeze
 *   - `llm/stream` waterfall 的 listener 通过 `isAgentLoopRequest` 决定读
 *     还是改它
 */

import type { GenerateOptions } from './types.ts'
import type { ReasoningEffortId } from './brand.ts'

/** Process-local identities of request objects assembled by dsh-agent-loop. */
const AGENT_LOOP_REQUESTS = new WeakSet<GenerateOptions>()

// TODO(call-config-shape): Revisit which fields are epoch-level for cache reuse
// and where provider-specific request options belong.
/**
 * Provider, model, reasoning effort, and sampling scalars of one conversation's
 * requests. Every field maps 1:1 onto the same-named `GenerateOptions` field;
 * the loop builds requests from the logged header rather than accepting these
 * per call.
 */
export interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  temperature?: number
  maxTokens?: number
  stop?: string[]
}

/**
 * Effective config fields supplied by exact-model adapter resolution rather
 * than by the caller's request proposal.
 */
export interface LlmCallConfigAdapterDefaults {
  reasoningEffort?: true
  maxTokens?: true
}

/**
 * Field-wise equality over {@link LlmCallConfig} — the comparison a caller
 * runs to decide whether a proposed configuration is a real change (worth a
 * logged header snapshot) or the held one restated.
 * @param a - one configuration.
 * @param b - the other.
 * @returns whether every field (including the `stop` list, element-wise) matches.
 */
export function callConfigEquals(a: LlmCallConfig, b: LlmCallConfig): boolean {
  if (
    a.provider !== b.provider
    || a.model !== b.model
    || a.reasoningEffort !== b.reasoningEffort
    || a.temperature !== b.temperature
    || a.maxTokens !== b.maxTokens
  ) return false
  if (a.stop === undefined || b.stop === undefined) return a.stop === b.stop
  return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i])
}

/**
 * Mark one exact request object as assembled by dsh-agent-loop.
 * @param request - loop-owned request envelope before LLM dispatch.
 * @returns the same request object marked as created by the process-local agent loop.
 */
export function markAgentLoopRequest<T extends GenerateOptions>(request: T): T {
  AGENT_LOOP_REQUESTS.add(request)
  return request
}

/**
 * Test whether the exact request object was assembled by dsh-agent-loop.
 * @param request - request envelope observed at the LLM waterfall.
 * @returns whether {@link markAgentLoopRequest} recorded this object.
 */
export function isAgentLoopRequest(request: GenerateOptions): boolean {
  return AGENT_LOOP_REQUESTS.has(request)
}

/**
 * Deep-freeze a value in place with an iterative traversal, guarding cycles,
 * so later mutation throws without imposing a JavaScript call-stack depth cap.
 * {@link AbortSignal} objects are deliberately skipped because they are the
 * request's live cancellation channel and freezing them breaks abort.
 * @param value - the value to freeze in place.
 * @returns the same value, frozen.
 */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>()
  const pending: (
    | { kind: 'visit'; node: unknown }
    | { kind: 'property'; source: Record<string, unknown>; key: string }
  )[] = [{ kind: 'visit', node: value }]
  while (pending.length > 0) {
    const task = pending.pop()
    /* v8 ignore next -- the loop condition guarantees one pending task. */
    if (task === undefined) continue
    if (task.kind === 'property') {
      pending.push({ kind: 'visit', node: task.source[task.key] })
      continue
    }
    const node = task.node
    if (node === null || typeof node !== 'object') continue
    if (node instanceof AbortSignal) continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    const keys = Object.keys(node)
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]
      /* v8 ignore next -- the loop is bounded by the captured key count. */
      if (key === undefined) continue
      pending.push({ kind: 'property', source: node as Record<string, unknown>, key })
    }
  }
  return value
}
