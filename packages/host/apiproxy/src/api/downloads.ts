/**
 * @file `downloads` domain contract——**host-only** 的下载面（GET），是
 * SSE-stream `events` domain 的镜像。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「没有 wire envelope」**：跟其它 `api/*`（都走 four-quadrant
 *     RPC envelope）**不**同——`downloads` 直接由 carrier 的 GET 路由答，
 *     **不**经 `clientRequestSchema` / `serverRequestSchema`。`IApiClient`
 *     **不**暴露它，client 端**不**能调。
 *   - **「mirror of events」**：上行 push 走 SSE stream (`events`)；
 *     下行下载走 HTTP GET (`downloads`)。两条 channel family 是对称的。
 *   - **「missing services → 500 / missing root → 404」**：
 *     `session.persistence` / `sessionExport` 之类 service 缺 → 500；
 *     root session id 在 persistence 找不到 → 404。两个状态码**先**
 *     于任何 byte 返回，**不**让 client 拿到「partial zip」还得自己
 *     识别 fail。
 *   - **「includeDescendants」**：root artifact + 每个 subagent 后代
 *     的 artifact 一起 zip。**不**含 root 之外的 sibling（**不**是
 *     「整个 workspace」）。
 *   - **`signal` cancellation 直接传到「底层 reads」**：abort 让
 *     stream 立即停，**不**等当前 chunk 写完。
 *
 * 与其他模块的连接点：
 *   - `dsh-session` 的 `SessionId`
 *   - `dsh-session-persistence` 提供 root / descendant artifact
 *   - `session-export.ts` 提供 zip 压缩 + streaming
 *   - `events.ts` 是镜像 push 通道
 *   - 任何 carrier 想加「下载 zip」 GET 路由都走本 interface
 *   - `api-proxy.ts` host 端实现
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Host-only download surfaces (no wire envelope; absent from IApiClient). */
export interface DownloadsApi {
  /**
   * Stream one session-log ZIP — the root artifact verbatim plus each subagent
   * descendant's — as an attachment response. The carrier's GET route answers
   * this directly; the browser never calls it.
   * @param request - the root session id and whether to include descendants.
   * @param signal - cancellation for the underlying reads.
   * @returns the ZIP attachment response; missing services answer 500 and a
   * missing root session 404 before any byte is produced.
   */
  sessionLog(
    request: { sessionId: SessionId; includeDescendants?: boolean },
    signal: AbortSignal,
  ): Promise<Response>
}
