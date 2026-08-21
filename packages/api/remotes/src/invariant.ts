/**
 * @file `dsh-api-remotes` 的 invariant companion 入口。
 *
 * 本包没有需要持续守的运行时不变量：身份解析路径走「每次重新读
 * `ctx.agents` / `ctx.sessions` / `ctx.sessionPersistence`」的策略，事件
 * 转发走单一 allowlist（编译期就钉死），subagent 栅栏在 `agent-lookup.ts`
 * 的多处判定里覆盖。`install` 留作未来挂「转发循环」或「`$mount` 生命周期」
 * 之类观测的占位。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-api-remotes'

/** Cordis companion plugin name. */
export const name = 'api-remotes-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: Typert and the Agent/Session registries own the observed relationships. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
