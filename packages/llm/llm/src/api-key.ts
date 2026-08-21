/**
 * @file 「一个 HTTP header 能装的 API key 形态」唯一判定，跨 adapter 共享。
 *
 * 关键约束：
 *   - **字符集 = `0x21..0x7E`**（可打印 ASCII，**不含**空格）——`fetch` 在
 *     header 里碰到越界字符直接拒，连 header 都不会构造，所以这条是「**传输层**
 *     不变量」不是「某个 provider 的策略」。Latin-1 也**不**放进来：header
 *     能载它，但**没有** provider 发它，放进来等于把「本地可解释的拒绝」换成
 *     「对面 401」。
 *   - **trim 是 silent**（带空格的 key 切掉就行），**其它**缺陷都暴露——
 *     因为「带空格」只有一种读法，其它坏键（控制字符 / Latin-1）的修法不一
 *     样，silent 就掩盖了。
 *   - **「没有 key」是配置态，本函数不查**——「没配 key」和「配了坏 key」是两件
 *     事，修法不同；absence 留给 caller（profile 层、credentials seam）判断。
 *
 * 与其他模块的连接点：
 *   - `LlmRuntime.assertUsableApiKey` 调 `normalizeApiKey` 拿到 verdict
 *   - 任何想加进来的 provider adapter 都走这条路——不在 adapter 里再写一份
 *     「能不能放 header」
 */

/**
 * Characters an HTTP header value carries verbatim and every known provider
 * key uses: printable ASCII, space excluded. A key outside this set cannot
 * reach any provider — `fetch` refuses to build the header — so this is a
 * transport invariant rather than one provider's policy. Latin-1 is excluded
 * deliberately: a header could carry it, but no provider issues it, and
 * admitting it trades a local explained refusal for an opaque 401.
 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/** Why a supplied API key cannot be used. */
export type ApiKeyRejection = 'empty' | 'illegalCharacters'

/** The verdict on one supplied API key. */
export type ApiKeyCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: ApiKeyRejection }

/**
 * Judge one *supplied* API key, trimming surrounding whitespace first.
 *
 * Trimming is silent because a padded key has one unambiguous reading; every
 * other defect is reported. Absence is a configuration state this function
 * never sees — a profile naming no credential authenticates through the
 * provider's own ambient discovery or OAuth — so callers decide whether a
 * value was supplied before asking.
 * @param raw - the key exactly as configured, stored, or typed.
 * @returns the trimmed key, or why it cannot be used.
 */
export function normalizeApiKey(raw: string): ApiKeyCheck {
  const value = raw.trim()
  if (value.length === 0) return { ok: false, reason: 'empty' }
  if (!LEGAL_API_KEY.test(value)) return { ok: false, reason: 'illegalCharacters' }
  return { ok: true, value }
}
