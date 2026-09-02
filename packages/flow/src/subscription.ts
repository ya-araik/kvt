export interface Subscription {
  readonly closed: boolean
  readonly done: Promise<void>
  cancel(reason?: unknown): void
  dispose(): void
}

export class FlowCancelledError extends Error {
  constructor(message = 'Flow collection was cancelled', options?: ErrorOptions) {
    super(message, options)
    this.name = 'FlowCancelledError'
  }
}

export class ManagedSubscription implements Subscription {
  readonly done: Promise<void>
  readonly controller = new AbortController()
  #closed = false
  #resolve!: () => void
  #reject!: (reason: unknown) => void
  #cleanup: (() => void | Promise<void>) | undefined
  #cleanupReady = false
  #terminal: { readonly kind: 'resolve' } | { readonly kind: 'reject'; readonly error: unknown } | undefined
  #finalizing = false

  constructor() {
    this.done = new Promise<void>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
  }

  get closed(): boolean {
    return this.#closed
  }

  setCleanup(cleanup: void | (() => void | Promise<void>)): void {
    this.#cleanup = cleanup ?? undefined
    this.#cleanupReady = true
    if (this.#closed) this.#finalize()
  }

  complete(): void {
    if (this.#closed) return
    this.#closed = true
    this.#terminal = { kind: 'resolve' }
    this.#finalize()
  }

  fail(error: unknown): void {
    if (this.#closed) return
    this.#closed = true
    this.#terminal = { kind: 'reject', error }
    this.#finalize()
  }

  cancel(reason?: unknown): void {
    if (this.#closed) return
    this.#closed = true
    this.controller.abort(reason)
    this.#terminal = { kind: 'resolve' }
    this.#finalize()
  }

  dispose(): void {
    this.cancel()
  }

  async #runCleanup(): Promise<void> {
    const cleanup = this.#cleanup
    this.#cleanup = undefined
    await cleanup?.()
  }

  #finalize(): void {
    if (!this.#cleanupReady || this.#finalizing || !this.#terminal) return
    this.#finalizing = true
    const terminal = this.#terminal
    void this.#runCleanup().then(
      () => terminal.kind === 'resolve' ? this.#resolve() : this.#reject(terminal.error),
      (cleanupError) => terminal.kind === 'resolve'
        ? this.#reject(cleanupError)
        : this.#reject(new AggregateError([terminal.error, cleanupError], 'Flow and cleanup failed'))
    )
  }
}
