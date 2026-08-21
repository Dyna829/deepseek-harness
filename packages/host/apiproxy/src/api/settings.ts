/**
 * @file `settings` domain contract——`ctx.settings` 的 web 出口。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「所有 wire payload 走 `describe({ redactSecrets: true })`」**：
 *     `role('secret')` 字段**任何**层**永远不**进 response。`secrets`
 *     slot list 让 form 知道「有 write-only 字段存在 + 它是否 configured」，
 *     **不**让 form 读出值本身。
 *   - **`expectedRevision` 是 CAS 防 stale editor**：client 写时把上次
 *     拿到的 `revision` 带回；host 端校验「这一份 view 之后没被改过」
 *     ——stale 静默覆盖并发修改被拒。
 *   - **`update` (merge) vs `replace` (wholesale) vs `mutate` (path ops)**：
 *     三种 write 路径**不能**互相替代：
 *     - `update` 走 patch merge，**没**列在 patch 里的 key 保留；
 *     - `replace` **完全**覆盖——「`section: {}`」= 回到 composition
 *       defaults；secret 也包括（client 必须**先**读回 user 层再回填
 *       想保留的 secret，否则被一并清掉）；
 *     - `mutate` 用 path ops 改——**不**针对「wire 上看不见的 secret」
 *       做删除，**只**删 wire 上能命名的字段。这条让「删 secret」必须
 *       走 `replace` + 显式重写。
 *   - **`openDocument` 不传 path**：host 端自己解析**那一个** file-backed
 *     provider 的本地 document。**不**让 browser payload 选任意 host fs 目标。
 *   - **`applies: 'live' | 'restart'`**：client 用它决定「改完要不要
 *     提示用户重启」——plugin owner 自己声明。
 *
 * 与其他模块的连接点：
 *   - `dsh-settings` 提供 host 端 seam / schemastery schema 序列化
 *   - `dsh-credentials` 提供 secret 值的存储（host 端）
 *   - `dsh-schemastery` 提供 schema 序列化 / 反序列化
 *   - `rpc.ts` / `rpc-map.ts` 提供 wire 协议
 *   - `api-proxy.ts` 翻译
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One schema-declared secret slot inside a redacted namespace value. */
export interface SettingsSecretView {
  /** Path from the section root to the removed field. */
  path: string[]
  /** Whether the slot currently holds a value (the value itself never rides). */
  set: boolean
}

/** Wire view of one registered settings namespace. */
export interface SettingsNamespaceView {
  /** Namespace key (`llm-deepseek`, `llm-pi-ai`, …). */
  ns: string
  /** Serialized schemastery schema envelope (`schema.toJSON()`); rehydrate with `new Schema(json)`. */
  schema: unknown
  /** Redacted resolved value (schema defaults → composition base → user layer). */
  value: unknown
  /** Redacted composition base layer, when the registrant declared one. */
  base?: unknown
  /** Redacted raw user section, when one exists; a field's presence here marks it user-overridden. */
  user?: unknown
  /** When the owner applies changes. */
  applies: 'live' | 'restart'
  /** Every schema-declared secret slot with its configured state. */
  secrets: SettingsSecretView[]
  /**
   * Monotonic revision of the raw user section this view was read at. Send it
   * back as `expectedRevision` on a write so a stale editor is refused rather
   * than silently overwriting a concurrent change.
   */
  revision: number
}

/**
 * One path-addressed edit carried by `settings.mutate`. `set` writes the
 * value at the path (creating intermediate objects); `unset` removes it. The
 * empty path addresses the section root.
 */
export type SettingsPathOpView =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** Settings-domain unary methods (the map keys settings.* of RpcMethodMap). */
export interface SettingsApi {
  /**
   * Describe every registered namespace: redacted layered values plus the
   * serialized schema a client renders its form from. `hasDocument` reports
   * whether a file-backed provider owns a local document without exposing its
   * Host path. This method is loopback-only; `writable: false` (read-only
   * provider) tells the client to disable every write control.
   */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{
    writable: boolean
    hasDocument: boolean
    namespaces: SettingsNamespaceView[]
  }>>

  /**
   * Materialize the configured local document when absent and ask the Host to
   * hand it to the platform text-document opener. macOS forces a text editor;
   * Linux and Windows use the desktop file association. The request carries
   * no path, so the browser cannot choose an arbitrary Host filesystem target.
   */
  openDocument(
    request: RpcRequest<{}>, signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>>

  /**
   * Merge a patch into one namespace's user layer (validate → persist →
   * commit). Secret-role fields may be INCLUDED in the patch (write-only
   * direction); a form that leaves a secret untouched simply omits it and the
   * merge preserves the stored value. Responds with the namespace's new
   * redacted view; a schema or storage rejection is `settings-rejected`.
   */
  update(request: RpcRequest<{ ns: string; patch: object; expectedRevision?: number }>): Promise<RpcResponse<SettingsNamespaceView>>

  /**
   * Replace one namespace's user section wholesale — the removal/reset path a
   * merge cannot express (`section: {}` resets to composition defaults). Keys
   * absent from `section` are dropped, secrets included: a client must first
   * fold the descriptor's `user` layer (and re-supply any secret it wants to
   * keep) or accept the reset.
   */
  replace(request: RpcRequest<{ ns: string; section: object; expectedRevision?: number }>): Promise<RpcResponse<SettingsNamespaceView>>

  /**
   * Apply path-addressed edits to one namespace's user section, resolved
   * against the section as stored — NOT against whatever the caller last
   * read. This is the removal path for any client holding the redacted
   * descriptor: it names the field it means, so a secret the wire never
   * returned cannot be deleted as a side effect. `replace` remains the
   * deliberate wholesale reset.
   */
  mutate(
    request: RpcRequest<{ ns: string; ops: SettingsPathOpView[]; expectedRevision?: number }>,
  ): Promise<RpcResponse<SettingsNamespaceView>>
}
