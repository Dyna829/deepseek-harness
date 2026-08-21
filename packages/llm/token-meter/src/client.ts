/**
 * @file `dsh-token-meter` 的 client-namespace 类型投影——只放
 * browser-safe 的 projection 类型（`TokenUsageProjection` /
 * `ContextPressureProjection` / `ContextBreakdownProjection`），不引
 * 任何 Node / Cordis 内部。
 *
 * 用法：consumer 的 client 编译 face 写 `import type { ContextPressureProjection }
 * from '@deepseek-ai/dsh-token-meter/client'`，拿到纯类型，**不**带
 * runtime ——server 端用 `dsh-session-projection` 注册的 fold 推算
 * 之后 wire 给 client。
 *
 * 与其他模块的连接点：
 *   - `projection.ts` 是 source of truth
 *   - `dsh-session-projection` 的 wire envelope 通过这层类型发到 client
 */

export type * from './projection.ts'
