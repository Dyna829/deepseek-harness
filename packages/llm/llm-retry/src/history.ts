/**
 * @file 在「open model step」范围内查「当前 request header 走的是哪个
 * provider」——`llm-retry/invariant` 用来验证 `llm/retry` event 上写的
 * `provider` 字段对得上。
 *
 * 关键不变量（写代码容易绕过的）：
 *   - **Request header 跨 turn 边界仍然有效**，直到「更新的 full snapshot」
 *     改它。所以本查询**只**找 step start 之后**最后一条** `request/header`
 *     event，不看 step 内部 turn boundary 之类的中间事件。
 *   - **「Provider 改变」必须通过 full snapshot 表达**，所以 `findLast`
 *     一路跳过中间的 token / sub-step 事件，**不**用 heuristic 拼凑。
 *   - **Step 必须真 open**——找完 `step/start` index 之后还要确认该 index
 *     之后**没有** `step/end` 或 `turn/end` 出现；不是 open 的 step 返回
 *     `undefined`（让 invariant 报错，而不是凭空给个值）。
 *   - **Step 找不到直接 `undefined`**——invariant 端单独有「`llm/retry`
 *     必须落在 open step 里」这条不变量，本函数**不**重复检查。
 *
 * 与其他模块的连接点：
 *   - `dsh-session` 的 `SessionEvent`（含 `step/start` / `request/header`）
 *   - `invariant.ts` 在 validateRetry 路径上调用
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Find the provider in force for one currently open step.
 * Request headers remain effective across turn boundaries until a newer full
 * snapshot changes them; every provider change requires a newer full snapshot.
 * @param events - session events ending inside the open step.
 * @param turn - turn that owns the failed step.
 * @param step - failed step whose provider is required.
 * @returns the provider from the request header in force for the step.
 */
export function providerForOpenStep(
  events: readonly SessionEvent[],
  turn: number,
  step: number,
): string | undefined {
  const stepStartIndex = events.findLastIndex(event =>
    event.type === 'step/start'
    && event.data.turn === turn
    && event.data.step === step,
  )
  if (stepStartIndex < 0 || events.slice(stepStartIndex + 1).some(event =>
    event.type === 'step/end' || event.type === 'turn/end')) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    // The loop bounds prove this indexed read exists.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = events[index]!
    if (event.type === 'request/header') return event.data.header.config.provider
  }
  return undefined
}
