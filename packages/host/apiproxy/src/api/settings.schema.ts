/**
 * @file `settings` domain 的 zod schema。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **schema 名从 `rpc-map.ts` 派生**：`settingsDescribeRequestSchema` /
 *     `settingsDescribeValueSchema` / `settingsUpdate*` / `settingsReplace*` 等
 *     **机械**对应 method key——加方法时 `rpc-map.ts` 加一行 + 本文件
 *     加两个 schema，编译期 fail 兜住。
 *   - **`value` / `base` / `user` / `schema` 都 `z.unknown()`**：host
 *     端 seam **已经**做了 `redactSecrets: true` redact，schema 也已经
 *     序列化。在 wire 边界**再**做精细 zod 验就是「在 carrier 知道 host
 *     plugin 的全部 schema」——`api/` 必须是 browser-safe 的「**不**依赖
 *     host plugin」的 contract，**不**能这么做。
 *   - **`settingsPathOpSchema` 是 `discriminatedUnion('op', ...)`**：
 *     `set` 带 `value`，`unset` **不**带——zod 端强制「unset 有 value 是
 *     错的」（语义不清：删了再写回？）。
 *   - **`settingsUpdateValueSchema` / `settingsReplaceValueSchema` /
 *     `settingsMutateValueSchema` 共用 `settingsNamespaceViewSchema`**：
 *     三个 mutation 都返「更新后的 redacted view」——**一**份 schema，
 *     三个 method 引用。
 *   - **`expectedRevision?: number`**：CAS 字段——client 写时带回
 *     上次拿到的 revision，stale 静默覆盖被拒。
 *
 * 与其他模块的连接点：
 *   - `rpc-map.ts` 的 `RequestPayload` / `ResponseValue`
 *   - `rpc.schema.ts` 的 `Wire` envelope
 *   - `settings.ts` 是 type-only 入口
 *   - `api-proxy.ts` 验 + 翻译
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { SettingsNamespaceView, SettingsPathOpView, SettingsSecretView } from './settings.ts'

/** One redacted secret slot. */
export const settingsSecretViewSchema = z.object({
  path: z.array(z.string()),
  set: z.boolean(),
}) satisfies z.ZodType<Wire<SettingsSecretView>>

/** SettingsNamespaceView row of settings.describe and the write responses. */
export const settingsNamespaceViewSchema = z.object({
  ns: z.string().min(1),
  schema: z.unknown(),
  value: z.unknown(),
  base: z.unknown().optional(),
  user: z.unknown().optional(),
  applies: z.union([z.literal('live'), z.literal('restart')]),
  secrets: z.array(settingsSecretViewSchema),
  revision: z.number(),
}) satisfies z.ZodType<Wire<SettingsNamespaceView>>

/** settings.describe request payload. */
export const settingsDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'settings.describe'>>>

/** settings.describe response value. */
export const settingsDescribeValueSchema = z.object({
  writable: z.boolean(),
  hasDocument: z.boolean(),
  namespaces: z.array(settingsNamespaceViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'settings.describe'>>>

/** settings.openDocument request payload. */
export const settingsOpenDocumentRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'settings.openDocument'>>>

/** settings.openDocument response value. */
export const settingsOpenDocumentValueSchema = z.object({
  opened: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'settings.openDocument'>>>

/** settings.update request payload. */
export const settingsUpdateRequestSchema = z.object({
  ns: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'settings.update'>>>

/** settings.update response value: the namespace's new redacted view. */
export const settingsUpdateValueSchema = settingsNamespaceViewSchema satisfies z.ZodType<Wire<ResponseValue<'settings.update'>>>

/** settings.replace request payload. */
export const settingsReplaceRequestSchema = z.object({
  ns: z.string().min(1),
  section: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'settings.replace'>>>

/** One path-addressed edit of settings.mutate. */
export const settingsPathOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: z.array(z.string()), value: z.unknown() }),
  z.object({ op: z.literal('unset'), path: z.array(z.string()) }),
]) as unknown as z.ZodType<Wire<SettingsPathOpView>>

/** settings.mutate request payload. */
export const settingsMutateRequestSchema = z.object({
  ns: z.string().min(1),
  ops: z.array(settingsPathOpSchema),
  expectedRevision: z.number().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'settings.mutate'>>>

/** settings.mutate response value: the namespace's new redacted view. */
export const settingsMutateValueSchema = settingsNamespaceViewSchema satisfies z.ZodType<Wire<ResponseValue<'settings.mutate'>>>

/** settings.replace response value. */
export const settingsReplaceValueSchema = settingsNamespaceViewSchema satisfies z.ZodType<Wire<ResponseValue<'settings.replace'>>>
