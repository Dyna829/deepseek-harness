/**
 * @file `directory-picker` 包的 invariant 伴生 plugin。
 *
 * 包内没有运行时不变式（词汇表是 stateless 的，filesystem 真正状态在 fs
 * 本身），所以这里只做「包级占位」让 `ctx.invariants` 能识别本包
 */

/** Package-owned invariant companion for the directory-picker seam. @module @deepseek-ai/dsh-host-directory-picker/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-directory-picker'

/** Cordis companion plugin name. */
export const name = 'host-directory-picker-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this stateless Service Definition owns the capability
 * vocabulary, while backends and the RPC consumer own observations.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the directory-picker invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
