/**
 * @file 自动生成：把「scope 过滤事件」从 dispatch 参数里抽出「主体」用的解析器表。
 *
 * **不要手改**！改完跑 `pnpm run gen-scoped-events` 重新生成。
 *
 * 比如 `agent/created` 事件，主体是参数 args[0]（payload）里的 `agent` 字段；
 * 这个表告诉 invariant runner 怎么从 dispatch args 里把那个主体抽出来。
 */

/**
 * Generated scoped-event routing-subject resolvers for dsh-scope invariants.
 * Do not edit by hand; run `pnpm run gen-scoped-events`.
 *
 * @module @deepseek-ai/dsh-scope/scoped-events.generated
 */

type ScopedSubjectResolver = (args: readonly unknown[]) => unknown

const scopedSubjectResolvers: Readonly<Record<string, ScopedSubjectResolver | null>> = Object.freeze({
  'agent/created': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/disposed': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/error': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/inbox/claimed': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/inbox/discarded': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/inbox/inserted': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/pre-step': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/request': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/request-error': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/session-start': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/status': args => (args[0] as Record<string, unknown>)['agent'],
  'agent/turn-stopping': args => (args[0] as Record<string, unknown>)['agent'],
  'approval/request': args => (args[0] as Record<string, unknown>)['agent'],
  'goal/changed': args => (args[0] as Record<string, unknown>)['agent'],
  'session/created': null,
  'session/disposed': null,
  'session/event': null,
  'session/flush': null,
  'subagent/end': null,
  'subagent/start': null,
  'system-prompt/assemble': args => (args[1] as Record<string, unknown>)['scope'],
  'tools/code-dispatch-log': args => (args[0] as Record<string, unknown>)['agent'],
  'tools/execute': args => (args[0] as Record<string, unknown>)['agent'],
  'tools/post-execute': args => (args[0] as Record<string, unknown>)['agent'],
  'tools/pre-execute': args => (args[0] as Record<string, unknown>)['agent'],
  'tools/result': args => (args[0] as Record<string, unknown>)['agent'],
})

/**
 * Resolve the routing key named by one scoped event payload. A null
 * resolver means the payload cannot expose its external routing key, so the
 * invariant checks carrier presence only.
 * @param event - runtime Cordis event name.
 * @returns the generated subject resolver, null for presence-only,
 *   or undefined when the event is not scope-filtered.
 */
export function scopedSubjectResolverFor(event: string): ScopedSubjectResolver | null | undefined {
  return scopedSubjectResolvers[event]
}
