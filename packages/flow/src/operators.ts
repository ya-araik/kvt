import { Flow } from './flow.js'
import { reportFlowError } from './errors.js'
import type { ScheduledTask, Scheduler } from './scheduler.js'
import { timeoutScheduler } from './scheduler.js'
import { MutableSharedFlow, type BufferOverflow, type SharedFlow } from './shared-flow.js'
import { MutableStateFlow, type StateFlow } from './state-flow.js'
import type { Subscription } from './subscription.js'

export function map<T, R>(source: Flow<T>, transform: (value: T) => R | Promise<R>): Flow<R> {
  return new Flow((observer, context) => source.collect(async (value) => observer.next(await transform(value)), context))
}

export function filter<T>(source: Flow<T>, predicate: (value: T) => boolean | Promise<boolean>): Flow<T> {
  return new Flow((observer, context) => source.collect(async (value) => {
    if (await predicate(value)) await observer.next(value)
  }, context))
}

export function distinctUntilChanged<T>(source: Flow<T>, comparator: (left: T, right: T) => boolean = Object.is): Flow<T> {
  return new Flow((observer, context) => {
    let initialized = false
    let previous: T
    return source.collect(async (value) => {
      if (!initialized || !comparator(previous, value)) {
        initialized = true
        previous = value
        await observer.next(value)
      }
    }, context)
  })
}

export function scan<T, R>(source: Flow<T>, initial: R, reducer: (accumulator: R, value: T) => R | Promise<R>): Flow<R> {
  return new Flow(async (observer, context) => {
    let accumulator = initial
    await observer.next(accumulator)
    await source.collect(async (value) => {
      accumulator = await reducer(accumulator, value)
      await observer.next(accumulator)
    }, context)
  })
}

export function take<T>(source: Flow<T>, count: number): Flow<T> {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('count must be a non-negative safe integer')
  return new Flow(async (observer, { signal }) => {
    if (count === 0) return
    const link = linkedAbortController(signal)
    const controller = link.controller
    let emitted = 0
    const subscription = source.subscribe(async (value) => {
      if (emitted >= count) return
      emitted++
      await observer.next(value)
      if (emitted === count) controller.abort('take-complete')
    }, { signal: controller.signal })
    try { await subscription.done } finally { link.dispose() }
  })
}

export function drop<T>(source: Flow<T>, count: number): Flow<T> {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('count must be a non-negative safe integer')
  return new Flow((observer, context) => {
    let seen = 0
    return source.collect(async (value) => {
      if (seen++ >= count) await observer.next(value)
    }, context)
  })
}

export function onEach<T>(source: Flow<T>, action: (value: T) => void | Promise<void>): Flow<T> {
  return new Flow((observer, context) => source.collect(async (value) => {
    await action(value)
    await observer.next(value)
  }, context))
}

export function onStart<T>(source: Flow<T>, action: () => void | Promise<void>): Flow<T> {
  return new Flow(async (observer, context) => {
    await action()
    await source.collect((value) => observer.next(value), context)
  })
}

export function onCompletion<T>(source: Flow<T>, action: (error?: unknown) => void | Promise<void>): Flow<T> {
  return new Flow(async (observer, context) => {
    let failure: unknown
    try {
      await source.collect((value) => observer.next(value), context)
    } catch (error) {
      failure = error
      throw error
    } finally {
      await action(failure)
    }
  })
}

export function catchFlow<T>(source: Flow<T>, recover: (error: unknown) => Flow<T> | Promise<Flow<T>>): Flow<T> {
  return new Flow(async (observer, context) => {
    try {
      await source.collect((value) => observer.next(value), context)
    } catch (error) {
      await (await recover(error)).collect((value) => observer.next(value), context)
    }
  })
}

export interface RetryOptions {
  readonly attempts?: number
  readonly delayMs?: number | ((attempt: number, error: unknown) => number)
  readonly scheduler?: Scheduler
  readonly predicate?: (error: unknown) => boolean | Promise<boolean>
}

export function retry<T>(source: Flow<T>, options: RetryOptions = {}): Flow<T> {
  const attempts = options.attempts ?? 3
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new RangeError('attempts must be a positive safe integer')
  return retryWhen(source, async (error, attempt) => {
    if (attempt + 1 >= attempts) return false
    return await (options.predicate?.(error) ?? true)
  }, options)
}

export function retryWhen<T>(
  source: Flow<T>,
  predicate: (error: unknown, attempt: number) => boolean | Promise<boolean>,
  options: Pick<RetryOptions, 'delayMs' | 'scheduler'> = {}
): Flow<T> {
  return new Flow(async (observer, context) => {
    let attempt = 0
    while (!context.signal.aborted) {
      try {
        await source.collect((value) => observer.next(value), context)
        return
      } catch (error) {
        if (!await predicate(error, attempt)) throw error
        attempt++
        const delayMs = typeof options.delayMs === 'function' ? options.delayMs(attempt, error) : options.delayMs ?? 0
        validateDuration(delayMs, 'retry delay')
        if (delayMs > 0) await (options.scheduler ?? timeoutScheduler).sleep(delayMs, context.signal)
      }
    }
  })
}

export function delay<T>(source: Flow<T>, durationMs: number, scheduler: Scheduler = timeoutScheduler): Flow<T> {
  validateDuration(durationMs, 'delay')
  return new Flow((observer, context) => source.collect(async (value) => {
    await scheduler.sleep(durationMs, context.signal)
    await observer.next(value)
  }, context))
}

export function debounce<T>(source: Flow<T>, durationMs: number, scheduler: Scheduler = timeoutScheduler): Flow<T> {
  validateDuration(durationMs, 'debounce duration')
  return new Flow(async (observer, context) => {
    const link = linkedAbortController(context.signal)
    let pending: ReturnType<Scheduler['schedule']> | undefined
    let pendingValue: T | undefined
    let hasValue = false
    let emissionFailure: unknown
    try {
      await source.collect((value) => {
        pendingValue = value
        hasValue = true
        pending?.cancel()
        pending = scheduler.schedule(() => {
          if (!hasValue || context.signal.aborted) return
          hasValue = false
          void Promise.resolve(observer.next(pendingValue as T)).catch((error: unknown) => {
            emissionFailure = error
            link.controller.abort(error)
          })
        }, durationMs)
      }, { signal: link.controller.signal })
      if (emissionFailure !== undefined) throw emissionFailure
      if (hasValue && !context.signal.aborted) await observer.next(pendingValue as T)
    } finally {
      pending?.cancel()
      link.dispose()
    }
  })
}

export function throttle<T>(source: Flow<T>, durationMs: number, scheduler: Scheduler = timeoutScheduler): Flow<T> {
  validateDuration(durationMs, 'throttle duration')
  return new Flow((observer, context) => {
    let nextAllowed = Number.NEGATIVE_INFINITY
    return source.collect(async (value) => {
      if (scheduler.now < nextAllowed) return
      nextAllowed = scheduler.now + durationMs
      await observer.next(value)
    }, context)
  })
}

export function sample<T>(source: Flow<T>, durationMs: number, scheduler: Scheduler = timeoutScheduler): Flow<T> {
  validatePositiveDuration(durationMs, 'sample duration')
  return new Flow(async (observer, context) => {
    const link = linkedAbortController(context.signal)
    let latest: T | undefined
    let hasLatest = false
    let task: ReturnType<Scheduler['schedule']> | undefined
    let emissionFailure: unknown
    const tick = () => {
      if (context.signal.aborted) return
      if (hasLatest) {
        hasLatest = false
        void Promise.resolve(observer.next(latest as T)).catch((error: unknown) => {
          emissionFailure = error
          link.controller.abort(error)
        })
      }
      task = scheduler.schedule(tick, durationMs)
    }
    task = scheduler.schedule(tick, durationMs)
    try {
      await source.collect((value) => {
        latest = value
        hasLatest = true
      }, { signal: link.controller.signal })
      if (emissionFailure !== undefined) throw emissionFailure
    } finally {
      task?.cancel()
      link.dispose()
    }
  })
}

export function timeout<T>(source: Flow<T>, durationMs: number, scheduler: Scheduler = timeoutScheduler): Flow<T> {
  validateDuration(durationMs, 'timeout duration')
  return new Flow(async (observer, { signal }) => {
    const link = linkedAbortController(signal)
    const controller = link.controller
    let timer = scheduler.schedule(() => controller.abort(new DOMException('Flow timed out', 'TimeoutError')), durationMs)
    const reset = () => {
      timer.cancel()
      timer = scheduler.schedule(() => controller.abort(new DOMException('Flow timed out', 'TimeoutError')), durationMs)
    }
    const subscription = source.subscribe(async (value) => {
      reset()
      await observer.next(value)
    }, { signal: controller.signal })
    try {
      await subscription.done
      if (controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError') {
        throw controller.signal.reason
      }
    } finally {
      timer.cancel()
      link.dispose()
    }
  })
}

export function merge<T>(...sources: readonly Flow<T>[]): Flow<T> {
  return new Flow(async (observer, { signal }) => {
    const link = linkedAbortController(signal)
    const collections = sources.map((source) => source.collect((value) => observer.next(value), { signal: link.controller.signal }))
    try {
      await Promise.all(collections)
    } catch (error) {
      link.controller.abort(error)
      await Promise.allSettled(collections)
      throw error
    } finally {
      link.dispose()
    }
  })
}

export function zip<A, B>(left: Flow<A>, right: Flow<B>): Flow<readonly [A, B]> {
  return new Flow(async (observer, { signal }) => {
    const link = linkedAbortController(signal)
    const leftQueue: A[] = []
    const rightQueue: B[] = []
    let leftDone = false
    let rightDone = false
    let drain = Promise.resolve()
    const completed = Symbol('zip-completed')
    const emitPairs = () => {
      drain = drain.then(async () => {
      while (leftQueue.length > 0 && rightQueue.length > 0) {
        await observer.next([leftQueue.shift() as A, rightQueue.shift() as B])
      }
        if ((leftDone && leftQueue.length === 0) || (rightDone && rightQueue.length === 0)) {
          link.controller.abort(completed)
        }
      })
      return drain
    }
    const collections = [
      left.collect((value) => { leftQueue.push(value); return emitPairs() }, { signal: link.controller.signal })
        .then(() => { leftDone = true; return emitPairs() }),
      right.collect((value) => { rightQueue.push(value); return emitPairs() }, { signal: link.controller.signal })
        .then(() => { rightDone = true; return emitPairs() })
    ]
    try {
      await Promise.all(collections)
      await drain
    } catch (error) {
      if (link.controller.signal.reason !== completed) {
        link.controller.abort(error)
        await Promise.allSettled(collections)
        throw error
      }
    } finally {
      link.dispose()
    }
  })
}

export function combine<A, B, R>(
  left: Flow<A>,
  right: Flow<B>,
  transform: (left: A, right: B) => R | Promise<R>
): Flow<R> {
  return new Flow(async (observer, { signal }) => {
    const link = linkedAbortController(signal)
    let leftValue: A
    let rightValue: B
    let hasLeft = false
    let hasRight = false
    let chain = Promise.resolve()
    const noValueCompletion = Symbol('combine-source-completed-without-value')
    const emit = () => {
      if (!hasLeft || !hasRight) return chain
      const currentLeft = leftValue
      const currentRight = rightValue
      chain = chain.then(async () => observer.next(await transform(currentLeft, currentRight)))
      return chain
    }
    const collections = [
      left.collect((value) => { leftValue = value; hasLeft = true; return emit() }, { signal: link.controller.signal })
        .then(() => { if (!hasLeft) link.controller.abort(noValueCompletion) }),
      right.collect((value) => { rightValue = value; hasRight = true; return emit() }, { signal: link.controller.signal })
        .then(() => { if (!hasRight) link.controller.abort(noValueCompletion) })
    ]
    try {
      await Promise.all(collections)
      await chain
    } catch (error) {
      if (link.controller.signal.reason !== noValueCompletion) {
        link.controller.abort(error)
        await Promise.allSettled(collections)
        throw error
      }
    } finally {
      link.dispose()
    }
  })
}

type FlattenMode = 'latest' | 'concat' | 'merge' | 'first'

function flatten<T, R>(source: Flow<T>, transform: (value: T) => Flow<R>, mode: FlattenMode, concurrency = Infinity): Flow<R> {
  return new Flow(async (observer, { signal }) => {
    const link = linkedAbortController(signal)
    const active = new Set<Subscription>()
    const queue: T[] = []
    let outerComplete = false
    let resolveDone!: () => void
    let rejectDone!: (error: unknown) => void
    const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject })

    const checkDone = () => {
      if (outerComplete && active.size === 0 && queue.length === 0) resolveDone()
    }
    const start = (value: T) => {
      const inner = transform(value).subscribe((result) => observer.next(result), { signal: link.controller.signal })
      active.add(inner)
      void inner.done.then(() => {
        active.delete(inner)
        if (mode === 'concat' && queue.length > 0) start(queue.shift() as T)
        else if (mode === 'merge' && queue.length > 0 && active.size < concurrency) start(queue.shift() as T)
        checkDone()
      }, (error: unknown) => { link.controller.abort(error); rejectDone(error) })
    }

    const outer = source.subscribe((value) => {
      if (mode === 'latest') {
        for (const subscription of active) subscription.cancel('flatMapLatest replaced')
        active.clear()
        start(value)
      } else if (mode === 'first') {
        if (active.size === 0) start(value)
      } else if (mode === 'concat') {
        if (active.size === 0) start(value)
        else queue.push(value)
      } else if (active.size < concurrency) start(value)
      else queue.push(value)
    }, { signal: link.controller.signal })
    void outer.done.then(() => { outerComplete = true; checkDone() }, (error: unknown) => {
      link.controller.abort(error)
      rejectDone(error)
    })
    try {
      await done
    } finally {
      outer.cancel()
      for (const subscription of active) subscription.cancel()
      link.dispose()
    }
  })
}

export const flatMapLatest = <T, R>(source: Flow<T>, transform: (value: T) => Flow<R>): Flow<R> => flatten(source, transform, 'latest')
export const flatMapConcat = <T, R>(source: Flow<T>, transform: (value: T) => Flow<R>): Flow<R> => flatten(source, transform, 'concat')
export const flatMapFirst = <T, R>(source: Flow<T>, transform: (value: T) => Flow<R>): Flow<R> => flatten(source, transform, 'first')
export const flatMapMerge = <T, R>(source: Flow<T>, transform: (value: T) => Flow<R>, concurrency = Infinity): Flow<R> => {
  if (concurrency !== Infinity && (!Number.isSafeInteger(concurrency) || concurrency < 1)) {
    throw new RangeError('concurrency must be a positive safe integer or Infinity')
  }
  return flatten(source, transform, 'merge', concurrency)
}

export type SharingStart =
  | { readonly type: 'eager' }
  | { readonly type: 'lazy' }
  | { readonly type: 'while-subscribed'; readonly stopTimeoutMs?: number; readonly replayExpirationMs?: number }

export interface ShareInOptions {
  readonly started?: SharingStart
  readonly replay?: number
  readonly extraBufferCapacity?: number
  readonly overflow?: BufferOverflow
  readonly scheduler?: Scheduler
  readonly signal?: AbortSignal
}

export function shareIn<T>(source: Flow<T>, options: ShareInOptions = {}): SharedFlow<T> {
  const output = new MutableSharedFlow<T>({
    ...(options.replay === undefined ? {} : { replay: options.replay }),
    ...(options.extraBufferCapacity === undefined ? {} : { extraBufferCapacity: options.extraBufferCapacity }),
    ...(options.overflow === undefined ? {} : { overflow: options.overflow })
  })
  const started = options.started ?? { type: 'lazy' }
  if (started.type === 'while-subscribed') {
    validateDuration(started.stopTimeoutMs ?? 0, 'sharing stop timeout')
    const replayExpiration = started.replayExpirationMs ?? Infinity
    if (replayExpiration !== Infinity) validateDuration(replayExpiration, 'sharing replay expiration')
  }
  const scheduler = options.scheduler ?? timeoutScheduler
  let sourceSubscription: Subscription | undefined
  let sourceState: 'idle' | 'running' | 'completed' | 'stopped' = 'idle'
  let subscribers = 0
  let stopTimer: ScheduledTask | undefined
  let replayTimer: ScheduledTask | undefined

  const start = () => {
    if (sourceState === 'running' || sourceState === 'completed' || options.signal?.aborted) return
    sourceState = 'running'
    sourceSubscription = source.subscribe((value) => output.emit(value), { ...(options.signal === undefined ? {} : { signal: options.signal }) })
    void sourceSubscription.done.then(() => {
      if (sourceState === 'running') sourceState = 'completed'
    }, (error: unknown) => {
      if (sourceState === 'running') sourceState = 'completed'
      reportFlowError(error, { operation: 'producer', flowName: 'shareIn' })
    })
  }
  const stop = () => {
    sourceState = 'stopped'
    sourceSubscription?.cancel('shareIn stopped')
    sourceSubscription = undefined
    if (started.type === 'while-subscribed' && (started.replayExpirationMs ?? Infinity) !== Infinity) {
      replayTimer = scheduler.schedule(() => output.resetReplayCache(), started.replayExpirationMs ?? 0)
    }
  }
  if (started.type === 'eager') start()

  return Object.freeze({
    get subscriberCount() {
      return subscribers
    },
    subscribe(listener: (value: T) => void | Promise<void>, subscribeOptions?: { readonly signal?: AbortSignal }) {
      const subscription = output.subscribe(listener, subscribeOptions)
      if (subscription.closed) return subscription
      subscribers++
      stopTimer?.cancel()
      replayTimer?.cancel()
      start()
      void subscription.done.finally(() => {
        subscribers--
        if (subscribers === 0 && started.type === 'while-subscribed') {
          stopTimer = scheduler.schedule(stop, started.stopTimeoutMs ?? 0)
        }
      }).catch(() => undefined)
      return subscription
    }
  })
}

export function stateIn<T>(source: Flow<T>, initialValue: T, options: Omit<ShareInOptions, 'replay'> = {}): StateFlow<T> {
  const state = new MutableStateFlow(initialValue)
  const shared = shareIn(source, { ...options, replay: 1 })
  let leases = 0
  let sourceSubscription: Subscription | undefined
  const attach = () => {
    if (!sourceSubscription || sourceSubscription.closed) {
      sourceSubscription = shared.subscribe((value) => state.set(value))
    }
  }
  if (options.started?.type === 'eager') attach()
  return Object.freeze({
    get value() {
      return state.value
    },
    subscribe(listener: (value: T) => void | Promise<void>, subscribeOptions?: Parameters<StateFlow<T>['subscribe']>[1]) {
      leases++
      attach()
      const subscription = state.subscribe(listener, subscribeOptions)
      void subscription.done.finally(() => {
        leases--
        if (leases === 0 && options.started?.type === 'while-subscribed') sourceSubscription?.cancel()
      }).catch(() => undefined)
      return subscription
    }
  })
}

function validateDuration(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number`)
}

function validatePositiveDuration(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`)
}

function linkedAbortController(parent: AbortSignal): { readonly controller: AbortController; dispose(): void } {
  const controller = new AbortController()
  const abort = () => controller.abort(parent.reason)
  if (parent.aborted) controller.abort(parent.reason)
  else parent.addEventListener('abort', abort, { once: true })
  return {
    controller,
    dispose: () => parent.removeEventListener('abort', abort)
  }
}
