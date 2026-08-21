/**
 * @file 转发事件 allowlist 的「类型 face」：consumer key 投影 + 选择位。
 *
 * 按包约定，**值**在 `./remote-events.ts`，**类型**在本文件——这样 `index.ts`
 * (Host) 和 `client/index.ts` (Client) 两个编译 face 都可以各自 import 必要的
 * 一边，runtime 体积不会被对面污染。
 *
 * `ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]`
 * 拿到的是允许的 event key union；通过 `TypertRemoteEventSelection` 把它
 * 塞进 Typert 协议的总选择位，所以 `$on` 只接受这些 key。
 *
 * 与其他模块的连接点：
 *   - `dsh-typert-protocol` 提供 `TypertRemoteEventSelection` 这条合并接口
 *   - `index.ts` 用同一个数组做 `satisfies` 静态检查
 *   - `client/index.ts` 把 `ApiRemoteForwardedEvent` 转出到 consumer 编译 face
 */

import type { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

/** Type projection of the allowlist; the consumer and the Host read this one. */
export type ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true> {}
}
