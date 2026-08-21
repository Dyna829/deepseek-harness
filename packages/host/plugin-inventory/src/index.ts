/**
 * @file 「当前 Cordis Loader plugin entries」的**只读**投影。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「Read the Loader **直接** on every call」**：`@Remote('list')`
 *     **不**维护第二份 cache——`internal/plugin` / `internal/status` 已经
 *     让 `Entry.fiber` 和 `Fiber.state` 保持正确，自己再 cache 一份等于
 *     「让**两份** lifecycle 真相保持同步」（迟早漂）。
 *   - **「group 跳过」**：`if (entry.options.group) continue`——`group`
 *     在 Loader 里是「一组 entry 的逻辑打包」而不是**真**的 plugin（**没**
 *     单独 lifecycle / 单独 module），不让它进「plugin 列表」避免 client
 *     误以为它是可 toggle 的 plugin。
 *   - **`FIBER_STATE` / `FIBER_PHASE` 是 cross-package const enum 的本地
 *     mirror**：Cordis `FiberState` 是**跨包** const enum，consumer
 *     编译**不一定**抹除（保留行为 / isolatedModules 不一致）——本地
 *     mirror 让 zod schema 用普通 `Record<FiberState, PluginFiberPhase>`
 *     类型，**不**依赖 enum 的具体值。
 *   - **`DISPOSED` 翻 `null` 而**不**是 `'disposed'`**：`PluginFiberPhase`
 *     公开「active / inactive」二分——`DISPOSED` 状态**应该**从列表
 *     里消失（**不**让 client 看到「X is disposed」），用 `null` 让
 *     `fiberPhase` 字段语义化「现在没有 active fiber」。
 *
 * 与其他模块的连接点：
 *   - `@deepseek-ai/cordis-plugin-loader` 提供 `ctx.loader.entries()`
 *   - `dsh-typert-protocol` 的 `TypertRemoteService` / `@Remote` decorator
 *     让本类自动注册成 `ctx.pluginInventory` Remote gateway
 *   - `ctx.loader` 在 `inject` 里——确保 Loader 已 ready 才 expose 视图
 *   - Client 端 `dsh-host-plugin-inventory/remote` 是 Typert 自动生成的
 *     client 装配
 *   - `events.ts` 的 `cordis/...` 转发事件（dynamic package / inspect
 *     query 等）共用同 loader 视图
 */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
  }
}

export default PluginInventoryGateway
