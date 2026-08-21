/**
 * @file 「未发布的 Session」所有权包装。
 *
 * 谁会用到：持久化层（`@deepseek-ai/dsh-session-persistence`）等「提供方」。
 * 这些方造出一个 Session 之后**不**会立刻 publish，先交给调用方（loop 等）
 * 做 setup；setup 成功后调用方负责 publish；失败则本类负责「释放」（归还 cache 或丢弃）。
 *
 * 接口：
 *   - `session`：那个具体的 Session 实例
 *   - `dispose()`：同步、幂等的释放回调；publish 后再调是 no-op
 */

/**
 * Ownership of one unpublished Session before registry publication.
 * @module @deepseek-ai/dsh-session/preparation
 */

import type { Session } from './index.ts'

/** Options for a preparation whose provider retains unpublished state. */
export interface SessionPreparationOptions {
  /** Release provider-owned state when the Session was not published. */
  readonly release?: () => void
}

/**
 * One exact unpublished Session and the provider state that keeps it usable.
 * Disposal is synchronous and idempotent. Providers decide whether release
 * returns the Session to a cache or discards it; publication may consume that
 * state before disposal, making the callback a no-op.
 */
export class SessionPreparation implements Disposable {
  private released = false

  /** The exact Session to use for setup and publication. */
  readonly session: Session

  private constructor(
    session: Session,
    private readonly options: SessionPreparationOptions,
  ) {
    this.session = session
  }

  /**
   * Wrap an unpublished Session in one preparation lifetime.
   * @param session - exact unpublished Session.
   * @param options - optional provider release behavior.
   * @returns a preparation disposed after publication or rollback.
   */
  static create(session: Session, options?: SessionPreparationOptions): SessionPreparation {
    return new SessionPreparation(session, options ?? {})
  }

  /** Release provider state once when this preparation leaves its caller. */
  [Symbol.dispose](): void {
    if (this.released) return
    this.released = true
    this.options.release?.()
  }
}
