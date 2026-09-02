import { reportFlowError } from './errors.js'
import { ManagedSubscription, type Subscription } from './subscription.js'

export interface FlowObserver<T> {
  next(value: T): void | Promise<void>
  error?(error: unknown): void
  complete?(): void
}

export interface FlowProducerContext {
  readonly signal: AbortSignal
}

export type FlowCleanup = void | (() => void | Promise<void>)
export type FlowProducer<T> = (
  observer: FlowObserver<T>,
  context: FlowProducerContext
) => FlowCleanup | Promise<FlowCleanup>

export interface SubscribeOptions {
  readonly signal?: AbortSignal
}

export class Flow<T> {
  readonly #producer: FlowProducer<T>
  readonly name: string | undefined

  constructor(producer: FlowProducer<T>, options: { readonly name?: string } = {}) {
    this.#producer = producer
    this.name = options.name
  }

  subscribe(observer: FlowObserver<T> | ((value: T) => void | Promise<void>), options: SubscribeOptions = {}): Subscription {
    const normalized: FlowObserver<T> = typeof observer === 'function' ? { next: observer } : observer
    const subscription = new ManagedSubscription()
    const externalAbort = () => subscription.cancel(options.signal?.reason)
    if (options.signal?.aborted) {
      subscription.setCleanup()
      subscription.cancel(options.signal.reason)
      return subscription
    }
    options.signal?.addEventListener('abort', externalAbort, { once: true })

    let emissionChain = Promise.resolve()
    const safeObserver: FlowObserver<T> = {
      next: (value) => {
        if (subscription.closed) return
        emissionChain = emissionChain.then(async () => {
          if (subscription.closed) return
          try {
            await normalized.next(value)
          } catch (error) {
            reportFlowError(error, { operation: 'collector', ...(this.name === undefined ? {} : { flowName: this.name }) })
            throw error
          }
        })
        return emissionChain
      },
      error: (error) => {
        if (subscription.closed) return
        try {
          normalized.error?.(error)
        } catch (observerError) {
          reportFlowError(observerError, { operation: 'collector', ...(this.name === undefined ? {} : { flowName: this.name }) })
        } finally {
          subscription.fail(error)
        }
      },
      complete: () => {
        if (subscription.closed) return
        emissionChain.then(() => {
          try {
            normalized.complete?.()
            subscription.complete()
          } catch (error) {
            reportFlowError(error, { operation: 'collector', ...(this.name === undefined ? {} : { flowName: this.name }) })
            subscription.fail(error)
          }
        }, (error: unknown) => subscription.fail(error))
      }
    }

    try {
      const result = this.#producer(safeObserver, { signal: subscription.controller.signal })
      Promise.resolve(result).then(
        (cleanup) => {
          subscription.setCleanup(cleanup)
          safeObserver.complete?.()
        },
        (error: unknown) => {
          subscription.setCleanup()
          safeObserver.error?.(error)
        }
      )
    } catch (error) {
      subscription.setCleanup()
      safeObserver.error?.(error)
    }

    void subscription.done.finally(() => options.signal?.removeEventListener('abort', externalAbort)).catch(() => undefined)
    return subscription
  }

  collect(collector: (value: T) => void | Promise<void>, options: SubscribeOptions = {}): Promise<void> {
    return this.subscribe(collector, options).done
  }
}

export function flow<T>(producer: FlowProducer<T>, options?: { readonly name?: string }): Flow<T> {
  return new Flow(producer, options)
}

export function flowOf<T>(...values: readonly T[]): Flow<T> {
  return new Flow(async (observer, { signal }) => {
    for (const value of values) {
      if (signal.aborted) break
      await observer.next(value)
    }
  })
}

export function fromIterable<T>(values: Iterable<T>): Flow<T> {
  return new Flow(async (observer, { signal }) => {
    for (const value of values) {
      if (signal.aborted) break
      await observer.next(value)
    }
  })
}

export function fromAsyncIterable<T>(values: AsyncIterable<T>): Flow<T> {
  return new Flow(async (observer, { signal }) => {
    for await (const value of values) {
      if (signal.aborted) break
      await observer.next(value)
    }
  })
}

export interface CallbackFlowEmitter<T> {
  emit(value: T): Promise<void>
  close(): void
  fail(error: unknown): void
}

export function callbackFlow<T>(
  setup: (emitter: CallbackFlowEmitter<T>, signal: AbortSignal) => FlowCleanup | Promise<FlowCleanup>
): Flow<T> {
  return new Flow(async (observer, { signal }) => {
    let resolveClosed!: () => void
    let rejectClosed!: (error: unknown) => void
    const closed = new Promise<void>((resolve, reject) => {
      resolveClosed = resolve
      rejectClosed = reject
    })
    const cleanup = await setup({
      emit: async (value) => {
        if (!signal.aborted) await observer.next(value)
      },
      close: resolveClosed,
      fail: rejectClosed
    }, signal)
    const abort = () => resolveClosed()
    if (signal.aborted) resolveClosed()
    else signal.addEventListener('abort', abort, { once: true })
    try {
      await closed
    } finally {
      signal.removeEventListener('abort', abort)
      await cleanup?.()
    }
  })
}
