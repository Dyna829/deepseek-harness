/**
 * @file `agent-presets` domain contract——浏览器「开 session 时选哪个
 * preset」名单 + 它的 authoring calls。
 *
 * 关键设计点（**写代码容易绕过的**）：
 *   - **`list` 是普通 method**（带 ids + trust）；**`read` / `select` /
 *     `copy` / `openDocument` / `remove` 是 privileged loopback-pinned**：
 *     composition 决定了 session 跑哪些 plugin——读它就是 reconnaissance，
 *     所以 wire 必须把这条**明确**标「privileged」让 audit / 信任锚能识别。
 *   - **`copy` 是唯一**写** authoring**：wire 上**不**传 composition
 *     文本 / 路径——`from` 和 `agentPreset` 都是 id，host 端在自己的
 *     root 里解析。copy 出来的 preset **和** source **完全一样可 load**，
 *     不会让 wire 端注入新内容。description 跟 source 走（作者之后
 *     自己改文件），name 不跟——name 是「行区分」的字段。
 *   - **`select` 只在 session blank 时**允许：一旦 turn 跑过，历史
 *     就是在旧 preset 的 tools 下生成的，换 preset 会留下「logged tool
 *     call 但新 composition 不能 make」的残局——attempt 答 `agent-preset-locked`。
 *   - **`openDocument` 传 id 不传 path**：host 端在自己 root 解析，wire
 *     payload **不**能选任意 fs 目标。`hasDocument: false` 的 deployment
 *     **不**报错——返 `{ opened: false, path }` 让 surface 拿路径**当
 *     文本显示**。Shipped preset 拒（用户不该管装货）。
 *   - **`broken` 字段让 preset 留名单**：「目录还占着 id」所以 surface
 *     **必须**能 show + delete 它。`broken` 描述「为什么不能 compose
 *     session」——offering 它只会把这条 reason 推迟到 session start 失败。
 *   - **`trust: 'user'`**的 preset **和**它命名的 plugin **同** privilege
 *     ——surface 不能把它「当成 vetted 的」展示。
 *
 * 与其他模块的连接点：
 *   - `dsh-session` 的 `SessionId`
 *   - `dsh-agent-presets` 提供 host 端 roster / authoring 实际逻辑
 *   - `rpc.ts` / `rpc-map.ts` 提供 wire 协议
 *   - `api-proxy.ts` 翻译 wire 到 host 服务
 *   - `host/directory-picker-native` 提供 `openDocument` 背后的 native opener
 */
 *
 * `list` is ordinary: it carries ids and trust, and every preset picker needs
 * it. The authoring calls are privileged and loopback-pinned — a composition
 * names the plugins a session runs, so reading one is reconnaissance, and
 * although authoring is copy-only (no caller supplies composition text or a
 * path), copying and deleting still rearrange what the deployment offers.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One preset the deployment can compose a session's agent from. */
export interface AgentPresetEntry {
  /** Stable identifier, also the display name until presets carry metadata. */
  readonly id: string
  /**
   * Whether the preset ships with the deployment or was authored locally.
   * A `user` preset is exactly as privileged as the plugins it names, so a
   * surface offering one should say so rather than present it as vetted.
   */
  readonly trust: 'system' | 'user'
  /** Whether a session that names no preset gets this one. */
  readonly isDefault: boolean
  /**
   * Display name the preset published, absent when it published none. A
   * surface falls back to {@link id}; it is never a second identity, and it
   * never decides trust — a locally authored preset cannot name itself into
   * the shipped set.
   */
  readonly name?: string
  /** One sentence on what the preset is for, when it published one. */
  readonly description?: string
  /**
   * Why this preset cannot compose a session, absent when it can. A broken
   * preset stays listed — its directory still occupies the id, so a surface
   * must be able to show and delete it — but offering it for selection would
   * only defer this reason to a failed session start.
   */
  readonly broken?: string
}

/** agent-preset-domain unary methods (the map key agentPreset.* of RpcMethodMap). */
export interface AgentPresetsApi {
  /**
   * Lists every preset the deployment currently supplies, in root-precedence
   * order — the roots as configured, each root's own presets sorted by id,
   * and the first root to supply an id wins. The order is not globally
   * sorted: a user root's preset sits in that root's block, not among the
   * shipped ids.
   * An empty roster means the deployment composes no presets at all, and
   * every session shares the host composition. `authorable` reports whether
   * the deployment configures a root new presets can be written to, and
   * `hasDocument` whether `openDocument` can hand a preset directory to a
   * native opener — both deployment facts rather than per-preset ones, and
   * neither exposes a Host path.
   */
  list(request: RpcRequest<{}>):
  Promise<RpcResponse<{ presets: readonly AgentPresetEntry[]; authorable: boolean; hasDocument: boolean }>>

  /**
   * Recompose one session's agent from a different preset.
   *
   * Allowed only while the session is blank — no turn has run. Once a
   * conversation starts, its history was produced under that preset's tools,
   * and swapping them would leave logged tool calls the new composition cannot
   * make; the attempt answers `agent-preset-locked`.
   */
  select(request: RpcRequest<{ sessionId: SessionId; agentPreset: string }>):
  Promise<RpcResponse<{ agentPreset: string }>>

  /**
   * Read one preset's composition text, for the read-only viewer.
   *
   * Privileged: a composition names the plugins a session runs, so reading
   * one is reconnaissance.
   */
  read(request: RpcRequest<{ agentPreset: string }>):
  Promise<RpcResponse<{
    agentPreset: string
    trust: 'system' | 'user'
    content: string
    name?: string
    description?: string
  }>>

  /**
   * Create a locally authored preset by copying an existing one whole.
   *
   * The only authoring write. No composition text and no path crosses the
   * wire: `from` and `agentPreset` are ids the Host resolves against its own
   * roots, so a copy is exactly as loadable as its source and grants nothing
   * the roster did not already carry. The copy keeps the source's description
   * (the file is the author's to edit afterwards) but not its name — `name`
   * here or the id fallback is what distinguishes the rows.
   */
  copy(request: RpcRequest<{ from: string; agentPreset: string; name?: string }>):
  Promise<RpcResponse<{ agentPreset: string }>>

  /**
   * Hand one locally authored preset's DIRECTORY to the platform opener, for
   * editing the files that are now the only composition editor. The request
   * carries an id, never a path — the Host resolves it — so no browser
   * payload can select an arbitrary filesystem target. Where the deployment
   * has no native opener (`hasDocument: false` on `list`), the reply carries
   * the resolved directory for the surface to show as text instead. Shipped
   * presets are refused: their install is not the user's to manage.
   */
  openDocument(request: RpcRequest<{ agentPreset: string }>, signal: AbortSignal):
  Promise<RpcResponse<{ opened: true } | { opened: false; path: string }>>

  /** Delete a locally authored preset. Shipped presets are refused. */
  remove(request: RpcRequest<{ agentPreset: string }>): Promise<RpcResponse<{}>>
}
