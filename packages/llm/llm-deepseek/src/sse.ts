/**
 * @file SSE 字节流 → event `data` 字符串 payload。
 *
 * 框架层（chunk 重组、UTF-8 / CRLF / BOM 处理、comment 跳过、多 `data:` 拼接）
 * 全交给 `eventsource-parser`——本文件**只**守 DeepSeek 协议的那一点点：
 *   - **literal `[DONE]` 当 sentinel 让 caller 拥有最后 flush 时机**——
 *     `translate` 看到 `[DONE]` 才 emit `block-end` / `usage` / `finish`。
 *   - **EOF 之前没收到 `[DONE]` 抛 `STREAM_CLOSED`**：truncated response
 *     不可信，**不**伪装成「正常结束」。下游 retry policy 看到
 *     `STREAM_CLOSED` 会选择重试。
 *   - **comment 不进 payload 流**：SSE 注释是「keep-alive」之类的运营商
 *     信号，通过 `onComment` 回调上抛给 idle watchdog 当作「transport
 *     活跃」证据——但**不**污染逻辑 payload。
 *
 * 关键不变量（来自 SSE 规范本身）：
 *   - event **只在 blank-line terminator 处** dispatch——未终止的尾巴
 *     算「截断」，**不**算「可 flush 的 payload」。
 *   - read 可以从**任意**字节边界切（包括 UTF-8 多字节序列中间），
 *     `TextDecoderStream` 负责把它拼回去。
 *
 * 与其他模块的连接点：
 *   - `adapter.ts` 把 `fetch().body`（= `ReadableStream<Uint8Array>`）
 *     喂给本文件
 *   - `translate.ts` 消费 `data` payload + 在收到 `[DONE]` 时收尾
 *   - `onComment` 回调被接到 `idleWatchdog.pulse()`，让「provider 还在」
 *     信号不止来自 data 帧
 */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import { LlmError } from '@deepseek-ai/dsh-llm'

/** The terminal payload DeepSeek (and OpenAI) send after the last chunk. */
export const DONE = '[DONE]'

/**
 * Parse an SSE byte stream into data payloads. Yields `[DONE]` as the final
 * value and returns; throws `LlmError('STREAM_CLOSED')` when the stream ends
 * without it (truncated response — the model call cannot be trusted).
 * @param stream - raw SSE bytes; reads may split anywhere, including mid-UTF-8 sequence.
 * @param onComment - optional transport-activity callback; comments never enter the yielded payload stream.
 * @returns each event's data payload in arrival order, the `[DONE]` sentinel last.
 */
export async function* parseSse(
  stream: ReadableStream<BufferSource>,
  onComment?: (comment: string) => void,
): AsyncGenerator<string> {
  const events = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ onComment }))
  for await (const { data } of events) {
    yield data
    if (data === DONE) return
  }
  throw new LlmError('SSE stream ended without [DONE]', 'STREAM_CLOSED')
}
