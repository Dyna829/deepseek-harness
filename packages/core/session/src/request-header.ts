/**
 * @file 从 session log 重建「某次 LLM 请求的 header」。
 *
 * 背景：loop 每次发 LLM 请求前，会把「这次请求的关键配置（model、temperature、maxTokens、
 * system prompt、tools…）」冻结成一个 `EpochHeader`，append 一条 `request/header` 事件。
 * 之后从该事件起，直到下次 `request/header` 之前，所有 LLM 请求都用这个 header。
 *
 * 本文件工具：
 *   - `canonicalHeader(h)`：把 header 规约成 canonical 形态（空 system 提示 / 空 tools 列表变成
 *     「缺失」字段，和「请求实际构建时」一致）；
 *   - `foldRequestHeader(events)`：从 log 倒着找最近一条 `request/header`，返回它的 canonical 形态；
 *   - `headerEquals(a, b)`：判断两个 header 是否完全相同（避免无变化的 header 重复 append）。
 *
 * 用途：replay 的时候，「当时那个 LLM 请求」是「最近的 header + 当时的 messages」拼出来的，
 * 所以 fold header 是 log 重建的核心工具。
 */

/**
 * Request-header reconstruction utilities over full `request/header` session
 * events. Anyone holding a session log reconstructs the {@link EpochHeader}
 * any request was built under by taking the latest canonical snapshot; the
 * loop uses the same equality helper to avoid logging unchanged headers.
 *
 * @module dsh-session/request-header
 */

import { callConfigEquals } from '@deepseek-ai/dsh-llm'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { EpochHeader, SessionEvent } from './types.ts'

/**
 * Normalize a header to canonical form: an empty system prompt and empty tool
 * list become absent fields, matching how requests are built. Logging, folding,
 * and comparison use this one representation.
 * @param header - the header to normalize (not mutated).
 * @returns the canonical header.
 */
export function canonicalHeader(header: EpochHeader): EpochHeader {
  const adapterDefaults = header.adapterDefaults
  return {
    config: header.config,
    ...adapterDefaults?.reasoningEffort === true || adapterDefaults?.maxTokens === true
      ? { adapterDefaults }
      : {},
    ...header.system !== undefined && header.system.length > 0 ? { system: header.system } : {},
    ...header.tools !== undefined && header.tools.length > 0 ? { tools: header.tools } : {},
  }
}

/** Canonical JSON equality for tool schemas assembled through the same path. */
function sameSchema(a: ToolSchema, b: ToolSchema): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Field-wise equality over canonical headers. Tool schemas compare in order.
 * @param a - one canonical header.
 * @param b - the other.
 * @returns whether config, system, and tools all match.
 */
export function headerEquals(a: EpochHeader, b: EpochHeader): boolean {
  if (
    !callConfigEquals(a.config, b.config)
    || a.adapterDefaults?.reasoningEffort !== b.adapterDefaults?.reasoningEffort
    || a.adapterDefaults?.maxTokens !== b.adapterDefaults?.maxTokens
    || a.system !== b.system
  ) return false
  const at = a.tools ?? []
  const bt = b.tools ?? []
  return at.length === bt.length && at.every((tool, i) => sameSchema(tool, bt[i] as ToolSchema))
}

/**
 * Fold the header events of a log (or any prefix) into the
 * {@link EpochHeader} in force after the last snapshot. Non-header events are
 * skipped. This is the pure offline reconstruction path; the live session
 * tracks the same fold incrementally.
 * @param events - session events in log order.
 * @param from - a previously folded state to continue from.
 * @returns the latest canonical header, or undefined when none exists yet.
 */
export function foldRequestHeader(events: readonly SessionEvent[], from?: EpochHeader): EpochHeader | undefined {
  let state = from
  for (const event of events) {
    if (event.type === 'request/header') state = canonicalHeader(event.data.header)
  }
  return state
}
