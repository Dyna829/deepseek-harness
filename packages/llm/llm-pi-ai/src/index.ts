/**
 * @file 通用 pi-ai-backed LLM adapter 插件入口。
 *
 * 与 `llm-deepseek` 的根本区别：**一个插件实例拥有多个 provider route**，
 * 而 `llm-deepseek` 是「一插件一 provider」。
 *
 * 关键设计：
 *   - **route 分两类**：
 *     1. **catalog route**（名字命中 pi-ai 内置 catalog）—— endpoint /
 *        protocol / model catalog **全部**继承 pi-ai 自己的，本配置只补
 *        `apiKeyEnv` / `retryPolicy` / model 覆盖。
 *     2. **hand-declared route**（名字 pi-ai 没自带）—— 必须显式给
 *        `api` / `baseURL` / `models` / 可选 `compat`（覆盖 pi-ai 无法
 *        识别的 URL 上的 reasoning 格式等）。
 *   - **profile 解析按 request 走 settings section + 凭据 seam**：单 route
 *     改 key / 改 endpoint / 改 model 都无需重启；in-flight stream 仍持它
 *     启动时那份 snapshot。
 *   - **registration-captured 事实（route 集合 + 每 route 的 retry policy）
 *     改了就 `replace(routes)` 同步 swap**，**不**走「dispose + 重新注册」——
 *     后者会在两步之间暴露空 route 集合给观察者。
 *   - **目录 vs 注册两套事实**：`ensureDirectory`（configurable-provider
 *     directory）跟随 profiles，但**不**是同一个 `replace`——目录是「这个
 *     plugin 暴露的所有可配置 route」，注册是「这个 plugin 当前实际 serve
 *     的 route」。一个 refused 的目录 swap 不影响 routes，一个 refused 的
 *     registration swap 不影响目录。
 *   - **`assertServiceable` 在写入时拒绝「plugin serve 不了」的 profile**：
 *     避免「profile 存进去了、运行时静默 disable 整个 namespace」。
 *
 * 关键不变量：
 *   - **「named route 但没 key」是 fail loud**（不丢给 pi-ai 的 ambient
 *     discovery）——否则 `OPENAI_API_KEY` 这种环境变量会**默默**被一个
 *     想用自己的 `ACME_GATEWAY_API_KEY` 的部署「借用」，账单到错租户。
 *   - **目录里 `declared: !catalog.has(provider)`**——membership 看的是
 *     pi-ai 安装了什么，**不**是 settings 里写了什么；narrowed catalog
 *     route 还是 catalog route。
 *   - **dormant bare mount 合法**：初始 0 route **不**调 `registerAdapter`，
 *     settings 写第一条 profile 才挂。
 *
 * 与其他模块的连接点：
 *   - `PiAiAdapter`（同包）执行真实流
 *   - `config.ts` 把 raw `Config` 解析成 `ResolvedPiAiProviderProfile`
 *   - `catalog.ts` 提供 pi-ai 内置 provider id
 *   - `provider.ts` 解析 OpenAI-compat / Anthropic / 等协议的 url 形态
 *   - `discovery.ts` 在 settings 探测里给新 URL 探测 model
 *   - `replay.ts` 处理跨 provider replay 的降级
 *   - `dsh-llm` 的 `LlmRuntime` 提供 register / replace / 目录
 *   - `dsh-settings` 提供 HMR
 */
 *
 * ```yaml
 * - id: llm
 *   name: '@deepseek-ai/dsh-llm-pi-ai'
 *   config:
 *     providers:
 *       # Catalog route: everything but the credential comes from pi-ai.
 *       openai:
 *         apiKeyEnv: OPENAI_API_KEY
 *         retryPolicy:
 *           mode: normal
 *           maxRetries: 2
 *       # Catalog route with the catalog narrowed and one capacity corrected.
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_API_KEY
 *         models:
 *           - id: claude-sonnet-4-5
 *             contextWindow: 200000
 *       # Hand-declared route: pi-ai ships nothing under this key.
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         apiKeyEnv: ACME_GATEWAY_API_KEY
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         # Reasoning dialect for a URL pi-ai cannot recognize.
 *         compat:
 *           thinkingFormat: deepseek
 *         models:
 *           - id: acme-large
 *             name: Acme Large
 *             contextWindow: 65536
 *             maxTokens: 4096
 *           - id: acme-think
 *             name: Acme Think
 *             contextWindow: 262144
 *             maxTokens: 32768
 *             # key = selectable level, value = wire spelling; only off may
 *             # leave the value empty (supported, send nothing).
 *             reasoningEfforts:
 *               off:
 *               high: high
 *               max: ultra
 * ```
 *
 * @module @deepseek-ai/dsh-llm-pi-ai
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { PiAiAdapter } from './adapter.ts'
import { catalogProviderIds, catalogProviderTakesApiKey } from './catalog.ts'
import { assertServiceable, Config, resolveProfiles } from './config.ts'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'

export { PiAiAdapter } from './adapter.ts'
export type { PiAiAdapterOptions } from './adapter.ts'
export { Config } from './config.ts'
export type {
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiProviderProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
  ResolvedPiAiProviderProfile,
} from './config.ts'
export { supportedProtocols } from './provider.ts'

export const name = 'llm-pi-ai'
export const inject = ['llm']

const NS = settingsNamespace('llm-pi-ai')

/**
 * The registry captures these per route; a change here must re-register.
 * Sorted by provider so a settings document that merely reorders its keys is
 * not mistaken for a route change.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): unknown {
  return [...profiles.entries()]
    // `displayName` rides along because the registry hands it to every selector
    // through `providerInfo()`: a rename that did not re-register would leave
    // the old label showing until some unrelated fact happened to change.
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory: every installed catalog route this
 * adapter can authenticate, plus every route the current profiles declare. A
 * hand-declared route has no catalog entry, so without this union it would
 * have no settings address and configuration surfaces could neither show nor
 * edit it.
 *
 * The profile half is unconditional, which is what keeps a route already
 * stored against a withheld provider editable and deletable rather than
 * stranded in the settings document with nothing on the page to remove it.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries in catalog order, declared routes last.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  const catalog = new Set(catalogProviderIds())
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string): void => {
    entries.set(provider, {
      provider,
      displayName,
      settingsNs: NS,
      settingsPath: ['providers', provider],
      // Membership of the installed catalog, not of the settings document:
      // narrowing a shipped provider's models stores a profile too, and that
      // route is still one pi-ai knows.
      declared: !catalog.has(provider),
    })
  }
  // A provider whose only native method is OAuth leaves this adapter nothing
  // to authenticate with, so offering it would put a card on the settings page
  // whose own posture — no key, credentials discovered by the provider — fails
  // every request. Catalog *membership* is unaffected, so `declare` above still
  // answers what pi-ai ships.
  for (const provider of catalog) {
    if (catalogProviderTakesApiKey(provider)) declare(provider, provider)
  }
  for (const [provider, profile] of profiles) declare(provider, profile.displayName)
  return [...entries.values()]
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  /**
   * The resolved profiles for the current configuration, memoized by the raw
   * snapshot's identity — which is also what makes the adapter's own snapshot
   * stable across operations that observe no change.
   *
   * No fallback for an unserviceable snapshot lives here: the section schema
   * resolves the whole profile set, so a write that could not be served is
   * refused where it is written, and the settings seam keeps a namespace's
   * last good value for a stored section that fails. Anything reaching this
   * point has already resolved once.
   */
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = resolveProfiles(raw.providers)
    lastRaw = raw
    memoized = next
    return next
  }
  profiles()

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Once one is named, a miss must fail loud:
    // handing pi-ai `undefined` would let it pick up an unrelated ambient key
    // (OPENAI_API_KEY and friends), billing another tenant for a request the
    // deployment meant to authenticate differently.
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref)
    throw new LlmError(
      `llm-pi-ai: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    resolveAttachments: () => ctx.get('attachments'),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-pi-ai: unusable replay state on assistant history for route "${provider}/${model}";`
        + ` sending that message as provider-neutral content (${reason})`,
      )
    },
  })
  // The full installed catalog is configurable from the moment the plugin
  // mounts — dormant or not — so configuration surfaces can offer every
  // pi-ai provider before any route exists. Hand-declared routes join it as
  // profiles appear, and leave with them.
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles())
    if (deepEqualJson(entries, directoryFacts)) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares (a profile keyed `deepseek-official`) would
    // otherwise leave this plugin's whole directory withdrawn and the Models
    // page empty. The candidate set is validated first, so a collision keeps
    // the previous entries serving and only costs a diagnostic.
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()
  /**
   * The credential a named route already resolves, for an interrogation whose
   * draft carries none. A route being declared for the first time names no
   * profile yet, and a profile that names no credential defers to pi-ai's own
   * discovery, so both answer `undefined` and the endpoint is asked
   * unauthenticated — the same posture a request to that route would take.
   */
  const storedApiKey = async (provider: string | undefined): Promise<string | undefined> => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return resolveApiKey(provider, profile)
  }
  // Interrogating an endpoint is a configuration-time action over a draft, so
  // it is offered for the whole namespace rather than per route: the provider
  // a surface is adding does not exist yet. The draft is the whole request
  // except the credential: a configuration surface edits a redacted descriptor
  // and never holds a stored secret, so an already-configured route supplies
  // its own here rather than being interrogated unauthenticated.
  ctx.llm.registerModelDiscovery(NS, request => discoverModels(request, () => storedApiKey(request.provider)))
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. A bare
  // mount (zero routes) is the dormant posture: nothing registers until a
  // settings section supplies profiles, and routes drop when it empties.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    // The registry captures the route set and each route's retry policy at
    // registration, so a change to either must re-register. The swap is
    // atomic (same adapter instance, validated before anything moves): a
    // conflicting route leaves the previous routes serving requests, and
    // `registeredFacts` only advances once the registry actually holds the
    // new set — so returning to a working configuration always re-applies.
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      // Dormant bare mount: nothing is registered until a section supplies
      // profiles, and an empty section keeps it that way.
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  installSettingsSection(ctx, NS, Config, config, {
    // Refuse an unserviceable section where it is written: without this a
    // schema-valid profile the adapter cannot serve would be stored and then
    // silently disable every route in this namespace.
    validate: assertServiceable,
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // Named here rather than left to the settings watcher: `assertServiceable`
      // cannot see the llm registry, so a profile claiming a route another
      // adapter family owns is stored successfully and only fails at this swap.
      // Without its own diagnostic that refusal reaches the operator as a
      // generic "settings: watcher failed", naming neither the route nor why it
      // is not serving. The previous routes keep serving either way.
      try {
        ensureRegistrationFacts()
      } catch (error) {
        ctx.logger.error('llm-pi-ai: keeping the previously registered routes after a refused update')
        ctx.logger.error(error)
      }
      // The directory follows the profiles the registry accepted, so a route
      // that failed to register is not advertised as configurable. A refused
      // directory swap is contained here for the same reason the registry's
      // is: the previous entries keep serving, and `directoryFacts` stays put
      // so returning to a working configuration re-applies.
      try {
        ensureDirectory()
      } catch (error) {
        ctx.logger.error('llm-pi-ai: keeping the previous configurable-provider directory after a refused update')
        ctx.logger.error(error)
      }
    },
  })
}
