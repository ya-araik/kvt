import { reportFlowError } from './errors.js'
import { ManagedSubscription, type Subscription } from './subscription.js'

export type BufferOverflow = 'suspend' | 'drop-oldest' | 'drop-latest' | 'error'

export interface SharedFlowOptions {
  readonly replay?: number
  readonly extraBufferCapacity?: number
  readonly overflow?: BufferOverflow
  readonly name?: string
}

export interface SharedFlow<T> {
  readonly subscriberCount: number
  subscribe(listener: (value: T) => void | Promise<void>, options?: { readonly signal?: AbortSignal }): Subscription
}

interface PendingValue<T> {
  readonly value: T
  readonly resolve?: () => void
  readonly reject?: (error: unknown) => void
}

interface SharedSubscriber<T> {
  readonly listener: (value: T) => void | Promise<void>
  readonly subscription: ManagedSubscription
  readonly queue: PendingValue<T>[]
  readonly spaceWaiters: Array<() => void>
  processing: boolean
  current: PendingValue<T> | undefined
}

export class SharedFlowOverflowError extends Error {
  constructor() {
    super('SharedFlow subscriber buffer overflowed')
    this.name = 'SharedFlowOverflowError'
  }
}

export class MutableSharedFlow<T> implements SharedFlow<T> {
  readonly #replayLimit: number
  readonly #capacity: number
  readonly #overflow: BufferOverflow
  readonly #replay: T[] = []
  readonly #subscribers = new Set<SharedSubscriber<T>>()
  readonly #readonly: SharedFlow<T>
  readonly name: string | undefined

  constructor(options: SharedFlowOptions = {}) {
    this.#replayLimit = normalizeCapacity(options.replay ?? 0, 'replay')
    this.#capacity = this.#replayLimit + normalizeCapacity(options.extraBufferCapacity ?? 0, 'extraBufferCapacity')
    this.#overflow = options.overflow ?? 'suspend'
    this.name = options.name
    const getSubscriberCount = () => this.subscriberCount
    this.#readonly = Object.freeze({
      get subscriberCount() {
        return getSubscriberCount()
      },
      subscribe: (listener: (value: T) => void | Promise<void>, subscribeOptions?: { readonly signal?: AbortSignal }) =>
        this.subscribe(listener, subscribeOptions)
    })
  }

  get subscriberCount(): number {
    return this.#subscribers.size
  }

  async emit(value: T): Promise<void> {
    this.#remember(value)
    await Promise.all([...this.#subscribers].map((subscriber) => this.#enqueue(subscriber, value, true)))
  }

  tryEmit(value: T): boolean {
    const subscribers = [...this.#subscribers]
    if (this.#overflow === 'suspend' && subscribers.some((subscriber) => this.#isFull(subscriber))) return false
    if (this.#overflow === 'error' && subscribers.some((subscriber) => this.#isFull(subscriber))) return false
    this.#remember(value)
    for (const subscriber of subscribers) void this.#enqueue(subscriber, value, false)
    return true
  }

  subscribe(listener: (value: T) => void | Promise<void>, options: { readonly signal?: AbortSignal } = {}): Subscription {
    const subscription = new ManagedSubscription()
    const subscriber: SharedSubscriber<T> = {
      listener, subscription, queue: [], spaceWaiters: [], processing: false, current: undefined
    }
    const cleanup = () => {
      this.#subscribers.delete(subscriber)
      subscriber.current?.resolve?.()
      subscriber.current = undefined
      for (const entry of subscriber.queue.splice(0)) entry.resolve?.()
      for (const resolve of subscriber.spaceWaiters.splice(0)) resolve()
    }
    subscription.setCleanup(cleanup)
    const signal = options.signal
    if (signal?.aborted) {
      subscription.cancel(signal.reason)
      return subscription
    }
    const abort = () => subscription.cancel(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    void subscription.done.finally(() => signal?.removeEventListener('abort', abort)).catch(() => undefined)
    this.#subscribers.add(subscriber)
    for (const replayed of this.#replay) void this.#enqueue(subscriber, replayed, false, true)
    return subscription
  }

  asSharedFlow(): SharedFlow<T> {
    return this.#readonly
  }

  resetReplayCache(): void {
    this.#replay.length = 0
  }

  #remember(value: T): void {
    if (this.#replayLimit === 0) return
    this.#replay.push(value)
    if (this.#replay.length > this.#replayLimit) this.#replay.splice(0, this.#replay.length - this.#replayLimit)
  }

  #isFull(subscriber: SharedSubscriber<T>): boolean {
    return subscriber.processing && subscriber.queue.length >= this.#capacity
  }

  async #enqueue(subscriber: SharedSubscriber<T>, value: T, awaitDelivery: boolean, replay = false): Promise<void> {
    if (subscriber.subscription.closed) return Promise.resolve()
    if (!replay && this.#isFull(subscriber)) {
      if (this.#overflow === 'drop-latest') return Promise.resolve()
      if (this.#overflow === 'drop-oldest') subscriber.queue.shift()?.resolve?.()
      if (this.#overflow === 'error') return Promise.reject(new SharedFlowOverflowError())
      if (this.#overflow === 'suspend') {
        await new Promise<void>((resolve) => subscriber.spaceWaiters.push(resolve))
        if (subscriber.subscription.closed) return
      }
    }
    const delivery = awaitDelivery
      ? new Promise<void>((resolve, reject) => subscriber.queue.push({ value, resolve, reject }))
      : (subscriber.queue.push({ value }), Promise.resolve())
    this.#drain(subscriber)
    return delivery
  }

  #drain(subscriber: SharedSubscriber<T>): void {
    if (subscriber.processing || subscriber.subscription.closed) return
    subscriber.processing = true
    const next = async (): Promise<void> => {
      while (!subscriber.subscription.closed) {
        const entry = subscriber.queue.shift()
        if (!entry) break
        subscriber.current = entry
        if (this.#capacity > 0) subscriber.spaceWaiters.shift()?.()
        try {
          await subscriber.listener(entry.value)
          entry.resolve?.()
        } catch (error) {
          entry.resolve?.()
          reportFlowError(error, { operation: 'listener', ...(this.name === undefined ? {} : { flowName: this.name }) })
        } finally {
          subscriber.current = undefined
        }
        if (this.#capacity === 0) subscriber.spaceWaiters.shift()?.()
      }
      subscriber.processing = false
    }
    void next()
  }
}

function normalizeCapacity(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
  return value
}
