/**
 * @file `dsh-host-frontend-static`——SPA dist 在 webserver fallback seat 上的
 * 静态 server。
 *
 * 关键设计点（**写代码容易绕过的**）：
 *   - **「dist root 之外 = 403」**：`resolve(normalize(join(distRoot, pathname)))`
 *     **必须**等于 `distRoot` 自身（`/`）**或**以 `distRoot + sep` 开头。
 *     `sep`（**不**是 `/`）——`resolve()` 在 Windows 上 emit 反斜杠路径，
 *     `target.startsWith(distRoot + '/')` 会把「C:\dist\sub\file」拒成
 *     traversal。
 *   - **「任何 miss → 200 + index.html」**：S**P**A 路由 fallback——client
 *     router 接住路径参数，**不**让后端 404。
 *   - **「非 GET/HEAD = 405」**：fallback-only 语义——named route 自己
 *     拥有 method 处理权；fallback 拿到的**不**该是 PUT/POST。
 *   - **「index 走 webserver 的 index taps」**：`renderIndex` 调
 *     `ctx.webServer.applyIndexTaps(...)`——boot-manifest 注入等
 *     composition-level 的插入**都**通过 tap 走，**不** hard-code 到本
 *     文件。
 *   - **「未知扩展 = octet-stream」**：`MIME[ext] ?? 'application/octet-stream'`
 *     ——**不**让未知 type 拿到「猜」的 MIME 头。
 *   - **`distIndex` 是 workspace 知识**：典型由 `cordis.yml` 里 `!!js`
 *     表达式**算**出来，**不**让 deployment 硬编 dist 位置。
 *
 * 与其他模块的连接点：
 *   - `ctx.webServer.registerFallback` 是挂载点（fallback seat）
 *   - `ctx.webServer.applyIndexTaps` 是 index 注入钩子
 *   - `node:fs/promises` 提供 `readFile`
 *   - 任何把 dist 路径作为 `cordis.yml` 表达式计算的上游 composition
 *   - `host/webserver` 提供 fallback seat
 */

import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Service required before the fallback seat can be claimed. */
export const inject = ['webServer']

/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
})

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param renderIndex - produces the index.html body (index-tap injection) for
 * `/` and every SPA fallback.
 */
export async function serveStatic(
  pathname: string, res: ServerResponse, distRoot: string, distIndex: string,
  renderIndex: () => Promise<string>,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  const serveIndex = async (): Promise<void> => {
    const body = await renderIndex()
    res.writeHead(200, { 'content-type': MIME['.html'] })
    res.end(body)
  }
  if (target === distRoot || target === distIndex) {
    await serveIndex()
    return
  }
  try {
    const body = await readFile(target)
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    // Miss (ENOENT/EISDIR) falls back to index.html with 200 (SPA routing).
    await serveIndex()
  }
}

/**
 * Claim the webserver fallback seat and serve the dist.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  const renderIndex = async (): Promise<string> =>
    ctx.webServer.applyIndexTaps(await readFile(distIndex, 'utf8'))
  ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
    // Non-GET/HEAD without a matching named route is 405 (fallback-only
    // semantics: named routes own their method handling).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests */
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    await serveStatic(decodeURIComponent(rawPath), res, distRoot, distIndex, renderIndex)
  }), 'frontend-static: fallback seat')
}
