/**
 * @file `llm` domain 的 zod schema。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **schema 名从 `rpc-map.ts` 派生**：`llmProvidersRequestSchema` /
 *     `llmProvidersValueSchema` / `llmModels*` / `llmDiscoverModels*` 机械
 *     对应。加 method 时三处都得改。
 *   - **`groups` / `failures` 各自**独立**的 array**：`llm.models` response
 *     走「per-provider listing 失败**不**让整组 fail」——「失败的 provider」
 *     走 `failures` 数组，**不**让 `groups` 数组里有 provider 缺位（那
 *     样 client 端分不清「是 hidden 了」还是「fetch 失败」）。
 *   - **`llmDiscoverModelsRequestSchema.apiKey`**：`z.string().min(1).optional()`
 *     ——schema **接受**它，**但 host 端**永远**不**存 / **不**返（仅
 *     给本次探测用）。它**跟**其它 secret-bearing payload（`credentials.set` /
 *     `settings.update`）**一样**走 client outgoing envelope，所以
 *     `subscribeEnvelopes()` 之类的**全局**观察器**能**看到——要 redact
 *     那是 configuration-plane-wide 的事，**不**是本 method 自己决定
 *     的。
 *   - **`contextWindow` / `maxTokens` 强 `int().positive()`**：探测出来
 *     的容量数字必须是正整数；非正数 / 浮点 / 0 → `bad-request`，client
 *     端**不**会拿到「不可信」的数字。
 *
 * 与其他模块的连接点：
 *   - `rpc-map.ts` 的 `RequestPayload` / `ResponseValue`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `sessions.schema.ts` 复用 `modelProviderGroupSchema` /
 *     `modelCatalogFailureSchema`
 *   - `llm.ts` 是 type-only 入口
 *   - `api-proxy.ts` 验 + 翻译
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { ConfigurableProviderView, DiscoveredModelView } from './llm.ts'
import { modelCatalogFailureSchema, modelProviderGroupSchema } from './sessions.schema.ts'

/** ConfigurableProviderView row of llm.providers. */
export const configurableProviderViewSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  settingsNs: z.string(),
  settingsPath: z.array(z.string()),
  active: z.boolean(),
  declared: z.boolean().optional(),
}) satisfies z.ZodType<Wire<ConfigurableProviderView>>

/** llm.providers request payload. */
export const llmProvidersRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.providers'>>>

/** llm.providers response value. */
export const llmProvidersValueSchema = z.object({
  providers: z.array(configurableProviderViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.providers'>>>

/** llm.models request payload. */
export const llmModelsRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.models'>>>

/** llm.models response value. */
export const llmModelsValueSchema = z.object({
  groups: z.array(modelProviderGroupSchema),
  failures: z.array(modelCatalogFailureSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.models'>>>

/** DiscoveredModelView row of llm.discoverModels. */
export const discoveredModelViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
}) satisfies z.ZodType<Wire<DiscoveredModelView>>

/** llm.discoverModels request payload. */
export const llmDiscoverModelsRequestSchema = z.object({
  settingsNs: z.string().min(1),
  provider: z.string().min(1).optional(),
  baseURL: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  // Write-only at the host: used for this one interrogation, never stored and
  // never returned. It does ride the client's outgoing envelope like every
  // other secret-bearing payload (`credentials.set`, `settings.update`), which
  // `subscribeEnvelopes()` observers can see — redacting that tap is a
  // configuration-plane-wide change, not this method's to make alone.
  apiKey: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'llm.discoverModels'>>>

/** llm.discoverModels response value. */
export const llmDiscoverModelsValueSchema = z.object({
  models: z.array(discoveredModelViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.discoverModels'>>>
