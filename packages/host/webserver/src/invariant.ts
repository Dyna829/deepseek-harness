/**
 * @file `dsh-host-webserver` 的 invariant companion 入口。
 *
 * 守的关系：「HTTP / upgrade route 的 register ↔ dispose **必须**对称」——
 * 拥有 route 的 fiber unload 之后，route table **不**能再回答那一条
 * path（**不**然一个 disposed plugin 的 handler 还在被调，反信号）。
 *
 * 关键不变量（写代码容易绕过的）：
 *   - **「检查时机 = 每次 fiber teardown」**：`internal/plugin` 事件
 *     在 `internal/status: UNLOADING` 之后发——本 invariant 在那里
 *     probe。
 *   - **「Probe 用 reserved path」**：注册一条 reserved path route
 *     + 立刻 dispose，再注册**同** path——如果 dispose 漏了，第二
 *     次 register 会**因 duplicate 抛**——「`register(probe)()` 两
 *     次」这条**两**语句是 asymmetry 探针：第一次 cycle 漏 dispose
 *     → 第二次抛。
 *   - **「reserved path 永不污染 table」**：每对 `register(probe)()`
 *     是「register + 立刻 dispose」，table **不**留任何 probe 痕迹。
 *   - **`global: true` listener**：**不**绑特定 service 生命周期——
 *     invariant 在整个 root tree 范围都活。
 *
 * 与其他模块的连接点：
 *   - `index.ts` 的 `register` / `registerUpgrade` 是被 probe 的目标
 *   - `cordis` 的 `internal/plugin` 是触发时机
 *   - 任何 composition 装了 `dsh-host-webserver` 都会自动**装**本
 *     companion（**不**是 optional）
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-webserver'

/** Cordis companion plugin name. */
export const name = 'host-webserver-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * Owned relation: HTTP and upgrade route registrations and their disposers must stay
 * symmetric — after the owning fiber of a registered route unloads, the
 * route table must no longer answer for its path (a stale route would keep
 * serving a disposed plugin's handler). Checked on every fiber teardown
 * (cordis 'internal/plugin'): the service's own registry state is compared
 * against the set of live fibers' registrations indirectly, by probing that
 * dispose really removed the entry — the register() disposer contract.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/plugin', () => {
    const server = ctx.get('webServer') as
      | {
        register(route: { kind: 'exact'; path: string; handler: () => void }): () => void
        registerUpgrade(route: { path: string; handler: () => void }): () => void
      }
      | undefined
    if (server === undefined) return // no webserver row in this composition
    // Register/dispose probe on a reserved path: if dispose leaves the route
    // behind, a second register throws the duplicate error — the asymmetry.
    // Each register(probe)() is one register+dispose cycle, so the probe never
    // leaves residue; a leftover from the first cycle makes the second throw.
    const probe = { kind: 'exact' as const, path: '/__dsh_invariant_probe__', handler: () => {} }
    try {
      server.register(probe)()
      server.register(probe)()
      const upgradeProbe = { path: '/__dsh_invariant_upgrade_probe__', handler: () => {} }
      server.registerUpgrade(upgradeProbe)()
      server.registerUpgrade(upgradeProbe)()
    } catch {
      fail('webServer route disposer left a route registered — route tables and fiber lifecycles diverged')
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
