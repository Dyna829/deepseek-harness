/**
 * @file Agent 包自带的 invariant 插件。
 *
 * 挂在 `ctx.invariants` 服务上，作为 `agent-invariant` 协伴插件。
 * 当前唯一的检查：`agent/status` 事件不能重复发同一个值（无意义的状态切换）。
 *
 * 这是 dsh 的「linter」机制 —— 通过 fail() 把可疑状态报告出来，不影响主流程，
 * 但留下足迹供开发期调试。
 */

/** Package-owned agent lifecycle invariants. @module @deepseek-ai/dsh-agent/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent'

/** Cordis companion plugin name. */
export const name = 'agent-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** Install the agent contribution into its child registration fiber. */
const install: InvariantInstaller = (ctx, fail) => {
  const lastStatus = new WeakMap<Agent, AgentStatus>()
  ctx.on('agent/status', ({ agent, status }) => {
    const previous = lastStatus.get(agent)
    if (previous === status) {
      fail(`agent/status repeated ${status} (no-op transition)`)
    }
    lastStatus.set(agent, status)
  }, { global: true })
}

/**
 * Register the agent invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
