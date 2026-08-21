/**
 * @file Agent-loop 调度器的共享默认常量。
 *
 * `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`：一个 assistant step 中，**可并行**
 * 执行的 tool call 数上限。被 `tool-calls.ts` 的 `runGroup` 在每组启动时读取。
 *
 * 用户可以通过 `cordis.yml` 里的 `agentLoop.maxParallelToolCalls` 覆盖（运行期可改，
 * 见 `installSettingsSection` 那一段）。
 */

/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10
