/**
 * @file Win32 dialog driver 的「真实进程」半：spawn 子进程 + 跨线程关窗。
 *
 * 模块本身在所有平台都加载（`native-picker.ts` 静态 import），koffi 仍由
 * `win32-dialog-bindings.ts` 内部 lazy import——driver 单元测试在所有平台
 * 都跑，靠**模拟本模块的接口**而不是真 spawn。
 *
 * 子进程 fork 时机：
 *   - built 输出（`.cjs` 旁车）：直接 `node ./worker.cjs`
 *   - source（`.ts` 走 tsx）：`node --import tsx/esm ./win32-dialog-worker.ts`
 *   （和 `dsh` CLI 的 source launch 同一套机制）
 *
 * 与其他模块的连接点：
 *   - 唯一消费者是 `win32-dialog.ts`（driver）
 *   - 复用 `closeThreadWindows`（实际委托回 `win32-dialog-bindings.ts`）
 */

import { spawn, type StdioOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Win32DialogWorkerData } from './win32-dialog-worker.ts'

/**
 * Spawn the dialog child process. Built consumers launch the bundled CJS
 * entry next to this module under plain node; unbuilt (source) consumers
 * bootstrap tsx first, mirroring the dsh CLI's source launch. The dialog is
 * the child's first window, so Windows activates it without a foreground
 * call.
 * @param data - the child payload (dialog title).
 * @returns the spawned child process.
 */
export function spawnDialogWorker(data: Win32DialogWorkerData): ReturnType<typeof spawn> {
  const env = { ...process.env, DSH_DIALOG_TITLE: data.title }
  const stdio: StdioOptions = ['ignore', 'inherit', 'inherit', 'ipc']
  /* v8 ignore next 3 -- the built-output arm: tests always run unbuilt (src/) */
  if (!import.meta.url.endsWith('.ts')) {
    return spawn(process.execPath, [fileURLToPath(new URL('./worker.cjs', import.meta.url))], { env, stdio, windowsHide: true })
  }
  return spawn(process.execPath, ['--import', import.meta.resolve('tsx/esm'), fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], { env, stdio, windowsHide: true })
}

export { closeThreadWindows } from './win32-dialog-bindings.ts'
