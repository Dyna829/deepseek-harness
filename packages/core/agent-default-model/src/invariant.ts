/**
 * @file agent-default-model 包的 invariant —— **故意为空**。
 *
 * 原因：本服务没有任何独立的事件关系 —— 所有可变值在 `currentSelection()` 看到之前
 * 就已经被 settings 校验过了。空 installer 是为了在组合 invariant 集合时显式表达
 * 「这里没有需要检查的事」。
 */

/**
 * Package-owned invariant companion for the default Agent model selection.
 *
 * The service owns no independent event relationship: settings registration
 * already validates every mutable value before `currentSelection()` can observe it.
 * The empty installer keeps that absence explicit in composed invariant sets.
 *
 * @module @deepseek-ai/dsh-agent-default-model/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-default-model'

/** Cordis companion plugin name. */
export const name = 'agent-default-model-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: settings validation owns the only mutable-value relationship. */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
