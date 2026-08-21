/**
 * @file 固定密度 heuristic token 定价，被 meter service 和 context-breakdown
 * projection **共用**——这样两处 surface 算「同一段 content」永远算成
 * 「同一个数字」。
 *
 * 关键设计点（**写代码容易绕过的**）：
 *   - **不调真实 tokenizer**：固定 `CHARS_PER_TOKEN = 4` + 每 block
 *     `BLOCK_OVERHEAD = 4`（JSON framing / type tag）+ 每 message
 *     `ROLE_OVERHEAD = 4`（role 字段）。**任何** 跟具体 model tokenizer
 *     走都会让 meter 和 projection 给出**不同**数字（不同 provider / 不同
 *     模型的 tokenizer 不一样），破坏「两处对账」的不变量。
 *   - **递归 `tool-result`**：tool-result 内嵌 content 递归调用
 *     `estimateContent`——meter 和 projection **必须**看到同一棵子树。
 *   - **未知 block 走 `JSON.stringify` 兜底**：`ContentBlockMap` 是
 *     declaration-merged union，下游插件加新变体是合法的（见
 *     `dsh-llm/types.ts` 的 `MappableMappedInterface` 设计）；本文件
 *     不在 switch 里 `assertNever`，而是「`JSON.stringify` 整个 block
 *     按 char 数算 + 基础 overhead」——保证任何**合法**的 block 都拿得到
 *     估值，**不**会因为新变体让 meter 算 0 误导。
 *   - **`estimateSystemTokens` / `estimateToolsTokens` 都按 `0` 兜底**：
 *     `header === undefined` / 字段 absent 时返回 0，**不**抛——meter
 *     在「还没有任何 request」时调用也合法。
 *
 * 与其他模块的连接点：
 *   - `dsh-llm.ContentBlock` / `Message` 是输入
 *   - `dsh-session.EpochHeader` 是 `estimateHeader` 输入
 *   - `index.ts` 的 `TokenMeter` 在 anchor 缺失路径上调 `estimateHeader`
 *   - `breakdown-projection.ts` 的 projection 调同一套 `estimateContent`
 */
 *
 * @module @deepseek-ai/dsh-token-meter/estimate
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { EpochHeader } from '@deepseek-ai/dsh-session'

/** Fixed text-density estimate used until exact tokenization is needed. */
const CHARS_PER_TOKEN = 4

/** Per-block structural overhead for JSON framing and type tags. */
const BLOCK_OVERHEAD = 4

/** Role-field framing overhead added to every priced message. */
export const ROLE_OVERHEAD = 4

/**
 * Price content blocks recursively under the fixed density heuristic.
 * @param blocks - content blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN)
          + Math.ceil(block.arguments.length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD
        break
      case 'tool-result':
        tokens += estimateContent(block.content) + BLOCK_OVERHEAD
        break
      default:
        // ContentBlockMap is merge-extensible; unknown blocks retain a
        // conservative structural JSON price under the fixed heuristic.
        tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
    }
  }
  return tokens
}

/**
 * Heuristically price one model-visible message.
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed heuristic.
 */
export function estimateMessage(message: Message): number {
  return estimateContent(message.content) + ROLE_OVERHEAD
}

/**
 * Price the system-prompt part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic system-prompt tokens; 0 when absent.
 */
export function estimateSystemTokens(header: EpochHeader | undefined): number {
  if (header?.system === undefined) return 0
  return Math.ceil(header.system.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD
}

/**
 * Price the tool-schema part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic tool-schema tokens; 0 when absent or empty.
 */
export function estimateToolsTokens(header: EpochHeader | undefined): number {
  if (header?.tools === undefined || header.tools.length === 0) return 0
  return Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
}

/**
 * Price the complete non-surface request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic system plus tool tokens.
 */
export function estimateHeader(header: EpochHeader | undefined): number {
  return estimateSystemTokens(header) + estimateToolsTokens(header)
}
