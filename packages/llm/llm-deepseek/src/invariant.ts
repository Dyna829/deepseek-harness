/**
 * @file `dsh-llm-deepseek` 的 invariant companion 入口。
 *
 * 本包不暴露独立的 event 序列，也不在 `LlmRuntime` 之外维护可变数据关系——
 * 所有「流式 chunk 符合 `StreamChunk` 协议」的不变量已经在 `dsh-llm`
 * 的 invariant 路径上守了。`install` 留作未来挂「`llm/adapters-updated`
 * 之后必须能 resolve 到一个真实 `deepseek-official` provider」之类
 * 特定不变量时的占位。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-deepseek'

/** Cordis companion plugin name. */
export const name = 'llm-deepseek-invariant'
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
