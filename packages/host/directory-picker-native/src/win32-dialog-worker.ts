/**
 * @file Win32 文件夹对话框的子进程入口。
 *
 * 在 `Show` 内阻塞**这个子进程**——主进程 event loop 不死。用子进程
 * （而不是 worker_thread）是因为：dialog 是该进程的**首**个窗口，
 * Windows 不用手动 `SetForegroundWindow` 也会激活它。
 *
 * IPC 协议：
 *   1. `Show` 前发 `{kind:'showing', threadId}`——driver 的 abort 杠杆
 *      需要 native thread id 才能 `WM_CLOSE` 那条线程上的窗口
 *   2. Show 返回后发**恰好一条** `{kind:'done', path|null}` 或
 *      `{kind:'error', message}`
 *   3. 退出时 `disconnect` IPC，driver 任何先 settle 的 promise 都被视为完成
 *
 * 与其他模块的连接点：
 *   - 由 `win32-dialog-host.ts` 的 `spawnDialogWorker` 拉起
 *   - 内部分别调 `win32-dialog-bindings.ts`（koffi）和
 *     `win32-dialog-logic.ts`（纯 sequencing）
 */

import { loadWin32DialogBindings } from './win32-dialog-bindings.ts'
import { runFolderDialog } from './win32-dialog-logic.ts'

/** The driver-to-child payload: the dialog title (passed via env). */
export interface Win32DialogWorkerData { title: string }

/** One notice or outcome posted back to the driver. */
export type Win32DialogWorkerMessage =
  | { kind: 'showing'; threadId: number }
  | { kind: 'done'; path: string | null }
  | { kind: 'error'; message: string }

const title = process.env.DSH_DIALOG_TITLE ?? ''
if (title === '') throw new Error('win32-dialog-worker: DSH_DIALOG_TITLE is required')
if (process.send === undefined) throw new Error('win32-dialog-worker must run as a child process with an IPC channel')
// node's internal `send` reads `this.connected`, so bind the receiver.
const send = process.send.bind(process)

const post = (message: Win32DialogWorkerMessage): void => {
  // Flush before closing the channel; the process exits when the loop drains.
  /* v8 ignore next 3 -- disconnect needs a live IPC channel the unit lane must not sever (built-worker.e2e.ts owns the real close path). */
  send(message, () => { if (process.connected) process.disconnect() })
}

// A settled driver (or a dead parent) must not orphan a dialog still on screen.
/* v8 ignore next 3 -- the handler exits(0), which would kill the unit lane; built-worker.e2e.ts owns the real disconnect lifecycle. */
process.on('disconnect', () => process.exit(0))

// No top-level await: the built worker ships as CJS, which cannot carry TLA.
void (async () => {
  try {
    const bindings = await loadWin32DialogBindings()
    const path = runFolderDialog(bindings, title, (threadId) => {
      post({ kind: 'showing', threadId } satisfies Win32DialogWorkerMessage)
    })
    post({ kind: 'done', path } satisfies Win32DialogWorkerMessage)
  } catch (error: unknown) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    post({ kind: 'error', message } satisfies Win32DialogWorkerMessage)
  }
})()
