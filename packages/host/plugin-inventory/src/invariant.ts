/**
 * @file `dsh-host-plugin-inventory` 的 invariant companion 入口。
 *
 * 本包**没**有运行时挂的不变量——每条 snapshot 都**直接**从 Loader-owned
 * state 投影（`ctx.loader.entries()` 走 `internal/plugin` 维护的内部
 * 真相），**没**有第二份 cache 可漂。「inventory = loader 投影」是
 * by-construction 关系，**不**需要 runtime 守。
 *
 * `install` 留作未来挂「`entries()` 必须非空」之类**装配期**不变量时的
 * 占位。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-plugin-inventory'

/** Cordis companion plugin name. */
export const name = 'host-plugin-inventory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: every snapshot is projected directly from Loader-owned state. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
