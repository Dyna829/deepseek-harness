/**
 * @file RPC method registry + signature-derived generics。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **只登 client-request 方法**：`respond` 是 client-response（client
 *     回 host 端 server-request 的拍板），**不**进 map。漏登一处就是
 *     「加 endpoint 但 wire 上找不到」。
 *   - **map key = wire path 段**（`session.list` / `goal.create` / `host.pickDirectory`）——同一份
 *     key 在 carrier 端翻译成 `POST /api/session.list` / `POST /api/goal.create` / 等等。
 *   - **Signature 是唯一 source of truth**：`RequestPayload<K>` /
 *     `ResponseValue<K>` 都**派生**自 `Parameters<RpcMethodMap[K]>[0]['payload']`
 *     和 `Awaited<ReturnType<RpcMethodMap[K]>>` 推断。手写一个 `type SessionListRequest
 *     = { foo: string }` 是**反**模式——map 改了它不会自动跟。
 *   - **「method 可带 trailing `AbortSignal`」约定**（如 `command.execute`）：
 *     carrier 把自己的 request signal 传过来，**不**是 wire 字段——client
 *     没法在请求里塞个「我希望 5 秒后 abort」进来。
 *   - **加方法 = 加三个地方**：
 *     1. 这个 map 加一行；
 *     2. `sessions.ts` 等 domain file 加 method signature；
 *     3. `*.schema.ts` 加对应的 zod schema。
 *     漏一处 = 编译失败，**不**是 wire 上跑起来才看到。
 *
 * 与其他模块的连接点：
 *   - 各 `api/<domain>.ts` 提供 method signature
 *   - `rpc.ts` 的 `RpcResponse` 让 `ResponseValue<K>` 推断
 *   - `*.schema.ts` 用 `RequestPayload<K>` / `ResponseValue<K>` 写 zod schema
 *   - `api-proxy.ts` / `fetch/client.ts` 用同一份 map 派发
 */

import type { SessionsApi } from './sessions.ts'
import type { HostApi } from './host.ts'
import type { WorkspaceApi } from './workspace.ts'
import type { AgentPresetsApi } from './agent-presets.ts'
import type { SkillsApi } from './skills.ts'
import type { GoalsApi } from './goals.ts'
import type { SettingsApi } from './settings.ts'
import type { CredentialsApi } from './credentials.ts'
import type { LlmApi } from './llm.ts'
import type { SubagentsApi } from './subagents.ts'
import type { RpcResponse } from './rpc.ts'

/**
 * Method name → method signature. Signatures are the single source of truth; payload/value
 * types are always derived from here. A method may declare a trailing AbortSignal after the
 * request (command.execute): the carrier passes its request signal, never a wire field.
 */
export interface RpcMethodMap {
  'session.list': SessionsApi['list']
  'session.search': SessionsApi['search']
  'session.create': SessionsApi['create']
  'session.history': SessionsApi['history']
  'session.models': SessionsApi['models']
  'session.selectModel': SessionsApi['selectModel']
  'session.rename': SessionsApi['rename']
  'session.fork': SessionsApi['fork']
  'session.prompt': SessionsApi['prompt']
  'session.attachment': SessionsApi['attachment']
  'session.updateQueue': SessionsApi['updateQueue']
  'session.cancel': SessionsApi['cancel']
  'subagent.list': SubagentsApi['list']
  'subagent.history': SubagentsApi['history']
  'subagent.prompt': SubagentsApi['prompt']
  'subagent.interrupt': SubagentsApi['interrupt']
  'host.describe': HostApi['describe']
  'host.pickDirectory': HostApi['pickDirectory']
  'host.listDirectory': HostApi['listDirectory']
  'host.createDirectory': HostApi['createDirectory']
  'host.openPath': HostApi['openPath']
  'workspace.list': WorkspaceApi['list']
  'workspace.create': WorkspaceApi['create']
  'workspace.rename': WorkspaceApi['rename']
  'workspace.delete': WorkspaceApi['delete']
  'workspace.insertBefore': WorkspaceApi['insertBefore']
  'workspace.insertSessionBefore': WorkspaceApi['insertSessionBefore']
  'workspace.archiveSession': WorkspaceApi['archiveSession']
  'skill.list': SkillsApi['list']
  'agentPreset.list': AgentPresetsApi['list']
  'agentPreset.select': AgentPresetsApi['select']
  'agentPreset.read': AgentPresetsApi['read']
  'agentPreset.copy': AgentPresetsApi['copy']
  'agentPreset.openDocument': AgentPresetsApi['openDocument']
  'agentPreset.remove': AgentPresetsApi['remove']
  'goal.create': GoalsApi['create']
  'goal.edit': GoalsApi['edit']
  'goal.pause': GoalsApi['pause']
  'goal.resume': GoalsApi['resume']
  'goal.complete': GoalsApi['complete']
  'goal.clear': GoalsApi['clear']
  'settings.describe': SettingsApi['describe']
  'settings.openDocument': SettingsApi['openDocument']
  'settings.update': SettingsApi['update']
  'settings.replace': SettingsApi['replace']
  'settings.mutate': SettingsApi['mutate']
  'credentials.describe': CredentialsApi['describe']
  'credentials.set': CredentialsApi['set']
  'credentials.unset': CredentialsApi['unset']
  'llm.providers': LlmApi['providers']
  'llm.models': LlmApi['models']
  'llm.discoverModels': LlmApi['discoverModels']
}

/** Business request payload of method K (reaches through the RpcRequest narrow form to payload). */
export type RequestPayload<K extends keyof RpcMethodMap> = Parameters<RpcMethodMap[K]>[0]['payload']

/** Business return value of method K (reaches through the RpcResponse narrow form to infer the ok value of result). */
export type ResponseValue<K extends keyof RpcMethodMap> =
  Awaited<ReturnType<RpcMethodMap[K]>> extends RpcResponse<infer T> ? T : never
