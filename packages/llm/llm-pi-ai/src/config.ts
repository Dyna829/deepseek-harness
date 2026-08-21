/**
 * @file pi-ai adapter 的配置 schema + provider profile 校验。
 *
 * 核心 idea：profiles 是**按 provider route 索引的字典**，所以：
 *   - 组合基础（cordis.yml entry config）和 user-settings layer **按 provider
 *     merge**——一个 provider 的 key 在 settings 里覆盖，**不**影响其它 provider。
 *   - route 集合是**结构性**的（`Object.keys`），加一个 profile ＝ 加一条
 *     route，删一个 ＝ 删一条。
 *
 * 两种 route 走不同解析路径：
 *   1. **catalog route**（名字命中 pi-ai 安装的 provider）—— endpoint /
 *      protocol / display name / model catalog **从 pi-ai 继承**，profile
 *      **逐字段**覆盖；
 *   2. **hand-declared route**（pi-ai 没自带）—— profile **就是**整个 provider
 *      声明，必须给 `api` / `baseURL` / `models`。
 *
 * 关键不变量：
 *   - **`DEFAULT_INPUT = ['text']`**：model 既不声明也不在 catalog 里给能力时
 *     默认 text-only——**under-claim 比 over-claim 安全**：under 让 image 在
 *     附着前就拒，over 让 image 在持久化后才被 provider 拒（session 循环
 *     卡死）。
 *   - **`streamIdleTimeoutMs ≤ MAX_TIMER_DELAY_MS`**：Node setTimeout 大值
 *     立即触发，绕过后端 idle 设计。
 *   - **`maxRequestImageBytes` 默认 20 MiB**：4 张图（attachment store 默认
 *     3.5 MiB raw × 4）base64 编码后大小，留出 system prompt / history / tools
 *     容量。
 *   - **`buildProvider` 一次决定所有请求事实**——a request never re-resolves
 *     provider 形态。这条不变量让 in-flight stream 不会因为 settings 改
 *     而 endpoint 漂移。
 *   - **`assertServiceable` 在 settings 写入期拒「serve 不了」的 profile**：
 *     防止「profile 存进去，运行期静默 disable 整个 namespace」。
 *
 * 与其他模块的连接点：
 *   - `catalog.ts` 提供 pi-ai 内置 provider 形态 / supported protocols /
 *     thinking 格式 / modality 集合
 *   - `provider.ts` 的 `buildProvider` 把 profile 翻成 pi-ai 真实 `Provider`
 *   - `dsh-llm` 提供 retry policy schema
 *   - `dsh-credentials` 提供 `credentialRef`
 */
 *
 * A route key is not required to name an installed pi-ai provider. When it does,
 * that provider's endpoint, protocol, display name, and model catalog are the
 * profile's defaults and the profile overrides them field by field; when it does
 * not, the profile is the whole provider declaration. Resolution therefore ends
 * in a built pi-ai `Provider` per route: everything a request needs is decided
 * once, while the configuration key that made a route unserviceable can still be
 * named in the failure.
 *
 * @module dsh-llm-pi-ai/config
 */

import type { CacheRetention, ChatTemplateKwargValue, ModelThinkingLevel, Provider, ThinkingBudgets, Transport } from '@earendil-works/pi-ai'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import {
  CACHE_CONTROL_FORMATS,
  CHAT_TEMPLATE_VARS,
  MAX_TOKENS_FIELDS,
  MODALITIES,
  resolveRouteModels,
  SUPPORTED_THINKING_FORMATS,
  THINKING_LEVELS,
} from './catalog.ts'
import type {
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiReasoningEfforts,
} from './catalog.ts'
import { buildProvider, supportedProtocols } from './provider.ts'

/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/**
 * Default request-level bound on base64-encoded image payload. Every image in
 * history is re-encoded into every request body, so an unbounded conversation
 * eventually exceeds a provider or gateway request-size cap and the session
 * can never complete another request. The 20MiB default admits four images at
 * the attachment store's 3.5MiB raw-image default after base64 expansion and
 * reserves request capacity for system prompts, history, tools, and JSON.
 * Deployments behind stricter gateways lower it per route.
 */
export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024

/** Context capacity assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_CONTEXT_WINDOW = 262_144

/** Output capability assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_MAX_TOKENS = 32_768

/**
 * Modalities assumed for a model neither configuration nor the catalog
 * declares. Text is the floor every supported protocol certainly carries, so
 * this is the absence of a declaration rather than a guess at the endpoint:
 * nothing can interrogate a gateway for its modalities, and the two wrong
 * answers do not cost the same. Under-claiming refuses the image before it is
 * attached, naming the model. Over-claiming admits one the provider then
 * rejects mid-turn, after the message is durable, leaving the session
 * repeating a request that cannot succeed.
 */
export const DEFAULT_INPUT: readonly PiAiModality[] = ['text']

export type {
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
} from './catalog.ts'

/** Configuration for one pi-ai provider route; the `providers` dict key IS the route. */
export interface PiAiProviderProfile {
  /** Credential reference (environment-variable name) resolved per request through `ctx.credentials`. */
  apiKeyEnv?: string
  /** Name shown by configuration surfaces; defaults to the route key. */
  displayName?: string
  /**
   * Wire protocol every model on this route speaks. Omission keeps each
   * installed catalog model's own protocol, which is why a catalog route needs
   * no protocol at all; a route the catalog does not ship must name one.
   */
  api?: string
  /** Endpoint for this route's models; defaults to the installed catalog's endpoint. */
  baseURL?: string
  /**
   * This route's model catalog. Omission serves the installed catalog for the
   * route unchanged; an explicit list replaces it, each entry defaulting its
   * unset fields from the installed model of the same id.
   */
  models?: PiAiModelProfile[]
  /**
   * Installed-catalog customizations by model id: each entry reshapes that
   * one model with the same fields a {@link models} entry takes, while the
   * rest of the catalog keeps serving untouched. Only meaningful on a catalog
   * route with no `models` list — `models` already replaces the catalog, so
   * an override beside it, on a route the catalog does not ship, or naming a
   * model the catalog does not describe is refused rather than skipped.
   */
  modelOverrides?: Record<string, PiAiModelOverride>
  /**
   * pi-ai wire-compatibility switches defaulting every model on this route
   * whose protocol declares them; each model's own `compat` overrides per
   * field. What neither sets keeps the installed catalog entry's value, then
   * pi-ai's own detection. A switch no model on the route could read is
   * refused rather than left looking applied.
   */
  compat?: PiAiCompatProfile
  /**
   * Context capacity for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 262,144). A guess by construction, so
   * a deployment whose gateway serves smaller models corrects it here.
   */
  defaultContextWindow?: number
  /**
   * Output capability for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 32,768). This sizes the model; it
   * never becomes a per-request cap on its own.
   */
  defaultMaxTokens?: number
  /**
   * Request modalities for a model this route lists that neither its entry's
   * {@link PiAiModelProfile.input} nor the installed catalog declares (default
   * `[text]`). A fallback like the capacities above, not an override: a
   * catalog model keeps the modalities the catalog records for it, and this
   * value never narrows one. A gateway serving vision models the catalog does
   * not describe declares `[text, image]` once here instead of on every entry.
   * Unlike an entry's list, this one may not be empty — nothing sits below it
   * to answer instead.
   */
  defaultInput?: PiAiModality[]
  /** Provider request headers; Harness attribution wins reserved names. */
  headers?: Record<string, string>
  /** Provider-neutral pi-ai reasoning level. */
  reasoning?: ModelThinkingLevel
  /** Token budgets used by reasoning providers that support them. */
  thinkingBudgets?: ThinkingBudgets
  /** Prompt-cache retention preference. */
  cacheRetention?: CacheRetention
  /** Streaming transport preference. */
  transport?: Transport
  /** HTTP/provider SDK timeout in milliseconds. */
  timeoutMs?: number
  /** WebSocket connection timeout in milliseconds. */
  websocketConnectTimeoutMs?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /**
   * Maximum base64-encoded image payload per request. When a request's
   * accumulated images exceed it, the oldest images are replaced by text
   * placeholders until the request fits, so a long session keeps completing
   * requests instead of being rejected by a request-size cap.
   */
  maxRequestImageBytes?: number
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  retryPolicy?: RetryPolicyConfig
}

/** Validated profile with its route stamped and every adapter-owned default resolved. */
export interface ResolvedPiAiProviderProfile
  extends Omit<PiAiProviderProfile, 'apiKeyEnv' | 'retryPolicy' | 'models' | 'displayName'> {
  /** Harness route key and the `Models` collection key (the configuration dict key). */
  provider: string
  /** Resolved display name for selectors and configuration surfaces. */
  displayName: string
  /** Validated credential reference, when one is configured. */
  apiKeyEnv?: CredentialRef
  /** Positive finite provider-idle interval after defaulting. */
  streamIdleTimeoutMs: number
  /** Positive request-level base64 image payload bound after defaulting. */
  maxRequestImageBytes: number
  /** Immutable retry policy captured with this provider route. */
  retryPolicy: ResolvedRetryPolicy
  /**
   * The pi-ai provider this route registers, built from the resolved models.
   * Construction happens here so an unserviceable protocol or an underspecified
   * model fails with the rest of resolution, leaving the last good route set
   * serving requests.
   */
  piProvider: Provider
  /**
   * Per-request output caps this profile explicitly configured, by model id.
   * The seam materializes one only into a request that names no cap of its
   * own, so a catalog capability must not appear here.
   */
  configuredMaxTokens: ReadonlyMap<string, number>
}

/** Plugin configuration: the provider routes this instance owns. */
export interface Config {
  /**
   * pi-ai provider routes, keyed by provider. An empty (or omitted) dict is
   * the dormant settings-driven posture: the adapter mounts with no routes
   * and registers them the moment a settings section supplies profiles.
   */
  providers?: Record<string, PiAiProviderProfile>
}

const thinkingBudgets = z.object({
  minimal: z.number(),
  low: z.number(),
  medium: z.number(),
  high: z.number(),
})

/**
 * One `chat_template_kwargs` value. The `$var` member is pi-ai's placeholder
 * for a value dispatch fills from the request's thinking state, which is what
 * makes a chat-template gateway configurable without restating its template.
 */
const chatTemplateKwarg: z<ChatTemplateKwargValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.const(null),
  z.object({
    $var: z.union(CHAT_TEMPLATE_VARS).required(),
    omitWhenOff: z.boolean(),
  }),
])

const compatProfile: z<PiAiCompatProfile> = z.object({
  supportsStore: z.boolean(),
  supportsDeveloperRole: z.boolean(),
  supportsReasoningEffort: z.boolean(),
  supportsUsageInStreaming: z.boolean(),
  maxTokensField: z.union(MAX_TOKENS_FIELDS),
  requiresToolResultName: z.boolean(),
  requiresAssistantAfterToolResult: z.boolean(),
  requiresThinkingAsText: z.boolean(),
  requiresReasoningContentOnAssistantMessages: z.boolean(),
  thinkingFormat: z.union(SUPPORTED_THINKING_FORMATS),
  chatTemplateKwargs: z.dict(chatTemplateKwarg),
  supportsStrictMode: z.boolean(),
  cacheControlFormat: z.union(CACHE_CONTROL_FORMATS),
  supportsLongCacheRetention: z.boolean(),
  supportsEagerToolInputStreaming: z.boolean(),
  supportsCacheControlOnTools: z.boolean(),
  supportsTemperature: z.boolean(),
  forceAdaptiveThinking: z.boolean(),
  allowEmptySignature: z.boolean(),
  supportsStrictTools: z.boolean(),
})

/**
 * Keys are the offered levels, values their wire spellings. A valueless key
 * (`off:`) survives validation because schemastery passes nullable data
 * through before any member schema runs — `z.const(null)` only controls the
 * error for non-null wrong values and what a configuration UI renders.
 * Only resolution decides which levels may leave the value empty, so the
 * diagnostic can name the route and model. The assertion narrows
 * schemastery's `Dict`, which types every literal key as required; dict
 * validation checks only present keys, so the runtime value is a partial record.
 */
const reasoningEfforts = z.dict(
  z.union([z.string(), z.const(null)]),
  z.union(THINKING_LEVELS),
) as unknown as z<PiAiReasoningEfforts>

/** The fields a `models` entry and a `modelOverrides` value share; only the id's home differs. */
const modelFields = {
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  // No explicit default, unlike the route's `defaultInput`: schemastery
  // materializes `[]` for an absent array, and resolution reads that as "no
  // answer here" so the catalog entry below still applies.
  input: z.array(z.union(MODALITIES)),
  // The union, not a bare dict: schemastery materializes an absent dict as
  // `{}`, and absent must stay distinguishable — it means "inherit the
  // installed catalog's capability", while `false` disables reasoning.
  reasoningEfforts: z.union([z.const(false), reasoningEfforts]),
  compat: compatProfile,
}

const modelProfile: z<PiAiModelProfile> = z.object({
  id: z.string().required(),
  ...modelFields,
})

/** A {@link modelProfile} whose id lives in the `modelOverrides` dict key. */
const modelOverride: z<PiAiModelOverride> = z.object(modelFields)

const profile = z.object({
  apiKeyEnv: z.string().role('credential-ref'),
  displayName: z.string(),
  api: z.union(supportedProtocols()),
  baseURL: z.string(),
  models: z.array(modelProfile),
  modelOverrides: z.dict(modelOverride),
  compat: compatProfile,
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  defaultMaxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultInput: z.array(z.union(MODALITIES)).default([...DEFAULT_INPUT]),
  headers: z.dict(z.string()),
  reasoning: z.union(THINKING_LEVELS),
  thinkingBudgets,
  cacheRetention: z.union(['none', 'short', 'long']),
  transport: z.union(['sse', 'websocket', 'websocket-cached', 'auto']),
  timeoutMs: z.natural(),
  websocketConnectTimeoutMs: z.natural(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  maxRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_IMAGE_BYTES),
  retryPolicy: RetryPolicySchema,
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  providers: z.dict(profile).default({}),
})

/**
 * Reject a section this adapter could not serve. Registered as the settings
 * namespace's validator, so an unserviceable profile is refused where it is
 * *written* — `settings.mutate` answers `settings-rejected` with the offending
 * route and model named — instead of being stored and then quietly disabling
 * every route in the namespace. It stays a validator rather than a schema
 * transform because the schema is also the shape a configuration surface
 * renders and the value an absent section resolves to; wrapping it would break
 * both.
 * @param config - the resolved section to check.
 * @throws Error naming the route and model that cannot be served.
 */
export function assertServiceable(config: Config): void {
  resolveProfiles(config.providers)
}

/** Reject removed pre-release profile fields and name their replacements. */
function rejectRemovedFields(provider: string, source: PiAiProviderProfile): void {
  const legacy = source as PiAiProviderProfile & {
    provider?: unknown
    maxRetries?: unknown
    maxRetryDelayMs?: unknown
  }
  if ('provider' in legacy) {
    throw new Error(`llm-pi-ai: provider "${provider}" sets "provider", which moved to the providers dict key`)
  }
  if ('maxRetries' in legacy || 'maxRetryDelayMs' in legacy) {
    throw new Error(
      `llm-pi-ai: provider "${provider}" sets maxRetries or maxRetryDelayMs, which were removed;`
      + ' compose agent recovery with dsh-llm-retry',
    )
  }
}

/**
 * Validate profiles and return a detached route-keyed map suitable for
 * per-request reads. This is the one explicit resolve step, so an omitted dict
 * resolves to the empty (dormant) route set here rather than through a hidden
 * fallback, and each route's models and pi-ai provider are materialized once.
 * @param providers - configured provider profiles keyed by route.
 * @returns validated profiles in configuration order.
 */
export function resolveProfiles(
  providers: Readonly<Record<string, PiAiProviderProfile>> | undefined,
): Map<string, ResolvedPiAiProviderProfile> {
  if (Array.isArray(providers)) {
    throw new Error('llm-pi-ai: providers is now a dict keyed by provider route, not an array of profiles')
  }
  const entries = Object.entries(providers ?? {})
  const resolved = new Map<string, ResolvedPiAiProviderProfile>()
  for (const [provider, source] of entries) {
    rejectRemovedFields(provider, source)
    if (provider.length === 0) throw new Error('llm-pi-ai: provider names must be non-empty')
    if (source.baseURL !== undefined && source.baseURL.length === 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" has an empty baseURL`)
    }
    if (source.displayName !== undefined && source.displayName.length === 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" has an empty displayName`)
    }
    const streamIdleTimeoutMs = source.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
    if (!Number.isFinite(streamIdleTimeoutMs)
      || streamIdleTimeoutMs <= 0
      || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
      throw new Error(
        `llm-pi-ai: provider "${provider}" streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
      )
    }
    const maxRequestImageBytes = source.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES
    if (!Number.isInteger(maxRequestImageBytes) || maxRequestImageBytes <= 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" maxRequestImageBytes must be a positive integer`)
    }
    // Detached from the configuration object because pi-ai types `Model.input`
    // mutable. The schema's explicit default covers an absent key, so an empty
    // list here is always one someone typed — and unlike an entry's, nothing
    // below it can answer instead — so it is refused rather than read as "no
    // answer".
    const defaultInput = [...source.defaultInput ?? DEFAULT_INPUT]
    if (defaultInput.length === 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" defaultInput must name at least one modality`)
    }
    // The route key, not the installed provider's own name: the directory has
    // always shown route keys, and a catalog route must not silently rename
    // itself on every configuration surface just because it gained a profile.
    const displayName = source.displayName ?? provider
    const catalog = resolveRouteModels({
      provider,
      ...source.api === undefined ? {} : { api: source.api },
      ...source.baseURL === undefined ? {} : { baseURL: source.baseURL },
      ...source.models === undefined ? {} : { models: source.models },
      ...source.modelOverrides === undefined ? {} : { modelOverrides: source.modelOverrides },
      ...source.compat === undefined ? {} : { compat: source.compat },
      defaultInput,
      defaultContextWindow: source.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
      defaultMaxTokens: source.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
    })
    const { apiKeyEnv, retryPolicy, models: _models, displayName: _displayName, ...rest } = source
    resolved.set(provider, {
      ...rest,
      provider,
      displayName,
      ...apiKeyEnv === undefined ? {} : { apiKeyEnv: credentialRef(apiKeyEnv) },
      streamIdleTimeoutMs,
      maxRequestImageBytes,
      retryPolicy: resolveRetryPolicy(retryPolicy, `llm-pi-ai: provider "${provider}" retryPolicy`),
      ...rest.headers === undefined ? {} : { headers: { ...rest.headers } },
      ...rest.thinkingBudgets === undefined ? {} : { thinkingBudgets: { ...rest.thinkingBudgets } },
      configuredMaxTokens: catalog.configuredMaxTokens,
      piProvider: buildProvider({
        provider,
        displayName,
        ...source.api === undefined ? {} : { api: source.api },
        ...source.baseURL === undefined ? {} : { baseURL: source.baseURL },
        models: catalog.models,
        namesCredential: apiKeyEnv !== undefined,
      }),
    })
  }
  return resolved
}
