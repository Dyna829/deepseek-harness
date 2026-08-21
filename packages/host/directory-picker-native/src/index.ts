/**
 * @file `directory-picker` 的 native 后端：在 host 屏幕弹一个 OS 原生 chooser。
 *
 * 按平台选实现：
 *   - macOS: `osascript` 调 AppleScript `choose folder`
 *   - Linux: 先 `zenity --file-selection --directory`，缺则 fallback 到 `kdialog`
 *   - Windows: spawn 子进程跑现代 `IFileOpenDialog`（koffi + COM，main thread
 *     阻塞在 modal `Show` 内，host event loop 不死）
 *
 * 只在操作员坐在 host 屏前时可用；远程部署请用 `-browse`。
 *
 * 与其他模块的连接点：
 *   - 平台分发 + 平台细节都在 `native-picker.ts`；这里只把它装成
 *     `ctx.directoryPicker` 的 `native` capability
 *
 * @module @deepseek-ai/dsh-host-directory-picker-native
 */

import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import { pickNativeDirectory } from './native-picker.ts'

export type { DirectoryPickerInternals, DirectoryPickerRunner } from './native-picker.ts'
export { pickNativeDirectory } from './native-picker.ts'

/**
 * The `ctx.directoryPicker` native implementation (stable capability object per service life).
 *
 * @description 中文说明：
 *   把 `pickNativeDirectory` 装成 seam 的 `native` capability。`nativeCapability`
 *   字段在构造函数里 freeze 一次——seam 契约要求引用稳定。
 *   平台分支（macOS/Linux/Windows）都在 `native-picker.ts` 里，本类只是 seam adapter。
 */
export default class NativeDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    /* v8 ignore next -- pure forward to pickNativeDirectory (its spec owns behavior); invoking here opens a real chooser. */
    pick: signal => pickNativeDirectory(signal),
  }

  /**
   * The native interaction capability.
   * @returns the stable `native` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}
