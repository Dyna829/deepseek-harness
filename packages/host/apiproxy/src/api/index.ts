/**
 * @file `apiproxy` contract-layer barrel——`api/` 子树的统一入口。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **`api/` 零 Node 依赖**：browser 可 import。TS interface 是**权威
 *     contract**；HTTP / WebSocket / in-process SSE / 等等**只是物理
 *     channel**，不影响语义。
 *   - **「新 domain = 一个新 file pair + 这个 barrel 加一个 field +
 *     `rpc-map.ts` 加一行」**：扩展点是**显式**的。漏改一处 compile 报错
 *     而**不**是 wire 跑起来才看到。
 *   - **`downloads` 是 host-only**：放在 `ApiProxy` 而不是 `IApiClient`——
 *     `downloads` 是 HTTP GET，**不**走 wire envelope；client 端没有
 *     发起「下载 zip」这种语义。
 *   - **「`respond` 不是 domain method」**：它是 server 端收 client response
 *     的入口（approval / user-question 之类需要 client 端拍板），所以
 *     注释明确说「不是 domain method」——加 domain 时**不**会想「我是不是
 *     也要加一个 `respond` 回去」。
 *   - **「four-quadrant message model」**：ClientRequest / ClientResponse /
 *     ServerRequest / ServerResponse + RpcReceipt（载体收据）。这条命名
 *     不变量是 wire 协议层的**唯一**真理——任何加进来的 endpoint 都得
 *     走这四个象限之一。
 *
 * 与其他模块的连接点：
 *   - `api/*.ts` 每个 file 是一个 domain interface + payload types
 *   - `rpc-map.ts` 把 domain 映射成 `RequestPayload` / `ResponseValue` /
 *     `RpcMethodMap` 三个 generic
 *   - `rpc.ts` + `rpc.schema.ts` 是 wire 协议层
 *   - `api-proxy.ts`（host 端实现）+ `fetch/client.ts`（client 端）
 *     都 import 这里的 interface
 */

import type { SessionsApi } from './sessions.ts'
import type { HostApi } from './host.ts'
import type { WorkspaceApi } from './workspace.ts'
import type { AgentPresetsApi } from './agent-presets.ts'
import type { SkillsApi } from './skills.ts'
import type { SubagentsApi } from './subagents.ts'
import type { EventsApi } from './events.ts'
import type { GoalsApi } from './goals.ts'
import type { SettingsApi } from './settings.ts'
import type { CredentialsApi } from './credentials.ts'
import type { LlmApi } from './llm.ts'
import type { DownloadsApi } from './downloads.ts'
import type { ClientResponse, RpcReceipt } from './rpc.ts'

/** Root interface of the unified API. New client-request domain = one new file pair + one field here + one map row. */
export interface ApiProxy {
  sessions: SessionsApi
  subagents: SubagentsApi
  host: HostApi
  workspace: WorkspaceApi
  skills: SkillsApi
  agentPresets: AgentPresetsApi
  events: EventsApi
  goals: GoalsApi
  settings: SettingsApi
  credentials: CredentialsApi
  llm: LlmApi
  /** Host-only download surfaces (GET, no wire envelope); absent from IApiClient. */
  downloads: DownloadsApi
  /**
   * Response entry for server requests; not a domain method.
   * @param message - Client response carrying the server request's rpcId.
   * @returns Transport receipt for the response delivery.
   */
  respond(message: ClientResponse): Promise<RpcReceipt>
}

// ---- Domain interfaces and payload entities ----
export type {
  HistoryEntry, ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  ModelReasoningEffort, ModelSelection, PromptContentPart, QueueAction, SessionModels,
  SessionListMetadata, SessionProjectionsBlock, SessionSearchItem, SessionsApi, SessionSummary,
} from './sessions.ts'
export type { DirectoryEntry, DirectoryListing, HostApi } from './host.ts'
export type {
  SubagentAddress, SubagentCatalog, SubagentInterruptReceipt, SubagentListEntry,
  SubagentPromptReceipt, SubagentsApi,
} from './subagents.ts'
export type { JobView } from './jobs.ts'
export type { WorkspaceApi, WorkspaceId, WorkspaceView } from './workspace.ts'
export type { SkillsApi, SkillEntry } from './skills.ts'
export type { AgentPresetsApi, AgentPresetEntry } from './agent-presets.ts'
export type { EventsApi, MuxFrame, HostFrame, QueuedInboxItem, ToolCallView, ToolEventView, ToolResultView } from './events.ts'
export type { GoalsApi, GoalId, GoalRef } from './goals.ts'
export type { SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView } from './settings.ts'
export type { CredentialsApi, CredentialView } from './credentials.ts'
export type { ConfigurableProviderView, DiscoveredModelView, LlmApi } from './llm.ts'
export type { DownloadsApi } from './downloads.ts'
export type { ApprovalResponsePayload } from './approvals.ts'

export type { QuestionResponsePayload } from './questions.ts'

// ---- Message layer: narrow forms (domain-signature view) ----
export type { RpcRequest, RpcResponse } from './rpc.ts'

// ---- Message layer: the four wire full forms + carrier receipt ----
export type {
  ClientRequest,
  ClientResponse,
  RpcMessage,
  RpcReceipt,
  ServerRequest,
  ServerResponse,
} from './rpc.ts'

// ---- Errors and ids ----
export { RpcId, transportError } from './rpc.ts'
export type { RpcError, RpcErrorCode, RpcErrorDetailsMap, RpcResult } from './rpc.ts'
export {
  clientRequestSchema,
  serverRequestSchema,
  serverResponseSchema,
} from './rpc.schema.ts'

// ---- Fixed session-search product bounds ----
export {
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from './session-search.ts'

// ---- Method registry and derived generics ----
export type { RequestPayload, ResponseValue, RpcMethodMap } from './rpc-map.ts'
