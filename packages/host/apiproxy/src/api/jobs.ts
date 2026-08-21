/**
 * @file `jobs` domain contract——**只**给 client 看的那部分 job view。
 *
 * 关键设计（**写代码容易绕过的**）：
 *   - **「Registry 的 live record 永远**不**跨 wire」**：跨 wire 的
 *     **`JobView` 是「人类列表要看的子集」**——每条 push / RPC 重新
 *     mint 视图，**不**持久化。`JobView` 字段比 registry 内部 record
 *     少（`ownerSession` / `reported` / `outputLimitBytes` 都**不**在
 *     view 里）。
 *   - **`ownerSession` 故意 absent**：和 frame 自己的 `sessionId` 重复
 *     ——「这条 job 属于哪个 session」已经在 frame envelope 上传过，
 *     不必再在 view 字段里塞一份。
 *   - **`reported` 故意 absent**：内部 notice-delivery bit，**没**用户
 *     语义。
 *   - **`outputLimitBytes` 故意 absent**：producer 自己的 model 呈现策略
 *     ——**永远不到人类 surface**（用户**不**需要知道「这条 bash 输出
 *     被截到 2MB」）。
 *   - **`kind: string`（**不**是 closed union）**：producer plugin 通过
 *     declaration merging 扩展 kind map——**任何** client build 都**不能**
 *     枚举全集（**今天** `bash` / `pwsh` / `pty-send` / `subagent`，
 *     明天可能加新 producer）。这条**故意**让 schema 端只验「string」，
 *     不断 unknown kind。
 *   - **`status` 是 closed union**：状态**只有**这五个——client 端可以
 *     safe 渲染 icon / color。
 *
 * 与其他模块的连接点：
 *   - `dsh-jobs/brand` 的 `JobId` brand
 *   - `dsh-jobs` 提供 host 端 registry
 *   - `events.ts` 的 `session/jobs` frame 是 push 路径
 *   - `api-proxy.ts` 把 registry record 翻成 view
 *   - `host/webserver` 把 `session/jobs` 帧通过 SSE 推给 client
 */

import type { JobId } from '@deepseek-ai/dsh-jobs/brand'

/**
 * One background job as the client sees it.
 *
 * Three registry fields are deliberately absent. `ownerSession` is redundant
 * beside the frame's own `sessionId`; `reported` is an internal notice-delivery
 * bit with no user meaning; `outputLimitBytes` is producer-owned model
 * presentation policy that never reaches a human surface.
 */
export interface JobView {
  /** Registry-issued `<kind>-N` identity, stable for the task's whole life. */
  id: JobId
  /**
   * Producer kind (`bash`, `pwsh`, `pty-send`, `subagent`, …). Kept as a bare
   * string because producer plugins extend the kind map by declaration merging,
   * so no client build can enumerate the closed set.
   */
  kind: string
  /** Producer-supplied one-line label: the command, or the delegation description. */
  label: string
  /** Current lifecycle state. */
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  /** Kind-specific status detail ('exit code: 3'), present once the producer supplied one. */
  detail?: string
  /** Epoch ms when the task was registered. */
  startedAt: number
  /** Epoch ms when the task settled; absent while live. */
  finishedAt?: number
}
