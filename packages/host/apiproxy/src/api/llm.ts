/**
 * @file `llm` domain contract——**只**给 configuration surface 用的
 * host-scoped provider topology。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「`llm.providers` = directory + live registry 合并」**：哪些
 *     provider **可**被 settings 配置（来自 `LlmRuntime.registerConfigurableProviders`）+
 *     哪些 **当前**真在 serve（来自 `registerAdapter`）。两个集合**不**
 *     完全重合：未 catalogued 但 hand-declared 的 route 没 settings
 *     address，catalogued 但未 activate 的有。
 *   - **`llm.models` 是 session-independent**：跟 `session.models` 是
 *     **同一**分组的 catalog，但**不**带 per-session selection——给
 *     「settings 页面选 model」用，**不**给「session 用哪个 model」用。
 *   - **「Per-provider listing failure 不 fail 整组」**：`failures` 数组
 *     单独 ride，「没列出来的 provider」**不**让整组 fail——一个 provider
 *     报 401 / rate-limit 不让其它 provider 的 catalog 也看不到。
 *   - **`discoverModels` 是 draft 探测，**不**写**：payload 是用户在
 *     填的 draft（`settingsNs` 选 adapter family + `baseURL` / `api` /
 *     `apiKey` 是草稿字段），**不**是已存的 route。`provider` 命名正
 *     在编辑的 route（**有**的话）——adapter 自己认得这个 route 就走
 *     **它自己的** registry（更好 metadata + 无网络请求 + 不需 endpoint）。
 *     不认的 route 才发请求（用 `baseURL` 等）。**完全不**写：
 *     `settings.mutate` 才是「这条 route 真要 serve 什么」的决定者。
 *   - **`apiKey` 接受但**不**存 / **不**返**：`discoverModels` 是「**草
 *     稿**探测」，带 key 是为了让 endpoint 返未授权时的真实错误；**完
 *     全**不写进任何持久化，**完全**不返。
 *   - **Client 端 invalidate**走 `llm/adapters-updated` /
 *     `settings/document-updated` 转发事件，**不**轮询。
 *
 * 与其他模块的连接点：
 *   - `dsh-llm` 的 `LlmRuntime` 提供 directory / registry / model 列表
 *   - `dsh-llm-deepseek` / `dsh-llm-pi-ai` 的 `registerModelDiscovery`
 *     给 `discoverModels` 提供协议实现
 *   - `sessions.ts` 的 `ModelProviderGroup` / `ModelCatalogFailure` 共用
 *   - `rpc.ts` / `rpc-map.ts` 提供 wire 协议
 *   - `api-proxy.ts` 翻译
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { ModelCatalogFailure, ModelProviderGroup } from './sessions.ts'

/** Wire view of one configurable provider. */
export interface ConfigurableProviderView {
  /** Provider route key (`deepseek-official`, `openai`, …). */
  provider: string
  /** Human-readable name for configuration surfaces. */
  displayName: string
  /** Settings namespace whose section configures this provider. */
  settingsNs: string
  /** Path from that section's root to the provider's profile object (empty = whole section). */
  settingsPath: string[]
  /** Whether the route is currently registered (its models are requestable). */
  active: boolean
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it. Absent when the adapter draws no such distinction, so a
   * surface must treat absence as "unknown", not as "shipped".
   */
  declared?: boolean
}

/** Llm-domain unary methods (the map keys llm.* of RpcMethodMap). */
export interface LlmApi {
  /**
   * List every configurable provider with its live/dormant state, in
   * directory declaration order. Routes registered outside the directory
   * (an adapter that never declared configurability) are appended with their
   * registration identity and no settings address.
   */
  providers(request: RpcRequest<{}>): Promise<RpcResponse<{ providers: ConfigurableProviderView[] }>>

  /**
   * Host-scoped model catalog over every registered provider route: the
   * settings surface's models view, needing no session. Per-provider listing
   * failures ride `failures` without failing the sound groups.
   */
  models(request: RpcRequest<{}>): Promise<RpcResponse<{ groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] }>>

  /**
   * Interrogate a provider endpoint the configuration surface is still
   * drafting, and return the models it advertises for the user to adopt.
   *
   * The payload is the draft, not a stored route: `settingsNs` selects the
   * adapter family that answers, and the rest comes from the form. `provider`
   * names the route being edited when there is one — an adapter that already
   * describes that route answers from its own registry, with better metadata
   * and no network call, and needs no endpoint. A route it does not describe is
   * asked over the wire, which is what `baseURL`, `api`, and `apiKey` are for.
   *
   * Nothing is written — the reply is candidates, and only a later
   * `settings.mutate` decides what a route serves. `apiKey` is accepted here
   * but never stored or returned; a provider whose key is already stored omits
   * it and the endpoint answers unauthenticated or refuses.
   */
  discoverModels(
    request: RpcRequest<{
      settingsNs: string
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ models: DiscoveredModelView[] }>>
}

/** Wire view of one model an interrogated endpoint advertises. */
export interface DiscoveredModelView {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}
