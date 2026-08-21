/**
 * @file 本应用「Host 转发给 consumer 的事件」单一 allowlist 的 home。
 *
 * 设计原因（而不是把它散到 `index.ts` / `client/index.ts` 两份）：
 *   - Host 转发循环和 Client `ctx.remote.$on` 的 key 集合**必须**同一份
 *     真相，否则一个发一个不收，事件静默丢失。
 *   - 编译期检查在 `index.ts` 末尾的 `API_REMOTE_FORWARDED_EVENTS satisfies
 *     readonly TypertForwardableEvent[]` 一行里完成，钉三件事：
 *     (a) 名字必须已在 `Events` 里声明；
 *     (b) 不能 bind Scope（`ThisParameterType` 必须 `unknown`）；
 *     (c) 必须是 one-way（waterfall / bail 形状被排除）。
 *     数组多加一个名字，编译失败而不是 wire 上漏转发。
 *
 * 加新事件：改这一个数组（+ 必要的 `Events` 声明），其它不用动。
 *
 * 与其他模块的连接点：
 *   - `./types.ts` 从这个数组派生 `ApiRemoteForwardedEvent` 类型
 *   - `client/index.ts` 在 Client 编译 face 里 import 这个数组（作为
 *     `TypertRemoteEvent` 选择位的来源）
 */

/**
 * Host events this application forwards to consumers verbatim: no projection,
 * no redaction, no renaming. The wire name is the Host cordis event name and
 * the payload is its argument list, so this array is simultaneously the whole
 * control point over what a consumer can receive and the legal key set of
 * `ctx.remote.$on`. Forwarding one more event is an entry here and nothing
 * else.
 */
export const API_REMOTE_FORWARDED_EVENTS = [
  'agent-preset/selected',
  'commands/change',
  'credentials/updated',
  'cordis/request-run',
  'cordis/request-run-resolved',
  'cordis/dynamic-package',
  'cordis/dynamic-retract',
  'cordis/inspect-query',
  'cordis/inspect-query-resolved',
  'llm/adapters-updated',
  'settings/document-updated',
] as const
