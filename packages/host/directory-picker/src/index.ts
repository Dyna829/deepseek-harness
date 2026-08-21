/**
 * @file 目录选择(workspace 选定)的 `ctx.directoryPicker` 能力 seam 入口。
 *
 * 本包**只**定义词汇表 + 抽象服务——具体走「OS 原生 chooser」还是「应用内
 * 浏览器列目录」由 backends 实现：
 *   - `directory-picker-native`  / `...-browse` 是两个**互斥**的 backend
 *   - `directory-picker-auto` 启动时按环境（SSH/绑 host/有无 zenity）选一个挂上
 *
 * 与其他模块的连接点：
 *   - 这是一个合并可扩展(discriminated union)的 capability——后端新增 kind
 *     用 declaration merging 扩 `DirectoryPickerCapabilities` 即可
 *   - 消费者（如 web UI）`switch` on `capability().kind`；未知 kind 按文档应
 *     隐藏入口而不是 fail
 *   - 不与具体 filesystem 路径解析耦合：browse backend 强制全限定路径
 */

/**
 * Service Definition for the `ctx.directoryPicker` capability seam: how the web-GUI host lets an operator
 * select a workspace directory. Backends differ in interaction shape, not
 * just mechanism, so the service exposes a discriminated capability instead
 * of one method set: a `native` backend opens one OS chooser on the
 * host's display, while a `browse` backend serves listing/creation primitives
 * for an in-app browser (and thereby works for remote clients no OS dialog
 * can reach). Consumers switch on `capability().kind`; the union is
 * merge-extensible, and the documented default for an unknown kind is to
 * hide the picking affordance rather than fail.
 * @module @deepseek-ai/dsh-host-directory-picker
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** The native interaction: one OS directory chooser on the host display. */
export interface DirectoryPickerNativeCapability {
  kind: 'native'
  /**
   * Open the chooser and wait for the operator.
   * @param signal - caller/connection lifetime; abort terminates the chooser.
   * @returns the chosen absolute path, or null when the operator cancels.
   */
  pick(signal: AbortSignal): Promise<string | null>
}

/** One directory row: a listing child or a breadcrumb ancestor. */
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  name: string
  /** Absolute host path — clients never join path segments themselves. */
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
}

/** One directory level plus its ancestry, as a browse backend reports it. */
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
  /**
   * True when the backend cut `entries` at its complete-result bound: the
   * level has more child directories than reported, and the missing rows are
   * the name-sorted tail (hidden rows count toward the bound).
   */
  truncated: boolean
}

/**
 * The browse interaction: listing/creation primitives an in-app browser
 * drives one level at a time. Works for remote clients — nothing renders on
 * the host display.
 */
export interface DirectoryPickerBrowseCapability {
  kind: 'browse'
  /**
   * List one directory level.
   * @param path - absolute directory to list; absent lists the home directory.
   * @param signal - caller lifetime; abort stops the scan (a stalled network
   * directory must not outlive a disconnected caller) and rejects with the
   * abort reason.
   * @returns the level's listing with ancestry; backends bound the complete
   * result, and a cut level reports `truncated`.
   * @throws {DirectoryPickerError} `directory-unreadable` when the target is not fully
   * qualified (a wire value must never resolve against the host cwd or, on
   * Windows, its current drive) or cannot be listed.
   */
  list(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create one child directory under an existing parent.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment (no separators, not `.`/`..`).
   * @returns the created directory's absolute path.
   * @throws {DirectoryPickerError} `directory-exists` for an existing child,
   * `directory-create-failed` for a parent that is not fully qualified or any other failure.
   */
  createDirectory(path: string, name: string): Promise<string>
}

/**
 * Merge-extensible registry of interaction shapes keyed by capability kind: a
 * new backend declaration-merges its shape here (the entry's `kind` literal
 * must equal its key) instead of editing this package.
 */
export interface DirectoryPickerCapabilities {
  native: DirectoryPickerNativeCapability
  browse: DirectoryPickerBrowseCapability
}

/** Union of interaction shapes a backend can provide, derived from the merge-extensible {@link DirectoryPickerCapabilities} map. */
export type DirectoryPickerCapability = DirectoryPickerCapabilities[keyof DirectoryPickerCapabilities]

/** Closed failure vocabulary of the browse primitives (mirrored onto the wire by consumers). */
export type DirectoryPickerErrorCode = 'directory-unreadable' | 'directory-exists' | 'directory-create-failed'

/** Typed failure thrown by browse primitives so consumers can map business codes without string matching. */
export class DirectoryPickerError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param path - the absolute path the failure is about.
   * @param message - operator-facing description.
   */
  constructor(readonly code: DirectoryPickerErrorCode, readonly path: string, message: string) {
    super(message)
    this.name = 'DirectoryPickerError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    directoryPicker: DirectoryPicker
  }
}

/**
 * Abstract directory-picking service. Subclass, implement `capability()`, and
 * load the subclass as a plugin — it registers as `ctx.directoryPicker` (one
 * implementation per context; loading a second throws, cordis' standard
 * duplicate-service behavior). The capability object must be stable for the
 * service lifetime: consumers may capture it across calls.
 *
 * @description 中文说明：
 *   服务定义的抽象基类。每个 backend（`native` / `browse`）是它的一个
 *   子类；plugin 加载时自动注册成 `ctx.directoryPicker`。`capability()`
 *   返回的对象**必须**在服务生命周期内保持同一引用（消费者可能跨调用捕获
 *   它），所以一般用 frozen 字段而不是每次新建。
 */
export abstract class DirectoryPicker extends Service {
  constructor(ctx: Context) {
    super(ctx, 'directoryPicker')
  }

  /**
   * The backend's interaction capability.
   * @returns the discriminated capability consumers switch on.
   */
  abstract capability(): DirectoryPickerCapability
}

export default DirectoryPicker
