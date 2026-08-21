/**
 * @file `jobs` domain 的 zod schema——branded `JobId` + `session/jobs`
 * frame 的 wire view。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **`taskIdSchema` 是本域唯一 `JobId` brand cast**：同 DAG 惯例，
 *     **不**自己 `as JobId` 一份。
 *   - **`kind: z.string().min(1)`（**不**是 union）**：producer plugin
 *     通过 declaration merging 扩展 kind map——closed set 在 wire 边界
 *     **不可知**。schema 端**只**验「非空字符串」，不断 unknown kind。
 *   - **`status` 是 closed union 5 个 literal**：状态机是封闭的——client
 *     端可以 safe 渲染 icon / color。
 *   - **`startedAt` / `finishedAt` 强 `int().nonnegative()`**：epoch ms
 *     是非负整数；负数 / 浮点 → `bad-request`。
 *   - **`finishedAt` optional**：live job 还**没**结束，**不**能假装有
 *     结束时间。
 *
 * 与其他模块的连接点：
 *   - `dsh-jobs/brand` 的 `JobId`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `jobs.ts` 是 type-only 入口
 *   - `events.ts` 的 `session/jobs` frame 引用本 schema
 *   - `api-proxy.ts` 验 + 翻译
 */

import { z } from 'zod'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobView } from './jobs.ts'
import type { Wire } from './rpc.schema.ts'

/** JobId: one brand cast after non-empty string validation. */
export const taskIdSchema = z.string().min(1) as unknown as z.ZodType<JobId>

/**
 * One wire task view. `kind` stays an open string because producer plugins
 * extend the registry's kind map by declaration merging, so the closed set is
 * not knowable at this boundary.
 */
export const taskViewSchema = z.object({
  id: taskIdSchema,
  kind: z.string().min(1),
  label: z.string().min(1),
  status: z.union([
    z.literal('running'),
    z.literal('stopping'),
    z.literal('completed'),
    z.literal('killed'),
    z.literal('failed'),
  ]),
  detail: z.string().optional(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<Wire<JobView>>
