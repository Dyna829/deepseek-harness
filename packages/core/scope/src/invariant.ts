/**
 * @file scope 包自带的 invariant：拦截「scope 路由错配」的事件分发。
 *
 * 检查项：
 *   1. 任何「scope 过滤事件」（如 `agent/*`）dispatch 时**必须**带 scope carrier 作为 `this`；
 *      没有就是 fail，提示用 `agentEvents(ctx, agent)` 而不是直接发；
 *   2. carrier 的 key 必须等于 payload 里的主体对象（不能拿 A 的 carrier 发 B 的事件）。
 *
 * 监听的是 `internal/dispatch`，是 Cordis 内部的钩子，所以能在事件真的到监听者之前
 * 拦下来。
 */

/** Package-owned scoped-dispatch invariants. @module @deepseek-ai/dsh-scope/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { carrierKeyOf, isScopeCarrier } from '@deepseek-ai/dsh-scope'
import { scopedSubjectResolverFor } from './scoped-events.generated.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-scope'

/** Cordis companion plugin name. */
export const name = 'scope-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** Install the scoped-dispatch contribution into its child registration fiber. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/dispatch', (_mode, eventName, args, thisArg) => {
    const subjectOf = scopedSubjectResolverFor(eventName)
    if (subjectOf === undefined) return
    if (!isScopeCarrier(thisArg)) {
      fail(
        `"${eventName}" is a scope-filtered event but was dispatched without a scope carrier — `
        + 'pass scopeTarget(base, subject) as the dispatch thisArg (agent events: use agentEvents(ctx, agent))',
      )
    }
    if (subjectOf !== null && carrierKeyOf(thisArg) !== subjectOf(args)) {
      fail(
        `"${eventName}" was dispatched with a scope carrier keyed to a DIFFERENT subject than its arguments name — `
        + 'the carrier key and the event\'s subject must be the same object (use agentEvents(ctx, agent))',
      )
    }
  }, { global: true })
}

/**
 * Register the scope invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
