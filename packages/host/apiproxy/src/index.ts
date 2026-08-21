/**
 * @file `dsh-host-apiproxy`：每个 client shape 共享的 API gateway。
 *
 * 三个子层：
 *   1. **`api/`**（types + zod schemas）—— browser-safe 的 `ApiProxy` 契约。
 *      Host 端和 client 端都 import 同一份，所以「host 能调什么 / client
 *      能调什么」是**同一份**静态清单。
 *   2. **`fetch/`** —— transport：host 侧 `toFetchHandler`（把 `ctx.apiProxy`
 *      包成 web fetch 形态），client 侧 `AbstractApiClient` + 平台子类。
 *   3. **`api-proxy.ts`**（`createApiProxy` + `ApiProxyService`）—— host 端
 *      实现，挂在 `ctx.apiProxy` 上。
 *
 * 关键设计：
 *   - **transport-agnostic**：本包**不**注册路由，**不**开 socket——
 *     物理 carrier（webserver / ACP / in-process）自己包 `ctx.apiProxy`。
 *     这是「同一个 `ApiProxy` 既能走 HTTP fetch 又能走 in-process」的根。
 *   - **`ctx.agentDefaultModel` 是 default 模型的真相**：换 model 走那个
 *     service 的持久化；已写进 session log 的 selection **不**被改。
 *   - **`Config` 三件事**：`nativeOpen`（能不能用桌面 opener）/ session log
 *     ZIP 压缩级别 / cold session blankness probe 大小上界。**没有** settings
 *     之外的可调参数——刻意把面缩窄，让 misuse 概率小。
 *   - **`respond` 用 `bind(api)`**：`createApiProxy` 返回**纯闭包**（不
 *     抓 `this`），bind 行为上**没**差，但保留显式 bind 让 transport
 *     作者知道「这是从 service 边界**剥离**出来的函数」，不会被
 *     「`this` 已变」之类的 JS 边界问题坑。
 *
 * 与其他模块的连接点：
 *   - `ctx.agents` / `ctx.sessions` / `ctx.llm` / `ctx.workspaceRegistry` /
 *     `ctx.tools` / `ctx.userQuestions` / `ctx.attachments` /
 *     `ctx.directoryPicker` / `ctx.subagents` / `ctx.sessionQuery` /
 *     `ctx.agentDefaultModel` 全部 inject 进 `ApiProxyService`——每条 RPC
 *     都在某个 Service 边界上做校验
 *   - `host/webserver` / `host/directory-picker-*` / `host/frontend-static`
 *     等都是 `ctx.apiProxy` 的 carrier
 *   - `api/remotes` 是 client 端的 Remote 装配
 */
 * the ApiProxy contract (api/: types + zod schemas, browser-safe), the fetch
 * carrier pair (fetch/: toFetchHandler on the host side, AbstractApiClient +
 * platform subclasses on the client side), and the host-side implementation
 * (api-proxy.ts: createApiProxy + the ApiProxyService gateway plugin providing
 * `ctx.apiProxy`). Transport-agnostic by design: this package registers no
 * routes — physical carriers wrap `ctx.apiProxy` themselves.
 *
 * The gateway consumes `ctx.agentDefaultModel`, the transport-independent default
 * shared with direct entry points. Switching models persists through that
 * service; sessions that have already logged a selection remain unchanged.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { ApiProxy } from './api/index.ts'
import { createApiProxy, DEFAULT_COLD_BLANK_PROBE_MAX_BYTES } from './api-proxy.ts'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  type SessionLogCompressionLevel,
} from './session-export.ts'

export type * from './api/index.ts'
export { RpcId } from './api/rpc.ts'
export { toFetchHandler } from './fetch/handler.ts'
export { AbstractApiClient, InProcessApiClient } from './fetch/client.ts'
export type { IApiClient } from './fetch/client.ts'
export { createApiProxy } from './api-proxy.ts'
export type { ApiProxyDefaults } from './api-proxy.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host-side ApiProxy implementation (the transport-agnostic gateway face). */
    apiProxy: ApiProxy
  }
}

/** Gateway plugin configuration. */
export interface Config {
  /**
   * Whether this deployment can hand paths to a native desktop opener —
   * the `hasDocument` capability the agent-preset roster reports. Absent,
   * the platform is asked (macOS/Windows/WSL yes; Linux only with a display
   * server); set it explicitly where detection misleads, e.g. `false` in a
   * container whose DISPLAY points nowhere a user can see.
   */
  nativeOpen?: boolean
  /**
   * DEFLATE level for every session-log ZIP entry: `0` stores without
   * compression, `1` favors CPU/latency, and `9` favors archive size.
   * @default 6
   */
  sessionExportCompressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /**
   * Maximum physical size of a cold Session artifact eligible for blankness
   * verification. Zero disables probes.
   * @default 1024
   */
  coldBlankProbeMaxBytes?: number
}

/**
 * The API gateway service: implements the ApiProxy contract over the composed
 * host context and provides it as `ctx.apiProxy`. The Host cwd is the default
 * project directory.
 */
export class ApiProxyService extends Service implements ApiProxy {
  static inject = [
    'agentDefaultModel', 'agents', 'attachments', 'directoryPicker', 'llm', 'sessions', 'subagents', 'sessionQuery',
    'tools', 'userQuestions', 'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    nativeOpen: z.boolean(),
    sessionExportCompressionLevel: z.number().step(1).min(0).max(9)
      .default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL) as z<SessionLogCompressionLevel>,
    coldBlankProbeMaxBytes: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_BYTES),
  })

  readonly sessions: ApiProxy['sessions']
  readonly subagents: ApiProxy['subagents']
  readonly workspace: ApiProxy['workspace']
  readonly host: ApiProxy['host']
  readonly goals: ApiProxy['goals']
  readonly skills: ApiProxy['skills']
  readonly agentPresets: ApiProxy['agentPresets']
  readonly settings: ApiProxy['settings']
  readonly credentials: ApiProxy['credentials']
  readonly llm: ApiProxy['llm']
  readonly events: ApiProxy['events']
  readonly downloads: ApiProxy['downloads']
  readonly respond: ApiProxy['respond']

  constructor(ctx: Context, config: Config) {
    super(ctx, 'apiProxy')
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      saveDefaultModelSelection: selection => ctx.agentDefaultModel.saveSelection(selection),
      cwd: process.cwd(),
      ...config.nativeOpen === undefined ? {} : { canOpenPath: () => config.nativeOpen as boolean },
      ...(config.sessionExportCompressionLevel === undefined
        ? {}
        : { sessionExportCompressionLevel: config.sessionExportCompressionLevel }),
      ...(config.coldBlankProbeMaxBytes === undefined
        ? {}
        : { coldBlankProbeMaxBytes: config.coldBlankProbeMaxBytes }),
    })
    this.sessions = api.sessions
    this.subagents = api.subagents
    this.workspace = api.workspace
    this.host = api.host
    this.goals = api.goals
    this.skills = api.skills
    this.agentPresets = api.agentPresets
    this.settings = api.settings
    this.credentials = api.credentials
    this.llm = api.llm
    this.events = api.events
    this.downloads = api.downloads
    // createApiProxy returns closures (no `this` capture), so the bind is
    // behavior-neutral.
    this.respond = api.respond.bind(api)
  }
}

export default ApiProxyService
