/**
 * @file 把「boot-time 采到的 host 事实」纯函数地映射到 native / browse。
 *
 * 决策轴（任一不满足就走 browse）：
 *   1. `bindHost` 必须是 loopback：否则 webserver 暴露给远程浏览器，
 *      远程没 OS chooser 弹
 *   2. 没有 SSH_* 环境：SSH port-forward 下 chooser 弹在服务器上，看不见
 *   3. 平台层：darwin/win32 默认可；linux 还要看 zenity/kdialog 在 PATH 上
 *      且有 DISPLAY/WAYLAND_DISPLAY
 *   4. 其它平台（freebsd 之类）一律 browse
 *
 * 不变量：函数是**纯**的；调用方只在 boot 时采一次，service 整个生命周期
 * 都用同一份结果——seam 契约要求 capability() 引用稳定
 */

import type { Config as HttpServerConfig } from '@deepseek-ai/dsh-host-webserver'

/** Concrete interaction backend the resolver chooses between. */
export type DirectoryPickerBackendKind = 'native' | 'browse'

/** Environment keys the resolution reads (a `process.env` subset). */
export type DirectoryPickerEnv = Readonly<
  Partial<Record<'SSH_CONNECTION' | 'SSH_TTY' | 'DISPLAY' | 'WAYLAND_DISPLAY', string>>
>

/** Host facts the backend choice is a pure function of, sampled once at boot. */
export interface DirectoryPickerHostFacts {
  /** Effective webserver bind host (the schema's closed loopback/all-interfaces union). */
  bindHost: HttpServerConfig['host']
  /** Host process platform. */
  platform: NodeJS.Platform
  /** Environment sample; SSH marks a remote operator, DISPLAY/WAYLAND_DISPLAY a Linux display. */
  env: DirectoryPickerEnv
  /** Whether a Linux chooser binary the native backend can drive (zenity/kdialog) is on PATH; consulted only when `platform` is linux. */
  linuxChooser: boolean
}

/** An env value counts only when set and non-blank (an empty export is "unset" by shell convention). */
const present = (value: string | undefined): boolean => value !== undefined && value !== ''

/**
 * Resolve which backend serves this boot. `native` requires every signal that
 * the operator can see the host display and the native backend can serve it:
 * a loopback-only bind (an all-interfaces bind admits remote browsers no OS
 * chooser can reach), no SSH launch (under SSH port-forwarding the chooser
 * would open on the unattended server), and a servable display session —
 * assumed on darwin/win32, requiring `DISPLAY`/`WAYLAND_DISPLAY` plus a
 * chooser binary on linux, and never true elsewhere (the native backend
 * drives exactly darwin/win32/linux). Anything ambiguous resolves to
 * `browse`, which works everywhere.
 * @param facts - the sampled host facts.
 * @returns the backend kind to mount.
 */
export function resolveDirectoryPickerBackend(facts: DirectoryPickerHostFacts): DirectoryPickerBackendKind {
  if (facts.bindHost !== '127.0.0.1') return 'browse'
  if (present(facts.env.SSH_CONNECTION) || present(facts.env.SSH_TTY)) return 'browse'
  if (facts.platform === 'darwin' || facts.platform === 'win32') return 'native'
  if (facts.platform !== 'linux' || !facts.linuxChooser) return 'browse'
  return present(facts.env.DISPLAY) || present(facts.env.WAYLAND_DISPLAY) ? 'native' : 'browse'
}
