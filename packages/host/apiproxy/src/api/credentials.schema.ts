/**
 * @file `credentials` domain 的 zod schema。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **schema 名从 `rpc-map.ts` 派生**：`credentialsDescribeRequestSchema`
 *     / `credentialsDescribeValueSchema` / `credentialsSet*` / `credentialsUnset*`
 *     机械对应。加 method 时三处（`rpc-map.ts` + 本文件 + `credentials.ts`）
 *     都得改。
 *   - **`credentialRefNameSchema` 镜像 `dsh-credentials` 的 `credentialRef`
 *     pattern**：`/^[A-Za-z_][A-Za-z0-9_]*$/`——POSIX-portable env var name
 *     风格。**所有** request payload 的 `ref` 字段都过这同一份 schema
 *     （`describe` / `set` / `unset`）。`bad-request` 在 wire 边界
 *     fail loud——不合法 ref **不**进 host 端 service。
 *   - **`describe.refs.max(64)`**：批量拉 credential 状态有上界——避免
 *     「client 一次发 10000 个 ref 把 host 拉爆」。
 *   - **`set.value: z.string().min(1)`**：**唯一**一个 value 跨 wire
 *     的地方。`min(1)` 保证「我**没**打算传值」也得显式 break 一次
 *     （**不**能让「传空字符串 = 隐式 unset」这种语义混入）。
 *   - **`set` / `unset` 返 `z.object({})`**：write response **只** ack，
 *     **不**返新 view（避免把刚刚写过的 value 通过 describe-style 视图
 *     漏出来——`describe` 已经走「configured / source / writable」的
 *     **三**字段 schema，**不**带 value）。
 *
 * 与其他模块的连接点：
 *   - `rpc-map.ts` 的 `RequestPayload` / `ResponseValue`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `credentials.ts` 是 type-only 入口
 *   - `dsh-credentials` 的 `credentialRef` pattern（被 `credentialRefNameSchema`
 *     镜像）——wire 边界**不**引 `dsh-credentials` 值（**只**镜像 regex），
 *     保持 `api/` 零 host-package 依赖
 *   - `api-proxy.ts` 验 + 翻译
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { CredentialView } from './credentials.ts'

/** POSIX-portable environment-variable name (the seam's `credentialRef` pattern). */
export const credentialRefNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

/** CredentialView entry of credentials.describe. */
export const credentialViewSchema = z.object({
  configured: z.boolean(),
  source: z.string().optional(),
  writable: z.boolean(),
}) satisfies z.ZodType<Wire<CredentialView>>

/** credentials.describe request payload. */
export const credentialsDescribeRequestSchema = z.object({
  refs: z.array(credentialRefNameSchema).max(64),
}) satisfies z.ZodType<Wire<RequestPayload<'credentials.describe'>>>

/** credentials.describe response value. */
export const credentialsDescribeValueSchema = z.object({
  credentials: z.record(z.string(), credentialViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'credentials.describe'>>>

/** credentials.set request payload: the one direction a value crosses this wire. */
export const credentialsSetRequestSchema = z.object({
  ref: credentialRefNameSchema,
  value: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'credentials.set'>>>

/** credentials.set response value. */
export const credentialsSetValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'credentials.set'>>>

/** credentials.unset request payload. */
export const credentialsUnsetRequestSchema = z.object({
  ref: credentialRefNameSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'credentials.unset'>>>

/** credentials.unset response value. */
export const credentialsUnsetValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'credentials.unset'>>>
