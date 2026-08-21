/**
 * @file session search 的固定 product 上界 + Unicode-safe 截断帮手。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **`SESSION_SEARCH_RESULT_LIMIT = 20` 是「一次 sidebar 搜索
 *     返多少条 session」**的硬上界——**不**让 client 「我搜个 'a'」
 *     把整个 session store 拉回来。`SESSION_SEARCH_PROVIDER_CALL_LIMIT` /
 *     `COLD_SUMMARY_BATCH_SIZE` 这类**更多**上界住在 `api-proxy.ts`。
 *   - **`SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240`**：snippet 长度
 *     限的是 **Unicode code points**——**不**是 UTF-16 code units
 *     （emoji / surrogate pair **不**会被「切一半」成乱码）。
 *   - **`truncateUnicodeCodePoints` 用 `for (const codePoint of value)`**：
 *     JS string iterator 走**完整** code point，**不**走 surrogate
 *     half。`end += codePoint.length`（1 或 2）算出 byte offset 切片
 *     ——结果字符串永远 valid UTF-16。
 *   - **`value` 整段本文件都是常量 + 一个纯函数**：被 `api-proxy.ts`
 *     的 `session.search` 和 `sessions.schema.ts` 的 search schema 共
 *     用；**不**在本文件导出 RPC 形态（domain contract 在 `sessions.ts`）。
 *
 * 与其他模块的连接点：
 *   - `sessions.schema.ts` 的 `sessionSearchRequestSchema` 用
 *     `SESSION_SEARCH_RESULT_LIMIT` / `SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS`
 *   - `api-proxy.ts` 的 `search` 用 `truncateUnicodeCodePoints` 截 snippet
 *   - `dsh-session-query` 提供底层 search provider
 */
export const SESSION_SEARCH_RESULT_LIMIT = 20

/** Maximum snippet length in Unicode code points. */
export const SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240

/**
 * Return the longest prefix containing at most `maximum` Unicode code points.
 * @param value - text to bound.
 * @param maximum - non-negative code-point limit.
 * @returns `value` unchanged when it fits, otherwise a code-point-safe prefix.
 */
export function truncateUnicodeCodePoints(value: string, maximum: number): string {
  let count = 0
  let end = 0
  for (const codePoint of value) {
    if (count === maximum) return value.slice(0, end)
    count++
    end += codePoint.length
  }
  return value
}
