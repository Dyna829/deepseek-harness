/**
 * @file `dsh-host-plugin-inventory` 的「Trusted-client 公开 vocabulary」。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **`PluginFiberPhase` 是 closed union + `null`**：`pending` / `loading`
 *     / `active` / `failed` / `unloading` 是**真**状态；`null` =
 *     「entry 没有 live root fiber」（disposed 阶段或 group container）—
 *     `null` 而**不**是 `'disposed'`，**避免**让 client 看到「X is
 *     disposed」当成可 toggle 状态。
 *   - **`enabled` 是「effective」值**：含 disabled ancestor group 的
 *     inherited 效果——client 看到的**不是**「这一项自己 enabled 没」，
 *     而是「**真**的能不能跑」。
 *   - **`PluginEntryId` brand 是 nominal typing**：跟 `SessionId` /
 *     `WorkspaceId` 等同惯例——零 runtime 成本，纯静态挡「把 entry id
 *     当成 session id 传」之类的 bug。
 *   - **`moduleName` 是 Loader 实际 import 的 specifier**（**不**是
 *     `name`）：UI 上想看「import 的是哪个 module」**真**拿这个字段。
 *
 * 与其他模块的连接点：
 *   - `dsh-brand` 提供 `Branded<B>` 原始类型
 *   - `index.ts` 的 `PluginInventoryGateway.list()` 是**唯一**产
 *     `PluginInventorySnapshot` 的地方
 *   - `dsh-host-plugin-inventory/remote` 在 client 端消费这些类型
 *   - `events.ts` 的 `cordis/...` 转发 frame 也引这套 vocabulary
 */

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}
