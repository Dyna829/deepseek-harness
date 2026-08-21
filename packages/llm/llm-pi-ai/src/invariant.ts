/**
 * @file `dsh-llm-pi-ai` 的 invariant companion 入口。
 *
 * 本包不暴露独立 event 序列；流式 chunk 协议不变量已经在 `dsh-llm` 的
 * invariant 路径上守。`install` 留作未来挂「`llm/adapters-updated` 之后
 * 任何 profile 必须能 build 成一个真实 `Provider`」之类特定不变量时的
 * 占位。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-pi-ai'

/** Cordis companion plugin name. */
export const name = 'llm-pi-ai-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
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
