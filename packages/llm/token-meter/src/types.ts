/**
 * @file token-meter 的公开配置 + measurement 词表。
 *
 * 关键设计点：
 *   - **`TokenMeterConfig = Record<string, never>`**：plugin 故意**不**
 *     暴露任何 settings；estimator 是固定的（heuristic 估值就一个），加
 *     配置面只会变成「用户乱调参数 vs 误诊」的入口。`validateConfigKeys`
 *     在 `index.ts` 里对**任何** key 抛错——「sneaky key」也拒。
 *   - **`TokenMeasurementBaseline` 三种 kind**：
 *     - `none`（token=0）—— 没有 anchor 也没有 surface，纯空状态；
 *     - `estimated`（heuristic 算的 token）—— 没用过 provider usage 时；
 *     - `usage`（provider 真报的 `TokenUsage`）—— 信任 provider，但**附带
 *       原始 `TokenUsage` 给 UI**（让用户能看到 input / cache / output 拆解，
 *       不是只有一个总数）。
 *   - **`TokenMeasurement.logRevision`**：consumer 拿到这次读数时，token
 *     meter 已经读到 session event 的**第 N 条**（`consumedEvents`）。
 *     拿来 cache / 同步判断「这个 measurement 之后我又读了几个 event」。
 *   - **`TokenSurfaceNode.seq`**：surface 节点**不**是 position，而是
 *     「它投影自哪条 durable event」——**带** seq 让 invariant 能 trace
 *     回原始 log，重放时重建表面。
 *
 * 与其他模块的连接点：
 *   - `dsh-llm.TokenUsage`（`usage` 字段的 schema）
 *   - `index.ts` 构造时验证配置、注册 projection
 *   - `projection.ts` 派生三个 projection type
 */
 *
 * @module @deepseek-ai/dsh-token-meter/types
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'

export type { ContextBreakdownProjection, ContextPressureProjection, TokenUsageProjection } from './projection.ts'

/** Token-meter plugin configuration; the fixed estimator has no settings. */
export type TokenMeterConfig = Record<string, never>

/** The baseline from which a signed surface delta produces current pressure. */
export type TokenMeasurementBaseline =
  | { readonly kind: 'none'; readonly tokens: 0 }
  | { readonly kind: 'estimated'; readonly tokens: number }
  | { readonly kind: 'usage'; readonly tokens: number; readonly usage: Readonly<TokenUsage> }

/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
export interface TokenMeasurement {
  /** Number of durable events consumed; equal to the next unread event seq. */
  readonly logRevision: number
  /** Provider or heuristic anchor used for this measurement. */
  readonly baseline: TokenMeasurementBaseline
  /** Signed repricing of current surface content relative to the baseline anchor. */
  readonly surfaceDeltaTokens: number
  /** Non-negative current request-and-response pressure. */
  readonly totalTokens: number
  /** Total heuristic tokens across the current surface. */
  readonly surfaceTokens: number
  /** Current surface nodes in positional head-to-tail order. */
  readonly nodes: readonly TokenSurfaceNode[]
}

/** One token-priced node in the current ordered session surface. */
export interface TokenSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Heuristic tokens for the exact message projected by this node. */
  readonly tokens: number
}
