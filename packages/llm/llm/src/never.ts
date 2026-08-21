/**
 * @file 闭 core union 的「穷尽性」帮手：`assertNever`。
 *
 * 用法（switch default branch 上写 `assertNever(x, 'switch 上下文')`）：
 *   - 加一个 union variant 时**编译期**就在每个 `switch` 卡住——TS 把
 *     `never` 类型上 `assertNever` 的调用点报错。
 *   - 真的有「值逃出类型」时**运行期** throw，并把「逃出去那个值」用
 *     JSON 渲染到 message 里。
 *
 * **不**适用于：declaration-merged union（session events / content blocks
 * 这类下游插件可能新加合法变体的）。那种 union 必须**显式** fall through
 * 默认分支（不是用 `assertNever`），不然插件加新变体就把你编译死了。
 *
 * `JSON.stringify(x) ?? String(x)` 这一行：JSON 在 `undefined` 上返回
 * `undefined`，`String(...)` 兜底；`as string` 强制 TS 信。
 *
 * 与其他模块的连接点：
 *   - `BlockAssembler` / `LlmRuntime.adapterStream` / agent-loop state machine
 *     都在 closed union 的 default 分支调它
 */

/**
 * Mark an unreachable closed-union branch. A newly unhandled typed variant fails at the call site;
 * a value that escaped its type throws with diagnostics at runtime.
 * @param value - the impossible value; typed `never` so an unhandled variant fails compilation at the call site.
 * @param context - optional label (e.g. the switch site) prefixed into the throw message.
 * @returns never — it always throws, with the offending value JSON-rendered in the message.
 */
export function assertNever(value: never, context?: string): never {
  // JSON.stringify is typed string but returns undefined for undefined input;
  // String() covers that and other non-serializable escapes.
  const rendered = (JSON.stringify(value) as string | undefined) ?? String(value)
  throw new Error(`unreachable variant${context ? ` in ${context}` : ''}: ${rendered}`)
}
