import { Connectivity } from '../../domain/repository/connectivity.js'

export class HttpRequestFailure extends Error {
  constructor(
    readonly kind: 'network' | 'response',
    readonly status?: number,
    options?: ErrorOptions
  ) {
    super(
      kind === 'network' ? 'The API is unavailable' : `The API returned ${String(status)}`,
      options
    )
    this.name = 'HttpRequestFailure'
  }
}

export class JsonServerHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly connectivity: Connectivity
  ) {}

  async request(
    path: string,
    options: {
      readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
      readonly body?: unknown
      readonly signal: AbortSignal
    }
  ): Promise<unknown> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        signal: options.signal,
        ...(options.body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(options.body)
            })
      })
      if (!response.ok) {
        this.connectivity.setReachable()
        throw new HttpRequestFailure('response', response.status)
      }
      this.connectivity.setReachable()
      if (response.status === 204) return undefined
      const text = await response.text()
      return text.length === 0 ? undefined : (JSON.parse(text) as unknown)
    } catch (error) {
      if (options.signal.aborted) throw error
      if (error instanceof HttpRequestFailure) throw error
      this.connectivity.setUnreachable()
      throw new HttpRequestFailure('network', undefined, { cause: error })
    }
  }
}
