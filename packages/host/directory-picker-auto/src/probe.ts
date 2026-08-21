/**
 * @file Linux 端 PATH 上 zenity/kdialog 是否可执行的探针。
 *
 * 只对 resolver 暴露一个「是/否」bool，纯函数：把 PATH 字符串拆 delimiter
 * 拼路径，调 `isExecutable`（生产 = `accessSync(X_OK)`，测试可注入）。
 *
 * 为何要单独抽出来：让 `-auto` 的 boot-time 决策在非 Linux 主机/无
 * chooser 二进制的 CI 上**永远不**调起 native 后端——后者会**每个** pick
 * 都失败，而不是缺一个清晰的「走 browse」分支
 */

/**
 * PATH probe for the native backend's Linux chooser binaries: one boot-time
 * sampled fact for the resolver, so an attended Linux host without
 * zenity/kdialog keeps the working `browse` interaction instead of a backend
 * whose every pick fails.
 * @module @deepseek-ai/dsh-host-directory-picker-auto/probe
 */

import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/** The chooser binaries the native backend can drive on Linux (zenity, KDialog fallback). */
const LINUX_CHOOSER_BINARIES = ['zenity', 'kdialog'] as const

/**
 * Whether the current process may execute the candidate path.
 * @param candidate - absolute or PATH-joined file path.
 * @returns true only for an existing executable file.
 */
export function canExecute(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)
  } catch {
    // Absent or non-executable candidate — the only signals accessSync(X_OK) emits.
    return false
  }
  return true
}

/**
 * Scan a PATH value for one of the native backend's Linux chooser binaries.
 * @param pathValue - the `PATH` environment value (absent or empty scans nothing).
 * @param isExecutable - executability predicate ({@link canExecute} in production; injected for deterministic tests).
 * @returns whether any PATH directory holds an executable chooser binary.
 */
export function hasLinuxChooserBinary(pathValue: string | undefined, isExecutable: (candidate: string) => boolean): boolean {
  for (const dir of (pathValue ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of LINUX_CHOOSER_BINARIES) {
      if (isExecutable(join(dir, name))) return true
    }
  }
  return false
}
