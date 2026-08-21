/**
 * @file `host` domain contract——描述 host 进程自身的几个 method。
 *
 * 关键设计点（**写代码容易绕过的**）：
 *   - **「No protocol version」**：client 和 host 同步发版。**只有**出现
 *     「independently released client」（独立发版的 client，比如 mobile
 *     / VSCode 插件）时才加 `protocolVersion`——加早了是 YAGNI，加晚
 *     了是 breaking change。
 *   - **「客户端不 join path」**：`DirectoryEntry.path` 是 host 端的**绝对**
 *     路径。**不**让 client 拼 path——host 端 OS 永远准（Windows 路径
 *     / POSIX path / WSL path 混在配置里时 client 拼错的代价是「打开错
 *     文件」），让 client 拼就是埋雷。
 *   - **「hidden 由 host 平台约定判定（dot-prefix on POSIX）」**：client
 *     决定**显示**与否，**不**决定**隐藏**与否。`hidden` 永远是 host
 *     文件系统层的真相。
 *   - **Capability gating**：`pickDirectory` 只在 `native` capability 下
 *     serve；`listDirectory` / `createDirectory` 只在 `browse` capability
 *     下 serve——同一份 contract 在不同 deployment 下暴露的 method 子集
 *     **不一样**。`host.describe` 是**全 deployment 都 serve**的快照。
 *   - **`truncated` 是后端完成结果上界标志**：当 backend 在「完整结果
 *     bound」处裁剪 entries 时为 `true`（name-sorted tail 缺失）。client
 *     拿 `truncated === true` 时该在 UI 上挂「还有更多，refine 搜索」，
 *     **不**当完整目录渲染。
 *   - **`openPath` 受 prefix-wide trust fence 保护**：跟所有其它 `/api`
 *     request 一样，**不**单开一扇「native opener 后门」。这条**不**变
 *     量让「能 native opener」**不**等「能 bypass RPC 信任」——后者永
 *     远要 carrier 的信任 anchor。
 *
 * 与其他模块的连接点：
 *   - `rpc.ts` 的 `RpcRequest` / `RpcResponse` 是签名底
 *   - `rpc-map.ts` 登 `host.*` 5 个 method
 *   - `api-proxy.ts` 调 `native-path-opener.ts` 的 `canOpenNativePath` /
 *     `openNativePath` 实现 `host.openPath`
 *   - `host/directory-picker-*` 实现 `host.pickDirectory` / `host.listDirectory`
 *     / `host.createDirectory`
 *   - `fetch/handler.ts` 翻译 abort signal
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One directory row of a listing: a child entry or a breadcrumb ancestor. */
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  name: string
  /** Absolute host path — the client never joins path segments itself. */
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
}

/** host.listDirectory response value: one directory level plus its ancestry. */
export interface DirectoryListing {
  /** Absolute path of the listed directory. */
  path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  home: string
  /**
   * Ancestor chain from the filesystem root to the listed directory
   * inclusive; every crumb is a jump target (crumb `hidden` is always false).
   */
  crumbs: DirectoryEntry[]
  /** Direct child directories, name-sorted; symlinks to directories included. */
  entries: DirectoryEntry[]
  /** True when the backend cut `entries` at its complete-result bound (the name-sorted tail is absent). */
  truncated: boolean
}

/** Host-level unary methods. */
export interface HostApi {
  /**
   * One-shot host snapshot. Empty payload uses the literal `{}` (extend in place when fields arrive).
   * version = the host app's (apps/cli) package.json version; cwd = the host process working
   * directory (root for session persistence and tool execution); provider/model = the defaults
   * applied when a new agent doesn't specify them explicitly, absent when the host configures
   * no explicit default (the adapter falls back internally);
   * attachedSessions = count of currently attached sessions (those with a live agent);
   * home = the host account home directory (Web display abbreviation on POSIX);
   * canOpenPath = whether this deployment can hand a path to a user-visible native desktop.
   */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{
    version: string
    cwd: string
    provider?: string
    model?: string
    attachedSessions: number
    home: string
    canOpenPath: boolean
  }>>

  /**
   * Open the operating system's single-directory picker; cancellation returns
   * null. Only served under the `native` capability.
   */
  pickDirectory(
    request: RpcRequest<{}>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ path: string | null }>>

  /**
   * List one directory level for the in-app browser; an absent path lists the
   * host account's home directory. Only served under the `browse` capability;
   * unreadable or missing targets fail with `directory-unreadable`. The
   * carrier's request signal follows the caller, stopping the backend's scan
   * on disconnect or timeout.
   */
  listDirectory(
    request: RpcRequest<{ path?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<DirectoryListing>>

  /**
   * Create one child directory under an existing parent (the browser's
   * "New folder"). Only served under the `browse` capability; an existing
   * child fails with `directory-exists`, every other filesystem failure with
   * `directory-create-failed`.
   */
  createDirectory(
    request: RpcRequest<{ path: string; name: string }>,
  ): Promise<RpcResponse<{ path: string }>>

  /**
   * Open a filesystem path with the operating system's default application
   * (Finder / Explorer / xdg-open hand-off). The browser carrier's
   * prefix-wide trust fence covers this privileged method like every other
   * `/api` request.
   */
  openPath(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>>
}
