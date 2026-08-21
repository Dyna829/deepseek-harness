/**
 * @file `dsh-host-frontend-static` 的 invariant companion 入口。
 *
 * 本包**没**有运行时挂的不变量——**唯一**的关系是「**一**个 fallback seat」，
 * 但 `internal/plugin` 在 disposing fiber 的 effects **之前** fire，所以
 * 合法 owner 在通知时仍**持**该 seat，**任何**「seat claim」probe 都会在
 * 每次正确 dispose 时假阳性（跟 webserver companion 不一样，**它**的
 * reserved-path probe 永远不会撞上 live registration）。seat register / release
 * 对称性走 real-composition HMR-safety 测试覆盖。
 *
 * `install` 留作未来挂「`distRoot` 必须在 dist index 父目录」之类**装配期**
 * 不变量时的占位。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-frontend-static'

/** Cordis companion plugin name. */
export const name = 'host-frontend-static-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the only owned relation is the single fallback seat,
 * which cannot be probed from the teardown stream — `internal/plugin` fires
 * before the disposing fiber's effects run, so the legitimate owner still
 * holds the seat at notification time and any claim probe would
 * false-positive on every correct disposal (unlike the webserver companion,
 * whose reserved-path probes never collide with a live registration). The
 * seat's register/release symmetry is covered by the package's
 * real-composition HMR-safety test instead.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
