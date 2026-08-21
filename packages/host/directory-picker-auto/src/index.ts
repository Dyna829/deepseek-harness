/**
 * @file 启动时按环境自动选「native vs browse」directory-picker 的组合包。
 *
 * 一次性 boot-time 决议，mount 一对 Loader 条目（host backend + client surface）
 * 一起挂到 in-memory root tree：
 *   - host 端：给 `ctx.directoryPicker` 提供 native 或 browse 实现
 *   - client 端：补 ui-workspace 的「选目录」UI 面板
 *
 * 关键不变式：「native」和「browse」互斥——同时挂两个 `ctx.directoryPicker`
 * 实现会冲 Cordis 的 duplicate-service。本包只挂决议**胜出**的那一对，
 * 想钉死某一对就直接用 `-native` 或 `-browse` 而不用 `-auto`。
 *
 * 与其他模块的连接点：
 *   - 输入：ctx.webServer.host（决定 SSH/远程可能性）+ process.env + PATH probe
 *   - 输出：ctx.loader.create({ name }) 两条 mount，dispose 反向 unmount
 *   - 包元数据里 BACKEND_PACKAGES / SURFACE_PACKAGES 是硬编码的常量字符串
 *     词汇表，不是 tunable
 */

/**
 * Adaptive chooser of the directory-picker seam: resolves the host's
 * situation once at boot (bind host, SSH launch, display session, Linux
 * chooser binary) and mounts the matching interaction — `native` or `browse`
 * — as real Loader entries in the in-memory root tree. Each interaction is a
 * pair: the Host backend serving the seam capability and the client surface
 * occupying ui-workspace's directory-flow holes. Both arrive as ordinary
 * entries, so the surface is discovered exactly as a config-row's would be
 * and one resolved choice still swaps both faces; pinning an interaction
 * remains composing that pair directly instead of this row.
 * @module @deepseek-ai/dsh-host-directory-picker-auto
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type imports carry the `loader` and `webServer` Context merges for the reads below.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { canExecute, hasLinuxChooserBinary } from './probe.ts'
import type { DirectoryPickerBackendKind } from './resolve.ts'
import { resolveDirectoryPickerBackend } from './resolve.ts'

export { canExecute, hasLinuxChooserBinary } from './probe.ts'
export type { DirectoryPickerBackendKind, DirectoryPickerEnv, DirectoryPickerHostFacts } from './resolve.ts'
export { resolveDirectoryPickerBackend } from './resolve.ts'

/** Cordis plugin name. */
export const name = 'directory-picker-auto'
/** Required services: the effective bind host (`webServer`) and the entry tree the backend mounts into (`loader`). */
export const inject = ['webServer', 'loader']

/**
 * Host backend package per resolved kind — fixed composition vocabulary, not a
 * tunable. Exported because the reference is a runtime string the static
 * config gate cannot see in a yml row: `verify-cordis-config` requires every
 * app composing this chooser to declare both values as dependencies.
 */
export const BACKEND_PACKAGES: Record<DirectoryPickerBackendKind, string> = {
  native: '@deepseek-ai/dsh-host-directory-picker-native',
  browse: '@deepseek-ai/dsh-host-directory-picker-browse',
}

/**
 * Client surface package per resolved kind, mounted with its backend so one
 * resolved interaction still composes both faces. Declared as dependencies by
 * every composing app for the same reason as {@link BACKEND_PACKAGES}. Only the
 * specifier is referenced here — the packages belong to the Client program, so
 * no import of them exists on this side and knip needs them ignored for this
 * workspace.
 */
export const SURFACE_PACKAGES: Record<DirectoryPickerBackendKind, string> = {
  native: '@deepseek-ai/dsh-client-ui-directory-picker-native',
  browse: '@deepseek-ai/dsh-client-ui-directory-picker-browse',
}

/**
 * Resolve the interaction from one boot-time sample and mount its backend and
 * surface as Loader entries; the effect's disposer removes both entries and
 * joins their fibers' teardown, so unloading this plugin returns only after
 * both faces of the mounted interaction (and their dependents) quiesced.
 * @param ctx - cordis context carrying the injected `webServer` and `loader`.
 */
export async function apply(ctx: Context): Promise<void> {
  const backend = resolveDirectoryPickerBackend({
    bindHost: ctx.webServer.host,
    platform: process.platform,
    env: process.env,
    linuxChooser: hasLinuxChooserBinary(process.env.PATH, canExecute),
  })
  await ctx.effect(async () => {
    // Root-tree create: the Loader root is in-memory (write() is a no-op), so
    // the mounted rows can never be persisted back into a config file. The
    // backend lands first: the surface's browser half drives the capability
    // the backend registers.
    const ids: string[] = []
    const unmount = async () => {
      for (const id of [...ids].reverse()) {
        // Tree teardown (group.stop) can have removed the entry already;
        // nothing is left to unmount or await then.
        if (ctx.loader.store[id] === undefined) continue
        // remove() disposes the entry transactionally, so the chooser's unload
        // signals completion only after that face quiesced.
        await ctx.loader.remove(id)
      }
    }
    try {
      for (const name of [BACKEND_PACKAGES[backend], SURFACE_PACKAGES[backend]]) {
        ids.push(await ctx.loader.create({ name }))
      }
    } catch (cause) {
      // Setup owns the entries it created until it returns the disposer: leaving
      // the backend mounted would make a retry collide with its own
      // directoryPicker registration.
      await unmount()
      throw cause
    }
    return unmount
  }, 'directory-picker-auto: interaction entries')
}
