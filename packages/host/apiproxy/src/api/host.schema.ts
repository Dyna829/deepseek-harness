/**
 * @file `host` domain 的 zod schema。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **schema 名从 `rpc-map.ts` 派生**：`hostDescribe*` /
 *     `hostPickDirectory*` / `hostListDirectory*` / `hostCreateDirectory*` /
 *     `hostOpenPath*` 机械对应。加 method 时三处都得改。
 *   - **`pickDirectory.path: z.string().nullable()`**：null 是「用户
 *     取消 picker」的**正常**语义（**不**是错误），走「OK + path: null」
 *     而不是「error」——区分「picker 没成功」vs「用户在 picker 上按
 *     Cancel」是**显式** wire 语义。
 *   - **`describe.attachedSessions: z.number().int().nonnegative()`**：
 *     整数 ≥ 0；负数 / 浮点 → `bad-request`。
 *   - **`describe.provider / model: optional`**：host 配置**没**有
 *     explicit default 时**不**返（让 adapter 内部 fallback）——schema
 *     端**不**「永远返一个」骗 UI。
 *   - **`describe.canOpenPath: z.boolean()`**：直返 host capability
 *     探测结果；**不**是「client 自己去试一次」——前者早知道，避免
 *     「UI 上能点但点了 401」的反信号。
 *
 * 与其他模块的连接点：
 *   - `rpc-map.ts` 的 `RequestPayload` / `ResponseValue`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `host.ts` 是 type-only 入口
 *   - `native-path-opener.ts` 提供 `canOpenPath` 探测
 *   - `host/directory-picker-native` / `-browse` / `-auto` 提供 picker 实现
 *   - `api-proxy.ts` 验 + 翻译
 */

import { z } from 'zod'
import type { DirectoryEntry } from './host.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** host.describe request payload (empty object literal). */
export const hostDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.describe'>>>

/** host.describe response value. */
export const hostDescribeValueSchema = z.object({
  version: z.string(),
  cwd: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  attachedSessions: z.number().int().nonnegative(),
  home: z.string(),
  canOpenPath: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.describe'>>>

/** host.pickDirectory request payload (empty object literal). */
export const hostPickDirectoryRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.pickDirectory'>>>

/** host.pickDirectory response value; null means the user cancelled. */
export const hostPickDirectoryValueSchema = z.object({
  path: z.string().nullable(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.pickDirectory'>>>

/** Directory row shared by listing entries and breadcrumb crumbs. */
export const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  hidden: z.boolean(),
}) satisfies z.ZodType<Wire<DirectoryEntry>>

/** host.listDirectory request payload; an absent path lists the home directory. */
export const hostListDirectoryRequestSchema = z.object({
  path: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'host.listDirectory'>>>

/** host.listDirectory response value. */
export const hostListDirectoryValueSchema = z.object({
  path: z.string(),
  home: z.string(),
  crumbs: z.array(directoryEntrySchema),
  entries: z.array(directoryEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.listDirectory'>>>

/** host.createDirectory request payload: name must be one plain path segment. */
export const hostCreateDirectoryRequestSchema = z.object({
  path: z.string(),
  name: z.string(),
}).refine(
  payload => payload.name.trim() !== '' && payload.name !== '.' && payload.name !== '..'
    && !/[/\\]/.test(payload.name),
  { message: 'host.createDirectory requires a single non-blank path segment name' },
) satisfies z.ZodType<Wire<RequestPayload<'host.createDirectory'>>>

/** host.createDirectory response value: the created directory's absolute path. */
export const hostCreateDirectoryValueSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.createDirectory'>>>
/** host.openPath request payload. */
export const hostOpenPathRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.openPath'>>>

/** host.openPath response value. */
export const hostOpenPathValueSchema = z.object({
  opened: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'host.openPath'>>>
