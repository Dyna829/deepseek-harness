/**
 * @file `dsh-api-gateway` 的传输无关契约：request / service / 错误码。
 *
 * 把 `TypertGatewayErrorCode` 抽到独立文件有两层原因：
 *   1. 它是 wire 上**稳定**的字符串标签，跨 Host / Client / 不同 carrier
 *      都得能读懂，所以不能和实现细节（`index.ts` 的 Service 类、参数解析器）
 *      耦合在同一个文件；
 *   2. 调用方只需要在 catch 块里做 `error.code` 匹配时，希望少拉一堆无关代码。
 *
 * `InvokeRemoteRequest` 是 carrier 之外的「真正想调什么」形状：namespace、
 * method、严格 named args、可选 AbortSignal。Connection adapter 收到 wire
 * 后会把它翻成这个对象，再交给 `ctx.typertGateway.invoke`。
 *
 * 与其他模块的连接点：
 *   - `dsh-typert-protocol` 的 `InvocationDescriptor` 是这些 wire 字段的「来源」
 *   - `index.ts` 实现 `TypertGateway` 接口
 *   - `client/` 镜像消费同样的 error code（但通常只透传业务错误，不构造）
 */

/** One Remote method request after a carrier has decoded its envelope. */
export interface InvokeRemoteRequest {
  /** Remote namespace selected by the generated descriptor. */
  readonly namespace: string
  /** Exported Service method name. */
  readonly method: string
  /** Named wire values; fields must exactly match the descriptor. */
  readonly args: Readonly<Record<string, unknown>>
  /** Carrier or direct-caller cancellation injected only into cancellation-aware methods. */
  readonly signal?: AbortSignal
}

/** Stable infrastructure and boundary failures emitted before or after business execution. */
export type TypertGatewayErrorCode =
  | 'ambiguous-endpoint'
  | 'arguments-invalid'
  | 'binding-invalid'
  | 'context-failed'
  | 'context-not-found'
  | 'context-unavailable'
  | 'definition-unavailable'
  | 'input-invalid'
  | 'invocation-unavailable'
  | 'lookup-failed'
  | 'lookup-not-found'
  | 'lookup-unavailable'
  | 'method-unavailable'
  | 'provider-mismatch'
  | 'result-invalid'
  | 'service-unavailable'
  | 'signature-invalid'

/** Host dispatcher consumed by Connection adapters. */
export interface TypertGateway {
  /**
   * Invoke one live Remote method without assuming a carrier or response envelope.
   * @param request - decoded endpoint and named wire arguments.
   * @returns the validated business result.
   * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
   */
  invoke(request: InvokeRemoteRequest): Promise<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host dispatcher for Typert Remote calls. */
    typertGateway: TypertGateway
  }
}
