/**
 * @file 跨 adapter 集中的「app attribution 头」：每个 provider request 都带的
 * `User-Agent`，防止不同 adapter 各写一份导致漂移。
 *
 * 安全约束（写在 `AppIdentity` 的 JSDoc 上，**不**是 comment 说说而已）：
 *   - 字段都是**公开产品事实**——product 名 / version / repo URL；
 *   - **不能**放 secrets、本地路径、session id、prompt 文本、per-user 标识；
 *   - **不能**被 per-request 参数影响——同一个 product 同一份 version，**任何**
 *     请求都带一样的头。这条保证让 provider 端做 abuse / 配额策略时不会被
 *     「每个请求伪造一个 user-agent」绕开。
 *
 * 集中之后还有一个好处：第三方（白标 / fork）想换 identity，调
 * `attributionHeaders(myIdentity)` 传一个 `AppIdentity` 进去；**不能**通过
 * 省略参数把它关掉——默认 fallback 就是 `APP_IDENTITY`，没有「完全无 attribution」
 * 这条路。
 *
 * 与其他模块的连接点：
 *   - `llm-deepseek` / `llm-pi-ai` 的 adapter 在 outgoing request 上 merge
 *     `attributionHeaders()`
 *   - 任何加进来的新 provider adapter 都必须遵守这条（adapters 文档里写了
 *     「prove the headers are added」）
 */

import { createRequire } from 'node:module'

// The package's own manifest is the single source of the version so the
// User-Agent cannot drift from what is published (`./package.json` is an
// export of this package; the relative path resolves from both `src/` and
// the bundled `lib/`).
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

/**
 * Static public application identity sent to LLM providers.
 *
 * Every field is a public product fact, safe on every request: no secrets,
 * local paths, session ids, prompt text, or per-user identifiers belong here,
 * and nothing per-request may influence the values.
 */
export interface AppIdentity {
  /** `User-Agent` product token (lowercase, hyphenated). */
  product: string
  /** Product version; sourced from package metadata, never hand-copied. */
  version: string
  /** Repository home URL of the app, used as the `User-Agent` comment. */
  url: string
}

/**
 * The harness's own identity: the default every adapter sends. Deployments
 * that need a white-label identity pass their own {@link AppIdentity} to
 * {@link attributionHeaders} — omission falls back to this default; nothing
 * can suppress attribution entirely.
 */
export const APP_IDENTITY: AppIdentity = {
  product: 'deepseek-harness',
  version,
  url: 'https://github.com/deepseek-ai/deepseek-harness',
}

/**
 * The standard `User-Agent` value: `product/version (+url)`. The
 * parenthesized `+url` comment is the conventional self-identification form
 * (RFC 9110 §10.1.5 product + comment syntax).
 * @param identity - the identity to render; defaults to {@link APP_IDENTITY}.
 * @returns the ready-to-send header value.
 */
export function userAgent(identity: AppIdentity = APP_IDENTITY): string {
  return `${identity.product}/${identity.version} (+${identity.url})`
}

/**
 * Build the attribution headers an adapter must send on every provider
 * request. Header names are lowercase (HTTP field names are case-insensitive
 * on the wire).
 * @param identity - the identity to send; defaults to {@link APP_IDENTITY} — omission cannot suppress attribution.
 * @returns headers to merge into the provider request (currently just `user-agent`).
 */
export function attributionHeaders(
  identity: AppIdentity = APP_IDENTITY,
): Record<string, string> {
  return { 'user-agent': userAgent(identity) }
}
