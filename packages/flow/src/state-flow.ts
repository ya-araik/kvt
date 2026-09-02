import { reportFlowError } from './errors.js'
import { timeoutScheduler, type ScheduledTask, type Scheduler } from './scheduler.js'
import { ManagedSubscription, type Subscription } from './subscription.js'

const beginTransaction = Symbol('begin-transaction')
const endTransaction = Symbol('end-transaction')

export interface StateFlowSubscribeOptions {
  readonly emitCurrent?: boolean
  readonly signal?: AbortSignal
}

export interface StateFlow<T> {
  readonly value: T
  subscribe(listener: (value: T) => void | Promise<void>, options?: StateFlowSubscribeOptions): Subscription
}

export interface MutableStateFlowOptions<T> {
  readonly comparator?: (left: T, right: T) => boolean
  readonly name?: string
}

interface StateSubscriber<T> {
  readonly listener: (value: T) => void | Promise<void>
  readonly subscription: ManagedSubscription
}

export class MutableStateFlow<T> implements StateFlow<T> {
  #value: T
  readonly #comparator: (left: T, right: T) => boolean
  readonly #subscribers = new Set<StateSubscriber<T>>()
  readonly #readonly: StateFlow<T>
  readonly name: string | undefined
  #batchDepth = 0
  #batchStartValue: T | undefined
  #emissionDepth = 0

  constructor(initialValue: T, options: MutableStateFlowOptions<T> = {}) {
    this.#value = initialValue
    this.#comparator = options.comparator ?? Object.is
    this.name = options.name
    const getValue = () => this.value
    this.#readonly = Object.freeze({
      get value() {
        return getValue()
      },
      subscribe: (listener: (value: T) => void | Promise<void>, subscribeOptions?: StateFlowSubscribeOptions) =>
        this.subscribe(listener, subscribeOptions)
    })
  }

  get value(): T {
    return this.#value
  }

  get subscriberCount(): number {
    return this.#subscribers.size
  }

  set(value: T): void {
    if (this.#comparator(this.#value, value)) return
    this.#value = value
    if (this.#batchDepth === 0) this.#notify(value)
  }

  update(reducer: (value: T) => T): void {
    this.set(reducer(this.#value))
  }

  transaction<R>(operation: () => R): R {
    this[beginTransaction]()
    try {
      return operation()
    } finally {
      this[endTransaction]()
    }
  }

  [beginTransaction](): void {
    if (this.#batchDepth === 0) this.#batchStartValue = this.#value
    this.#batchDepth++
  }

  [endTransaction](): void {
    this.#batchDepth--
    if (this.#batchDepth === 0) {
      const start = this.#batchStartValue as T
      this.#batchStartValue = undefined
      if (!this.#comparator(start, this.#value)) this.#notify(this.#value)
    }
  }

  subscribe(listener: (value: T) => void | Promise<void>, options: StateFlowSubscribeOptions = {}): Subscription {
    const subscription = new ManagedSubscription()
    const subscriber: StateSubscriber<T> = { listener, subscription }
    const remove = () => {
      this.#subscribers.delete(subscriber)
    }
    subscription.setCleanup(remove)
    const signal = options.signal
    if (signal?.aborted) {
      subscription.cancel(signal.reason)
      return subscription
    }
    const abort = () => subscription.cancel(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    void subscription.done.finally(() => signal?.removeEventListener('abort', abort)).catch(() => undefined)
    this.#subscribers.add(subscriber)
    if (options.emitCurrent !== false) {
      if (this.#emissionDepth === 0) this.#invoke(subscriber, this.#value)
      else queueMicrotask(() => {
        if (!subscription.closed) this.#invoke(subscriber, this.#value)
      })
    }
    return subscription
  }

  asStateFlow(): StateFlow<T> {
    return this.#readonly
  }

  #notify(value: T): void {
    const snapshot = [...this.#subscribers]
    this.#emissionDepth++
    try {
      for (const subscriber of snapshot) {
        if (!subscriber.subscription.closed) this.#invoke(subscriber, value)
      }
    } finally {
      this.#emissionDepth--
    }
  }

  #invoke(subscriber: StateSubscriber<T>, value: T): void {
    try {
      const result = subscriber.listener(value)
      if (result instanceof Promise) {
        void result.catch((error: unknown) => reportFlowError(error, {
          operation: 'listener',
          ...(this.name === undefined ? {} : { flowName: this.name })
        }))
      }
    } catch (error) {
      reportFlowError(error, { operation: 'listener', ...(this.name === undefined ? {} : { flowName: this.name }) })
    }
  }
}

export class MutableObjectStateFlow<T extends object> extends MutableStateFlow<T> {
  patch(patch: Partial<T> | ((value: T) => Partial<T>)): void {
    this.update((value) => ({ ...value, ...(typeof patch === 'function' ? patch(value) : patch) }))
  }
}

export interface DerivedStateFlowOptions<T> {
  readonly comparator?: (left: T, right: T) => boolean
  readonly keepAliveMs?: number
  readonly scheduler?: Scheduler
}

export function derivedStateFlow<S extends readonly StateFlow<unknown>[], T>(
  sources: S,
  derive: (...values: { [K in keyof S]: S[K] extends StateFlow<infer V> ? V : never }) => T,
  options: DerivedStateFlowOptions<T> = {}
): StateFlow<T> {
  if (!Number.isFinite(options.keepAliveMs ?? 0) || (options.keepAliveMs ?? 0) < 0) {
    throw new RangeError('keepAliveMs must be a non-negative finite number')
  }
  type Values = { [K in keyof S]: S[K] extends StateFlow<infer V> ? V : never }
  let cached = derive(...sources.map((source) => source.value) as Values)
  let subscribers = 0
  let sourceSubscriptions: Subscription[] = []
  let stopTimer: ScheduledTask | undefined
  const output = new MutableStateFlow(cached, { ...(options.comparator === undefined ? {} : { comparator: options.comparator }) })

  const recompute = () => {
    cached = derive(...sources.map((source) => source.value) as Values)
    output.set(cached)
  }
  const start = () => {
    if (sourceSubscriptions.length > 0) return
    sourceSubscriptions = sources.map((source) => source.subscribe(recompute, { emitCurrent: false }))
    recompute()
  }
  const stop = () => {
    for (const subscription of sourceSubscriptions) subscription.cancel()
    sourceSubscriptions = []
  }

  return Object.freeze({
    get value() {
      if (subscribers === 0) cached = derive(...sources.map((source) => source.value) as Values)
      return cached
    },
    subscribe(listener: (value: T) => void | Promise<void>, subscribeOptions?: StateFlowSubscribeOptions) {
      if (stopTimer !== undefined) {
        stopTimer.cancel()
        stopTimer = undefined
      }
      subscribers++
      start()
      const subscription = output.subscribe(listener, subscribeOptions)
      void subscription.done.finally(() => {
        subscribers--
        if (subscribers !== 0) return
        if ((options.keepAliveMs ?? 0) > 0) stopTimer = (options.scheduler ?? timeoutScheduler).schedule(stop, options.keepAliveMs)
        else stop()
      }).catch(() => undefined)
      return subscription
    }
  })
}

export function batch(operation: () => void, ...states: readonly MutableStateFlow<unknown>[]): void {
  for (const state of states) state[beginTransaction]()
  try {
    operation()
  } finally {
    for (let index = states.length - 1; index >= 0; index--) states[index]![endTransaction]()
  }
}
