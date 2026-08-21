/**
 * @file 持久化的 pi-ai replay 元数据 + assistant history 重建。
 *
 * 关键不变量（**写代码容易混淆的**）：
 *   - **harness content 才是 source of truth**：text / tool call 等**业务
 *     内容**从 harness 自己的 `ContentBlock` 来；本文件**只**存 pi-ai
 *     私货——provider-native 签名 / response id / 推理 reasoning signature /
 *     redacted thinking 块——这些是「让 pi-ai 在下一次请求时**认**回这是
 *     它自己家产物」必需的信号。
 *   - **`PiAiReplayResponse.kind = 'pi-ai'` + `version: 2`** 是结构版本
 *     标签——将来 pi-ai 改 envelope 形态时**这里加 version**，老 replay
 *     静默降级，不污染新版本的解析路径。
 *   - **`parseArguments` 用 `{}` 兜底**：model 偶尔产出非对象形态的 tool
 *     args（`null` / array / broken JSON），replay 走 `{}` 比抛错更
 *     友好——agent loop 会再发一个 tool call 修。**不**默默吞原 error，
 *     但**不**让 replay 失败阻塞整个 request。
 *   - **`stopReason` 走 `AssistantMessage['stopReason']`**：pi-ai 自己
 *     的 union type，没自己重定义——replay 时让 pi-ai 自己判 stop
 *     reason 的语义。
 *   - **跨 provider 的不可信 replay 降级**：在 `toPiAssistant` 路径上
 *     调，provider / model 与当前配置不匹配时让 caller 把 assistant
 *     消息**剥掉** replay state 当 provider-neutral 转发，避免「B
 *     provider 解 A provider 的私货」。
 *
 * 与其他模块的连接点：
 *   - `context.ts` 的 `toPiContext` 调 `toPiAssistant` 重建 history
 *   - `stream.ts` 的 `toPiReplayState` 写入新 replay envelope
 *   - `dsh-llm` 的 `ModelMessageSource.replayState` 存的就是这套 envelope
 */
 *
 * Harness content remains the durable source for text and tool calls. This
 * module stores only the provider-native metadata needed to reconstruct a
 * pi-ai assistant message on a later request.
 *
 * @module dsh-llm-pi-ai/replay
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { Message, ModelMessageSource, ReplayEnvelope } from '@deepseek-ai/dsh-llm'
import type { Api, AssistantMessage, Usage as PiUsage } from '@earendil-works/pi-ai'

/** Per-block half of the pi-ai replay envelope, one entry per content block. */
export type PiAiReplayBlock =
  | { type: 'text'; textSignature?: string }
  | { type: 'reasoning'; thinkingSignature?: string; redacted?: boolean }
  | { type: 'tool-call'; thoughtSignature?: string }

/** Versioned response-level half of the pi-ai replay envelope. */
export interface PiAiReplayResponse {
  kind: 'pi-ai'
  version: 2
  api: Api
  provider: string
  model: string
  responseModel?: string
  responseId?: string
  stopReason: AssistantMessage['stopReason']
}

/** The validated halves of one pi-ai replay envelope. */
interface PiAiReplayState {
  response: PiAiReplayResponse
  blocks: PiAiReplayBlock[]
}

/** Parse tool-call argument JSON; tolerate model malformations with {}. */
function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return {}
}

/** Construct the zero usage value required by historical pi-ai messages. */
function emptyPiUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/**
 * Project a successful pi-ai response into the minimal durable replay state.
 * The per-block half is index-aligned with the streamed blocks (pi-ai content
 * order), so `BlockAssembler` prunes an entry with its block whenever assembly
 * removes one.
 * @param message - completed native pi-ai assistant response.
 * @returns the versioned lossless-JSON replay projection.
 */
export function toPiReplayState(message: AssistantMessage): ReplayEnvelope {
  const response: PiAiReplayResponse = {
    kind: 'pi-ai',
    version: 2,
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...message.responseModel === undefined ? {} : { responseModel: message.responseModel },
    ...message.responseId === undefined ? {} : { responseId: message.responseId },
    stopReason: message.stopReason,
  }
  return {
    response,
    blocks: message.content.map((block): PiAiReplayBlock => {
      switch (block.type) {
        case 'text': return {
          type: 'text',
          ...block.textSignature === undefined ? {} : { textSignature: block.textSignature },
        }
        case 'thinking': return {
          type: 'reasoning',
          ...block.thinkingSignature === undefined ? {} : { thinkingSignature: block.thinkingSignature },
          ...block.redacted === undefined ? {} : { redacted: block.redacted },
        }
        case 'toolCall': return {
          type: 'tool-call',
          ...block.thoughtSignature === undefined ? {} : { thoughtSignature: block.thoughtSignature },
        }
      }
    }),
  }
}

function invalidReplay(message: string): never {
  throw new LlmError(`invalid pi-ai replay state: ${message}`, 'INVALID_REPLAY_STATE')
}

/** Validate the durable adapter-private envelope before it reaches pi-ai. */
function readReplayState(value: unknown): PiAiReplayState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidReplay('expected a replay envelope')
  const envelope = value as Record<string, unknown>
  const rawResponse = envelope['response']
  if (typeof rawResponse !== 'object' || rawResponse === null || Array.isArray(rawResponse)) return invalidReplay('expected a response object')
  const response = rawResponse as Record<string, unknown>
  if (response['kind'] !== 'pi-ai') return invalidReplay('unknown state kind')
  if (response['version'] !== 2) return invalidReplay(`unsupported version ${String(response['version'])}`)
  for (const key of ['api', 'provider', 'model'] as const) {
    if (typeof response[key] !== 'string' || response[key].length === 0) return invalidReplay(`${key} must be a non-empty string`)
  }
  if (!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(response['stopReason']))) {
    return invalidReplay('unknown stopReason')
  }
  if (response['responseModel'] !== undefined && typeof response['responseModel'] !== 'string') return invalidReplay('responseModel must be a string')
  if (response['responseId'] !== undefined && typeof response['responseId'] !== 'string') return invalidReplay('responseId must be a string')
  const blocks = envelope['blocks']
  if (!Array.isArray(blocks)) return invalidReplay('blocks must be an array')
  for (const [index, value] of blocks.entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidReplay(`block ${index} must be an object`)
    const block = value as Record<string, unknown>
    if (!['text', 'reasoning', 'tool-call'].includes(String(block['type']))) return invalidReplay(`block ${index} has an unknown type`)
    for (const signature of ['textSignature', 'thinkingSignature', 'thoughtSignature'] as const) {
      if (block[signature] !== undefined && typeof block[signature] !== 'string') return invalidReplay(`block ${index} ${signature} must be a string`)
    }
    if (block['redacted'] !== undefined && typeof block['redacted'] !== 'boolean') return invalidReplay(`block ${index} redacted must be boolean`)
  }
  return {
    response: response as unknown as PiAiReplayResponse,
    blocks: blocks as PiAiReplayBlock[],
  }
}

/** Convert provider-neutral blocks without trusting them as same-model replay. */
function foreignAssistant(message: Message): AssistantMessage {
  const source = message.source.kind === 'model' ? message.source : undefined
  const content: AssistantMessage['content'] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text': content.push({ type: 'text', text: block.text }); break
      case 'reasoning': content.push({ type: 'thinking', thinking: block.text }); break
      case 'tool-call': content.push({
        type: 'toolCall',
        id: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
      }); break
      case 'image':
        throw new LlmError('pi-ai chat history cannot represent structured assistant image output', 'UNSUPPORTED_CONTENT')
      default:
        // plugin-added block types are not representable in pi-ai.
        break
    }
  }
  return {
    role: 'assistant',
    content,
    // Deliberately never equals a catalog API: absent replay state is foreign
    // even if source names the same provider/model as this request.
    api: 'dsh-foreign',
    provider: source?.provider ?? 'dsh-foreign',
    model: source?.model ?? 'dsh-foreign',
    usage: emptyPiUsage(),
    stopReason: content.some(piece => piece.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
  }
}

/** Recombine durable Harness content with validated pi-ai replay metadata. */
function replayedAssistant(message: Message, source: ModelMessageSource, rawState: unknown): AssistantMessage {
  const state = readReplayState(rawState)
  if (state.response.provider !== source.provider) return invalidReplay('provider does not match assistant source')
  if (state.response.model !== source.model) return invalidReplay('model does not match assistant source')
  if (state.blocks.length !== message.content.length) return invalidReplay('block count does not match assistant content')
  const content: AssistantMessage['content'] = message.content.map((block, index) => {
    const replay = state.blocks[index]
    if (replay === undefined || replay.type !== block.type) return invalidReplay(`block ${index} does not match assistant content`)
    switch (block.type) {
      case 'text': return {
        type: 'text',
        text: block.text,
        ...replay.type === 'text' && replay.textSignature !== undefined ? { textSignature: replay.textSignature } : {},
      }
      case 'reasoning': return {
        type: 'thinking',
        thinking: block.text,
        ...replay.type === 'reasoning' && replay.thinkingSignature !== undefined ? { thinkingSignature: replay.thinkingSignature } : {},
        ...replay.type === 'reasoning' && replay.redacted !== undefined ? { redacted: replay.redacted } : {},
      }
      case 'tool-call': return {
        type: 'toolCall',
        id: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
        ...replay.type === 'tool-call' && replay.thoughtSignature !== undefined ? { thoughtSignature: replay.thoughtSignature } : {},
      }
      /* v8 ignore next -- readReplayState rejects unknown replay tags, so an equal plugin-added Harness tag cannot reach this switch */
      default: return invalidReplay(`block ${index} has an unsupported Harness type`)
    }
  })
  return {
    role: 'assistant',
    content,
    api: state.response.api,
    provider: state.response.provider,
    model: state.response.model,
    ...state.response.responseModel === undefined ? {} : { responseModel: state.response.responseModel },
    ...state.response.responseId === undefined ? {} : { responseId: state.response.responseId },
    usage: emptyPiUsage(),
    stopReason: state.response.stopReason,
    timestamp: 0,
  }
}

/**
 * Convert one durable Harness assistant message into pi-ai history.
 *
 * Durable content is the authoritative record; replay metadata only restores
 * native fidelity (ids, signatures). A replay state this build cannot use —
 * another adapter's kind, another version, a malformed value, or metadata that
 * no longer matches the content — therefore degrades the one message to
 * provider-neutral history instead of failing the request.
 * @param message - assistant content with required source and optional adapter-owned replay metadata.
 * @param onDegrade - called with the diagnostic reason when an unusable replay
 *   state falls back to provider-neutral conversion.
 * @returns a native pi-ai assistant message reconstructed from durable content.
 */
export function toPiAssistant(message: Message, onDegrade?: (reason: string) => void): AssistantMessage {
  const source = message.source
  if (source.kind !== 'model' || source.replayState === undefined) return foreignAssistant(message)
  try {
    return replayedAssistant(message, source, source.replayState)
  } catch (error: unknown) {
    /* v8 ignore next -- replayedAssistant throws only INVALID_REPLAY_STATE LlmErrors today; the
       guard keeps a future non-replay failure loud instead of silently degrading it */
    if (!(error instanceof LlmError) || error.code !== 'INVALID_REPLAY_STATE') throw error
    onDegrade?.(error.message)
    return foreignAssistant(message)
  }
}
