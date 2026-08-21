/**
 * @file Win32 文件夹对话框的主线程 driver：spawn 子进程 + 服务 abort。
 *
 * 子进程在 modal `Show` 内阻塞，所以：
 *   1. 主进程 event loop 不死
 *   2. driver 透过 IPC 拿子进程的 `{kind:'showing',threadId}` 通知记录
 *      dialog 线程 native id（abort 杠杆的前提）
 *   3. abort 时反复 `WM_CLOSE` 那个线程上所有窗口直到子进程回话
 *
 * 「真实 process/window 表面」（spawn / closeThreadWindows）全可注入，
 * 让所有 driver 分支可被确定性测试（`Win32DialogInternals`）。
 *
 * 与其他模块的连接点：
 *   - `win32-dialog-host.ts` 给生产态的真实 spawn + koffi close
 *   - `win32-dialog-worker.ts` 是子进程入口
 */

import { closeThreadWindows as hostCloseThreadWindows, spawnDialogWorker } from './win32-dialog-host.ts'
import type { Win32DialogWorkerData, Win32DialogWorkerMessage } from './win32-dialog-worker.ts'

/** The child-process surface the driver drives (satisfied by `node:child_process`). */
export interface Win32DialogWorkerLike {
  /**
   * Subscribe to a child-process event.
   * @param event - `message`, `error`, or `exit`.
   * @param listener - the event consumer.
   */
  on(event: 'message', listener: (message: Win32DialogWorkerMessage) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  /**
   * Force-stop the child; the abort path's last resort when `WM_CLOSE`
   * never lands (e.g. the dialog window was never created).
   * @returns whether a kill signal was delivered.
   */
  kill(): boolean
  /**
   * Release the event-loop reference. Called once the pick settles so a
   * child stuck in the native modal call never blocks process exit.
   */
  unref?(): void
}

/** Injectable process surface for deterministic driver tests. */
export interface Win32DialogInternals {
  /** Replaces the real child spawn (`win32-dialog-host.ts`). */
  spawnWorker?: (data: Win32DialogWorkerData) => Win32DialogWorkerLike
  /** Replaces the real `WM_CLOSE` poster (`win32-dialog-host.ts`). */
  closeThreadWindows?: (threadId: number) => Promise<void>
  /** Abort-service cadence override so tests never wait wall-clock time. */
  closeRetryMs?: number
}

/** The dialog title every host shows. */
export const DIALOG_TITLE = 'Select Workspace Directory'

/** `WM_CLOSE` re-post cadence while an abort waits for the worker to unwind. */
const CLOSE_RETRY_MS = 150
/** Abort-service attempts before force-terminating the worker. */
const CLOSE_MAX_ATTEMPTS = 20

/** Fail loudly if the closed worker-to-driver union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop; unreachable without a TypeScript contract violation */
function assertNever(value: never): never {
  throw new TypeError(`unknown win32 dialog worker message kind: ${String(value)}`)
}
/* v8 ignore stop */

/**
 * Open the modern Win32 folder picker off the event loop.
 * @param signal - caller lifetime; abort closes the dialog and rejects.
 * @param internals - Worker/window hooks for deterministic tests.
 * @returns the selected path, or null when the user cancels.
 */
export async function pickWin32Directory(
  signal: AbortSignal,
  internals: Win32DialogInternals = {},
): Promise<string | null> {
  if (signal.aborted) throw new Error('native directory picker aborted')
  const spawnWorker = internals.spawnWorker ?? spawnDialogWorker
  const closeWindows = internals.closeThreadWindows ?? hostCloseThreadWindows
  const closeRetryMs = internals.closeRetryMs ?? CLOSE_RETRY_MS

  const worker: Win32DialogWorkerLike = spawnWorker({ title: DIALOG_TITLE })
  let dialogThreadId: number | undefined
  let closeTimer: NodeJS.Timeout | undefined
  let settled = false

  return await new Promise<string | null>((resolve, reject) => {
    const settle = (outcome: () => void): void => {
      if (settled) return
      settled = true
      if (closeTimer !== undefined) clearInterval(closeTimer)
      signal.removeEventListener('abort', onAbort)
      worker.unref?.()
      outcome()
    }

    const postClose = (): void => {
      // Before `showing` there is no window to close; the budget below still
      // runs so a child that never reports cannot dangle the pick. A
      // rejected close attempt (EnumThreadWindows/PostMessageW refusing) is
      // discarded: the interval retries it and kill is the backstop.
      if (dialogThreadId !== undefined) void closeWindows(dialogThreadId).catch(() => undefined)
    }

    // Sole caller: the once-registered abort listener, so no re-entry guard.
    const serviceAbort = (): void => {
      let attempts = 0
      // The `showing` notice precedes the blocking `Show`, so the very first
      // WM_CLOSE can race the window's creation; re-post until the child
      // reports back, then force-kill as a last resort. The budget is
      // unconditional — an abort before `showing` (child hung in koffi or
      // COM init) still ends in kill instead of a dangling promise.
      closeTimer = setInterval(() => {
        attempts += 1
        if (attempts > CLOSE_MAX_ATTEMPTS) {
          settle(() => {
            worker.kill()
            reject(new Error('native directory picker aborted (dialog unresponsive; worker killed)'))
          })
          return
        }
        postClose()
      }, closeRetryMs)
      postClose()
    }

    const onAbort = (): void => {
      serviceAbort()
    }
    signal.addEventListener('abort', onAbort, { once: true })

    worker.on('message', (message: Win32DialogWorkerMessage) => {
      switch (message.kind) {
        case 'showing':
          dialogThreadId = message.threadId
          // An abort that raced ahead of this notice now has a window to hit.
          if (signal.aborted) postClose()
          return
        case 'done':
          settle(() => {
            if (signal.aborted) reject(new Error('native directory picker aborted'))
            else resolve(message.path)
          })
          return
        case 'error':
          settle(() => {
            reject(new Error(`win32 folder dialog failed: ${message.message}`))
          })
          return
        /* v8 ignore next 2 -- closed worker-owned union; a fourth kind becomes a compile error */
        default:
          assertNever(message)
      }
    })
    worker.on('error', (error: Error) => {
      settle(() => {
        reject(error)
      })
    })
    worker.on('exit', () => {
      settle(() => {
        reject(new Error('win32 folder dialog worker exited before reporting a result'))
      })
    })
  })
}
