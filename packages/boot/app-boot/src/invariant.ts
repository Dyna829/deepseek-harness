/**
 * @file `dsh-app-boot` 的 invariant companion 入口。
 *
 * 本包是「boot glue」——把 env 加载、Loader 挂载、HMR 起来、profile 层组合这些
 * 早期一次性事件做对。它自己不暴露长期 Service（`installFailLoud` /
 * `loadLayeredEnv` / `mountRootInclude` 都是函数），所以目前**没有**运行时
 * 不变量要守——`install` 是空实现，配套的协议映射在 boundary / replay
 * 测试里覆盖。如果未来加一个「挂在 boot 期」的状态机（例如 launcher 事件总线），
 * 就在 `install` 里加监听即可。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-app-boot'

/** Cordis companion plugin name. */
export const name = 'app-boot-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this presentation adapter owns no durable package-local event stream;
 * boundary and replay tests cover its protocol mapping.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
