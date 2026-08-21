/**
 * @file 把「adapter 流式吐出的 `StreamChunk`」拼成完整的 assistant `Message`。
 *
 * agent-loop 跑主循环时一边 raw-chunk 落 log（**用来 replay**），一边喂
 * `BlockAssembler`。loop 只在流结束 / 中断之后才 `blocks()` / `message()` 一
 * 次——**不**做 partial-state 探测，因为 partial 是 replay 唯一不关心的状态。
 *
 * 设计要点：
 *   - **容错 delta-only 协议**：有些 provider 不发 `block-start` / `block-end`，
 *     只有 `text-delta` 这种增量；assembler 对此透明。
 *   - **已 `block-end` 闭合的 index 收到新 delta 直接忽略**——「协议层不变量
 *     失败」不能污染已完成的 block，也不能让一个捣乱的 adapter 无限增长内存。
 *   - **双写路径**：`blocks()` 来自自己的 partial 状态；`replayState` 来自
 *     adapter 的私货；两条路径**互不影响**——adapter 重放出来的 chunk 走
 *     同样的 assembly 路径，产同样的内容。
 *
 * 与其他模块的连接点：
 *   - `LlmRuntime.adapterStream` 是 chunk 的来源
 *   - `message.ts` 的 `createMessage` 翻装完成的 blocks 成 assistant `Message`
 *   - agent-loop 持一个实例，跟一次 assistant 步同寿命
 */

import { CallId } from './brand.ts'
import { assertNever } from './never.ts'
import { createMessage } from './message.ts'
import type { Message, MessageSource } from './message.ts'
import type { ContentBlock, FinishReason, ReplayEnvelope, StreamChunk, TokenUsage } from './types.ts'

interface PartialBlock {
  blockType: string
  text: string
  toolCallId?: CallId
  toolCallName?: string
  toolCallArguments: string
  /** Set by `block-end` — authoritative, and freezes the partial. */
  block?: ContentBlock
}

/**
 * Incrementally assembles raw {@link StreamChunk}s into complete
 * {@link ContentBlock}s and a final assistant {@link Message}.
 *
 * The agent loop feeds it while logging raw chunks for replay fidelity, then
 * reads `blocks()` / `message()` / `usage` / `finish` once the stream ends,
 * or `interruptedBlocks()` when cancellation cut the stream short.
 *
 * Tolerant of delta-only protocols (no block-start/end); deltas arriving for
 * an index already closed by `block-end` are ignored (malformed stream) so a
 * misbehaving adapter cannot grow memory or corrupt a completed block.
 */
export class BlockAssembler {
  private partials = new Map<number, PartialBlock>()
  private order: number[] = []
  private _usage: TokenUsage | undefined
  private _finish: FinishReason | undefined
  private _replayState: ReplayEnvelope | undefined

  /**
   * Feed one chunk into the assembly state.
   * @param chunk - the next raw chunk, in stream order.
   */
  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'block-start': {
        if (!this.partials.has(chunk.index)) {
          this.order.push(chunk.index)
          this.partials.set(chunk.index, {
            blockType: chunk.blockType,
            text: '',
            toolCallArguments: '',
          })
        }
        return
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = this.ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning')
        if (partial.block) return // closed by block-end; ignore stragglers
        partial.text += chunk.text
        return
      }
      case 'tool-call-delta': {
        const partial = this.ensure(chunk.index, 'tool-call')
        if (partial.block) return // closed by block-end; ignore stragglers
        partial.toolCallId = chunk.id
        if (chunk.name) partial.toolCallName = chunk.name
        partial.toolCallArguments += chunk.argumentsDelta
        return
      }
      case 'block-end': {
        const partial = this.ensure(chunk.index, chunk.block.type)
        // First close wins; ignoring re-close stragglers keeps streamed output
        // and the final assembled block in agreement.
        if (partial.block) return
        partial.block = chunk.block
        return
      }
      case 'usage': {
        this._usage = chunk.usage
        return
      }
      case 'finish': {
        this._finish = chunk.reason
        this._replayState = chunk.replayState
        return
      }
      default: return assertNever(chunk, 'BlockAssembler.push')
    }
  }

  private ensure(index: number, blockType: string): PartialBlock {
    let partial = this.partials.get(index)
    if (!partial) {
      partial = { blockType, text: '', toolCallArguments: '' }
      this.partials.set(index, partial)
      this.order.push(index)
    }
    return partial
  }

  private assemble(partial: PartialBlock, index: number): ContentBlock {
    if (partial.block) return partial.block
    switch (partial.blockType) {
      case 'text': return { type: 'text', text: partial.text }
      case 'reasoning': return { type: 'reasoning', text: partial.text }
      case 'tool-call': return {
        type: 'tool-call',
        id: partial.toolCallId ?? CallId(`call-${index}`),
        name: partial.toolCallName ?? '',
        arguments: partial.toolCallArguments,
      }
      default: throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`)
    }
  }

  /** Invariant accessor: every index in `order` has a partial. */
  private mustGet(index: number): PartialBlock {
    const partial = this.partials.get(index)
    if (!partial) throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`)
    return partial
  }

  /**
   * The one shared keep/drop decision over all seen blocks: max-token
   * truncation drops tool calls that cannot be executed safely. Emitted blocks
   * and replay metadata both derive from this result, so they cannot disagree.
   */
  private assembled(): { blocks: ContentBlock[]; replay: ReplayEnvelope | undefined } {
    const all = this.order.map(index => this.assemble(this.mustGet(index), index))
    const kept = this.finish.kind === 'max-tokens'
      ? all.map(block => block.type !== 'tool-call')
      : undefined
    const blocks = kept === undefined ? all : all.filter((_, position) => kept[position])
    const envelope = this._replayState
    if (envelope?.blocks === undefined) return { blocks, replay: envelope }
    if (envelope.blocks.length !== all.length) return { blocks, replay: undefined }
    return {
      blocks,
      replay: kept === undefined || blocks.length === all.length
        ? envelope
        : { response: envelope.response, blocks: envelope.blocks.filter((_, position) => kept[position]) },
    }
  }

  /**
   * Assemble all blocks seen so far, in stream order.
   * @returns one block per seen index, except that max-token truncation drops
   *   tool calls that cannot be executed safely; an open block assembles from
   *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
   */
  blocks(): ContentBlock[] {
    return this.assembled().blocks
  }

  /**
   * Assemble the prefix an interrupted stream can safely finalize: closed and
   * open text/reasoning blocks with non-whitespace content, in stream order.
   * Tool calls are omitted because interruption precedes dispatch; retaining
   * one would require a fabricated result. Open unknown blocks are also omitted.
   * @returns the kept blocks; empty when nothing streamed before the interruption.
   */
  interruptedBlocks(): ContentBlock[] {
    return this.order
      .map((index) => {
        const partial = this.mustGet(index)
        const type = partial.block?.type ?? partial.blockType
        if (type !== 'text' && type !== 'reasoning') return undefined
        return this.assemble(partial, index)
      })
      .filter((block): block is ContentBlock =>
        (block?.type === 'text' || block?.type === 'reasoning') && block.text.trim() !== '')
  }

  /** Usage from the `usage` chunk; undefined until one arrives. */
  get usage(): TokenUsage | undefined {
    return this._usage
  }

  /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
  get finish(): FinishReason {
    return this._finish ?? { kind: 'stop' }
  }

  /**
   * Replay metadata from the terminal finish chunk, if any, with per-block
   * entries pruned in step with {@link blocks}. Undefined when the envelope's
   * entries do not align with the emitted blocks.
   */
  get replayState(): ReplayEnvelope | undefined {
    return this.assembled().replay
  }

  /**
   * The assembled assistant message.
   * @param source - producer attribution for the assembled message.
   * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
   */
  message(source: MessageSource = { kind: 'plugin', plugin: 'dsh-llm/assembler' }): Message {
    return createMessage({ role: 'assistant', content: this.blocks(), source })
  }
}
