export interface EmbeddingProvider {
  embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]>
}

export interface RerankScore {
  readonly index: number
  readonly score: number
}

export interface RerankProvider {
  rerank(
    query: string,
    documents: readonly string[],
    topN: number,
    signal?: AbortSignal,
  ): Promise<readonly RerankScore[]>
}

export interface GenerationResult {
  readonly text: string
  readonly inputTokens?: number
  readonly outputTokens?: number
}

export interface GenerationProvider {
  generate(system: string, user: string, model: string, signal?: AbortSignal): Promise<GenerationResult>
}

export type ProviderErrorCode =
  | 'UNCONFIGURED'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'UNAVAILABLE'
  | 'BAD_RESPONSE'
  | 'HTTP_ERROR'
  | 'ABORTED'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly status?: number
  readonly retryAfterMs?: number
  readonly requestId?: string

  constructor(
    message: string,
    code: ProviderErrorCode,
    options: { status?: number; retryAfterMs?: number; requestId?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'ProviderError'
    this.code = code
    if (options.status !== undefined) this.status = options.status
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs
    if (options.requestId !== undefined) this.requestId = options.requestId
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof ProviderError && error.code === 'ABORTED'
    || error instanceof Error && error.name === 'AbortError'
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Aborted', 'AbortError')
}
