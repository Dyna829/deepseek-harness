/**
 * @file `ctx.tokenMeter` 的本体：单一 replay-aware token 计量服务。
 *
 * 两条「产品事实在哪」的设计：
 *   - **Request pressure** = 「provider 这一步实际用掉的 token」优先
 *     (`TokenUsage`)；只在没有 anchor 时退到 `estimateHeader` + 表面
 *     token 的 heuristic 估算。
 *   - **Surface pressure** = 「当前 session 表面上挂的 token 树」，永远
 *     heuristic 算（`foldSurfaceTokens`），跟 request header **无关**。
 *   - **「anchor」是 request / surface 的对账点**：每条 `assistant/message`
 *     落盘时记一个 `MeasurementAnchor`（`header` + `surface tokens` +
 *     `baseline`），之后 `measure()` 时如果 header 没变且 surface 增量
 *     ≥0，直接复用 anchor；否则 reprice。这就是「provider 报的 usage
 *     在我们心里是**真的**，heuristic 估算的要在它觉得不对的时候让位」。
 *
 * 关键不变量（写代码容易绕过的）：
 *   - **`usageTokens` 加 disjoint 桶**：`inputTokens + cacheRead + cacheWrite
 *     + outputTokens`——这三个 cache / output 桶互不交，**不**会因为某个
 *     provider 把 reasoning 折进 output 算两遍。
 *   - **「Step 必须 open + assistant 必须挂在它之上」**：`_foldEvent` 在
 *     `step/start` / `step/end` / `assistant/message` 三处都用同一套
 *     「state.stepStart 必须存在且与 event 对得上」的检查。**先**算齐
 *     这些不变量，**再**开始 mutate state（`nextHeader` / `nextStepStart`
 *     / `nextAnchor` 局部变量在 switch 跑完才赋给 state）——一次折叠失败
 *     不会留半改的 state。
 *   - **`sourceEventSeqs` 拼 provider 真输出**：当 `assistant/message` 自带
 *     `usage` 时，本服务**不**信 `durableEventTokens`（durable 是「最后
 *     一次 append 时算的」），而是从 `sourceEventSeqs` 引用的 `assistant/chunk`
 *     **自己**走一遍 `BlockAssembler` + `estimateContent`——**和 provider
 *     实际吐的内容一致**。`sourceSeqs === undefined` 时（legacy 数据）
 *     才退到 `durableEventTokens` 兜底。
 *   - **Provider usage 必须 ≥ 估算 anchor** 才采纳 `kind: 'usage'`：避免
 *     「provider 报的比 heuristic 还少」导致下游压力读数变小（`usage` 应该是
 *     **下界**）。达不到就降级为 `kind: 'estimated'`。
 *   - **`measure()` 返回 deep-frozen 副本**——压力读数是「诊断观察」，**不**
 *     能被消费方持有后改 state.surface。
 *
 * 与其他模块的连接点：
 *   - `dsh-llm.BlockAssembler` 复拼 provider 真实 chunk
 *   - `dsh-llm.deepFreeze` 冻结返回值
 *   - `dsh-session` 的 `Session` / `SessionEvent` / `isSurfaceEvent` 提供 log
 *   - `dsh-session-projection` 是可选 child，装着三个 projection definition
 *   - `estimate.ts` / `surface-fold.ts` 提供纯函数估算
 *   - `usage-projection.ts` / `breakdown-projection.ts` / `contextPressureProjection`
 *     在有 registry 的 composition 里被注册
 */
 *
 * @module @deepseek-ai/dsh-token-meter
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { EpochHeader, Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { canonicalHeader, headerEquals, isSurfaceEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves the optional projection registry Context declaration.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {
  TokenMeasurement,
  TokenMeasurementBaseline,
  TokenMeterConfig,
  TokenSurfaceNode,
} from './types.ts'
import { contextBreakdownProjectionDefinition } from './breakdown-projection.ts'
import { contextPressureProjectionDefinition, tokenUsageProjectionDefinition } from './usage-projection.ts'
import { estimateContent, estimateHeader, estimateMessage, ROLE_OVERHEAD } from './estimate.ts'
import { foldSurfaceTokens } from './surface-fold.ts'

export type * from './types.ts'

interface MeasurementAnchor {
  readonly header: EpochHeader | undefined
  readonly surfaceTokens: number
  readonly baseline: Exclude<TokenMeasurementBaseline, { kind: 'none' }>
}

interface ReplayState {
  consumedEvents: number
  header: EpochHeader | undefined
  surface: TokenSurfaceNode[]
  surfaceTokens: number
  stepStart: { turn: number; step: number; surfaceTokens: number } | undefined
  anchor: MeasurementAnchor | undefined
}

/** Sum disjoint provider usage buckets without double-counting reasoning output. */
function usageTokens(usage: TokenUsage): number {
  return usage.inputTokens
    + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0)
    + usage.outputTokens
}

/** Compare optional envelopes so a headerless estimate can track later surface deltas. */
function optionalHeaderEquals(
  left: EpochHeader | undefined,
  right: EpochHeader | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  return headerEquals(left, right)
}

/** Reject stale or misspelled keys before defaults can hide them. */
function validateConfigKeys(config: TokenMeterConfig): void {
  for (const key of Object.keys(config)) {
    throw new Error(`TokenMeterConfig: unknown key "${key}" (no settings are supported)`)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tokenMeter: TokenMeter
  }
}

/** Replay owner for one service-wide estimator and isolated per-session folds. */
export class TokenMeter extends Service {
  // Schemastery preserves untrusted loader keys on an empty object schema;
  // the public type excludes settings while validateConfigKeys rejects them.
  static Config: z<TokenMeterConfig> = z.object({}) as unknown as z<TokenMeterConfig>

  private readonly states = new WeakMap<Session, ReplayState>()

  constructor(ctx: Context, config: TokenMeterConfig = {}) {
    super(ctx, 'tokenMeter')
    validateConfigKeys(config)

    // Projection registration is an optional child: compositions without the
    // generic registry keep the meter's standalone read shape.
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(tokenUsageProjectionDefinition)
      projectionCtx.sessionProjections.register(contextPressureProjectionDefinition)
      projectionCtx.sessionProjections.register(contextBreakdownProjectionDefinition)
    })

    // Readers catch up independently, while eager observation bounds ordinary
    // read latency without creating state for sessions no consumer has read.
    ctx.on('session/event', (session) => {
      if (this.states.has(session)) this._sync(session)
    })
  }

  /**
   * Measure current request pressure and surface through the durable tail.
   *
   * Provider usage is reused only when the latest successful call's canonical
   * request envelope matches `requestHeader` and its total is no lower than
   * that call's full heuristic anchor; otherwise the complete envelope and
   * surface are heuristically repriced.
   *
   * `requestHeader` affects request pressure only; surface fields always
   * describe the current session surface. Every call clones those positional
   * nodes, so measurement is O(surface).
   *
   * @param session - session to replay through its current durable tail.
   * @param requestHeader - optional effective request envelope replacing the latest logged header.
   * @returns a detached deeply immutable pressure and surface measurement.
   */
  measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement {
    const state = this._sync(session)
    const header = requestHeader === undefined
      ? state.header
      : canonicalHeader(requestHeader)
    const anchor = state.anchor

    let baseline: TokenMeasurementBaseline
    let surfaceDeltaTokens: number
    if (anchor !== undefined && optionalHeaderEquals(anchor.header, header)) {
      baseline = anchor.baseline
      surfaceDeltaTokens = state.surfaceTokens - anchor.surfaceTokens
    } else if (header === undefined && state.surfaceTokens === 0) {
      baseline = { kind: 'none', tokens: 0 }
      surfaceDeltaTokens = 0
    } else {
      baseline = {
        kind: 'estimated',
        tokens: estimateHeader(header) + state.surfaceTokens,
      }
      surfaceDeltaTokens = 0
    }

    return deepFreeze(structuredClone({
      logRevision: state.consumedEvents,
      baseline,
      surfaceDeltaTokens,
      totalTokens: Math.max(0, baseline.tokens + surfaceDeltaTokens),
      surfaceTokens: state.surfaceTokens,
      nodes: state.surface,
    }))
  }

  /**
   * Heuristically price one model-visible message (instance face of the pure
   * `estimateMessage` export from `estimate.ts`).
   * @param message - message to price without mutation.
   * @returns content and role-framing tokens under the fixed service heuristic.
   */
  estimateMessage(message: Message): number {
    return estimateMessage(message)
  }

  /** Catch one session's fold up to the current durable tail. */
  private _sync(session: Session): ReplayState {
    let state = this.states.get(session)
    if (state === undefined) {
      state = {
        consumedEvents: 0,
        header: undefined,
        surface: [],
        surfaceTokens: 0,
        stepStart: undefined,
        anchor: undefined,
      }
      this.states.set(session, state)
    }

    while (state.consumedEvents < session.events.length) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- contiguous session seqs index the durable log
      const event = session.events[state.consumedEvents]!
      this._foldEvent(session, state, event)
      state.consumedEvents += 1
    }
    return state
  }

  /**
   * Validate and prepare every fallible part before mutating replay state.
   * A malformed event remains unread on every retry instead of partially
   * applying the same mutation more than once.
   */
  private _foldEvent(session: Session, state: ReplayState, event: SessionEvent): void {
    let nextHeader = state.header
    let nextStepStart = state.stepStart
    let nextAnchor = state.anchor

    switch (event.type) {
      case 'request/header':
        nextHeader = canonicalHeader(event.data.header)
        break
      case 'step/start':
        if (state.stepStart !== undefined) {
          throw new Error(
            `token meter: step/start at seq ${event.seq} arrived before turn ${state.stepStart.turn}/step ${state.stepStart.step} ended`,
          )
        }
        nextStepStart = { ...event.data, surfaceTokens: state.surfaceTokens }
        break
      case 'step/end':
        if (state.stepStart === undefined
          || state.stepStart.turn !== event.data.turn
          || state.stepStart.step !== event.data.step) {
          throw new Error(`token meter: step/end at seq ${event.seq} has no matching step/start event`)
        }
        nextStepStart = undefined
        break
      default:
        break
    }

    const surface = isSurfaceEvent(event)
      ? foldSurfaceTokens(state.surface, event)
      : undefined

    if (event.type === 'assistant/message') {
      const stepStart = state.stepStart
      if (stepStart === undefined
        || stepStart.turn !== event.data.turn
        || stepStart.step !== event.data.step) {
        throw new Error(`token meter: assistant/message at seq ${event.seq} has no matching step/start event`)
      }

      // assistant/message is surface-mandatory at every append/seed boundary.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const eventTokens = surface!.tokens
      if (event.data.usage !== undefined && nextHeader !== undefined) {
        const providerAssistantTokens = this._estimateProviderAssistant(
          session,
          event,
          eventTokens,
        )
        const anchorSurfaceTokens = stepStart.surfaceTokens + providerAssistantTokens
        const providerTokens = usageTokens(event.data.usage)
        const estimatedAnchorTokens = estimateHeader(nextHeader) + anchorSurfaceTokens
        nextAnchor = {
          header: nextHeader,
          surfaceTokens: anchorSurfaceTokens,
          // Signed heuristic deltas remain conservative only from an anchor
          // that is at least as large as the matching full heuristic price.
          baseline: providerTokens >= estimatedAnchorTokens
            ? { kind: 'usage', tokens: providerTokens, usage: event.data.usage }
            : { kind: 'estimated', tokens: estimatedAnchorTokens },
        }
      } else {
        const anchorSurfaceTokens = stepStart.surfaceTokens + eventTokens
        nextAnchor = {
          header: nextHeader,
          surfaceTokens: anchorSurfaceTokens,
          baseline: {
            kind: 'estimated',
            tokens: estimateHeader(nextHeader) + anchorSurfaceTokens,
          },
        }
      }
    }

    state.header = nextHeader
    state.stepStart = nextStepStart
    if (surface !== undefined) {
      state.surface = surface.nodes
      state.surfaceTokens += surface.deltaTokens
    }
    state.anchor = nextAnchor
  }

  /**
   * Reassemble provider output from the exact cited chunk seqs for a usage anchor.
   * Missing legacy source seqs conservatively treat the durable output as the
   * provider output; an explicit empty list prices a known empty stream.
   */
  private _estimateProviderAssistant(
    session: Session,
    event: SessionEvent<'assistant/message'>,
    durableEventTokens: number,
  ): number {
    const sourceSeqs = event.sourceEventSeqs
    if (sourceSeqs === undefined) return durableEventTokens

    const assembler = new BlockAssembler()
    const seen = new Set<number>()
    for (const seq of sourceSeqs) {
      if (seq >= event.seq) {
        throw new Error(`token meter: assistant/message at seq ${event.seq} source seq ${seq} is not earlier`)
      }
      if (seen.has(seq)) {
        throw new Error(`token meter: assistant/message at seq ${event.seq} repeats source seq ${seq}`)
      }
      seen.add(seq)
      // Session construction validates contiguous seqs, and the explicit
      // earlier-than-assistant check above therefore guarantees existence.
      const source = session.events[seq]
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const sourceEvent = source!
      if (sourceEvent.type !== 'assistant/chunk') {
        throw new Error(`token meter: assistant/message at seq ${event.seq} source seq ${seq} is not assistant/chunk`)
      }
      if (sourceEvent.data.turn !== event.data.turn || sourceEvent.data.step !== event.data.step) {
        throw new Error(`token meter: assistant/message at seq ${event.seq} source seq ${seq} belongs to another step`)
      }
      assembler.push(sourceEvent.data.chunk)
    }
    const providerContent = assembler.blocks()
    return providerContent.length === 0 ? 0 : estimateContent(providerContent) + ROLE_OVERHEAD
  }
}

export default TokenMeter
