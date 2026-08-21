/**
 * @file `dsh-token-meter` 的 invariant companion 入口。
 *
 * 本包**没有**运行时挂的不变量——
 *   - token 估值是**单次**输出，private session cache 在 event 变更边界
 *     自动 invalidate；
 *   - 三个 projection 的 schema（zod）已经把 JSON 形状钉死，**结构**不变量
 *     走 schema 验证；
 *   - usage fold 替换同 step 样本，所以 totals 在「final 样本修正早期
 *     chunk」时**故意**不单调——这条不是 bug，是设计；
 *   - composition projection 的 message 数字 == `measure().surfaceTokens`
 *     **by construction**（共用 `estimate.ts` + producer-logged shadow price
 *     来自 `TokenMeter` 自己的 nodes），不是**runtime 守**的关系。
 *
 * `install` 留作未来挂「`sessionProjections.register` 三件套必须都装上」
 * 之类**装配期**不变量时的占位。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-token-meter'

/** Cordis companion plugin name. */
export const name = 'token-meter-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: token estimates are per-call outputs and the private
 * session cache is invalidated at its event mutation boundary. The package's
 * three projections do expose observation streams, but their schemas fix the
 * JSON payloads; the usage folds replace same-step samples, so totals need not
 * be monotone when a final sample corrects an earlier chunk, and the
 * composition fold prices through the same `estimate.ts` heuristic as the
 * measurement service and subtracts producer-logged shadow prices derived
 * from that service's own nodes, which makes its message figure equal
 * `measure().surfaceTokens` by construction rather than by a relation worth
 * observing at runtime.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
