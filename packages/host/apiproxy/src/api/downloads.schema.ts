/**
 * @file `downloads` domain 的 zod schema——GET 的 query-param parser。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「download 没有 wire envelope」**：请求**走 query string**
 *     （全 string），**不**经 four-quadrant envelope。所以这里的
 *     schema 是「`{ sessionId, includeDescendants? }` raw query object」
 *     → `DownloadsApi['sessionLog']` 入参 形态的 parser，**不**是
 *     `RpcRequest<...>` 形态。
 *   - **`includeDescendants` 只接 `'true' | 'false' | absent`**：URL
 *     拼错（`'TRUE'` / `'1'` / `'yes'`）→ 400，**不**让 typo 静默
 *     under-export——「我以为我导了 subagent 但其实没」是反信号。
 *   - **`.transform(...)` 把 `'true'` 翻 `true`、`'false'` / absent
 *     不带 `includeDescendants` 字段**：typed boolean 进 `DownloadsApi`。
 *     翻之后**没** `includeDescendants` 字段代表「**不**含 descendants」，
 *     `false` 是**不**该出现的（host 端按 absent 处理）。
 *   - **`sessionIdSchema` 复用** `sessions.schema.ts` 的 cast——同 DAG 约定。
 *
 * 与其他模块的连接点：
 *   - `sessions.schema.ts` 的 `sessionIdSchema`（DAG）
 *   - `downloads.ts` 的 `DownloadsApi['sessionLog']` 是输出 target
 *   - `fetch/handler.ts` 把 URL query string 喂这个 schema
 *   - `api-proxy.ts` 调 `downloads.sessionLog` 拿 `Response`
 */

import { z } from 'zod'
import type { DownloadsApi } from './downloads.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/**
 * session.export query params → the sessionLog request. `includeDescendants`
 * accepts exactly `true`/`false`/absent; any other value is rejected (400) so
 * a misspelled flag cannot silently under-export.
 */
export const sessionLogQuerySchema = z
  .object({
    sessionId: sessionIdSchema,
    includeDescendants: z.union([z.literal('true'), z.literal('false')]).optional(),
  })
  .transform(query => ({
    sessionId: query.sessionId,
    ...(query.includeDescendants === 'true' ? { includeDescendants: true } : {}),
  })) satisfies z.ZodType<Parameters<DownloadsApi['sessionLog']>[0]>
