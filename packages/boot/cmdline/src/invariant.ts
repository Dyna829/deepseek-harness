/**
 * @file `dsh-cmdline` 的 invariant companion 入口。
 *
 * 本包只暴露两个 launcher-fact 服务（`cmdlineArgs` / `appExit`），不挂长期事件流，
 * `install` 是空实现——没有需要持续守的运行时不变量。如果未来加一个
 * 「app 的 commander subcommand 在挂载后才注册」之类的动态路径，再来扩展。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cmdline'

/** Cordis companion plugin name. */
export const name = 'cmdline-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: `cmdlineArgs` is an immutable launcher fact that any
 * number of ordinary plugins may read. App-owned providers and consumers use
 * normal Cordis service injection, whose missing dependencies are already
 * reported by Loader settlement.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
