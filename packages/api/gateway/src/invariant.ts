/**
 * @file `dsh-api-gateway` 的 invariant companion 入口。
 *
 * 本包没有需要持续守的运行时不变量：`ctx.typertGateway` 每次 invoke 都**重新
 * 读**权威的 Cordis Services + Typert 注册表（不是缓存的快照），`ctx.remote`
 * 的客户端 mutations（`$mount` / `$on`）都跑在单一 owned effect 里序列化。
 * 协议/契约的边界在 `dsh-typert-protocol` / connection 测试里覆盖。
 * `install` 留作未来在 `/api` RPC 拦截器或 Service 注册期挂不变量时的占位。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-api-gateway'

/** Cordis companion plugin name. */
export const name = 'api-gateway-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Host calls re-read authoritative Cordis and Typert
 * state, while Client methods, descriptors, and `$on` subscriptions mutate in
 * one owned effect.
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
