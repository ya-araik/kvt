import { describe, expect, it, vi } from 'vitest'
import {
  Flow,
  FlowCancelledError,
  ManagedSubscription,
  MutableObjectStateFlow,
  MutableSharedFlow,
  MutableStateFlow,
  SharedFlowOverflowError,
  TaskController,
  VirtualScheduler,
  animationFrameScheduler,
  callbackFlow,
  catchFlow,
  combine,
  debounce,
  delay,
  derivedStateFlow,
  distinctUntilChanged,
  drop,
  filter,
  flatMapConcat,
  flatMapFirst,
  flatMapLatest,
  flatMapMerge,
  flow,
  flowOf,
  fromAsyncIterable,
  fromIterable,
  immediateScheduler,
  microtaskScheduler,
  onCompletion,
  onEach,
  onStart,
  retry,
  retryWhen,
  scan,
  setFlowErrorReporter,
  stateIn,
  take,
  throttle,
  timeout,
  timeoutScheduler,
  zip
} from '../src/index.js'

async function valuesOf<T>(source: Flow<T>): Promise<T[]> {
  const values: T[] = []
  await source.collect((value) => { values.push(value) })
  return values
}

describe('cold Flow contract edges', () => {
  it('supports factories, iterable sources, async iterable sources and cleanup', async () => {
    expect(await valuesOf(flowOf(1, 2))).toEqual([1, 2])
    expect(await valuesOf(fromIterable(new Set([3, 4])))).toEqual([3, 4])
    async function* generated() { yield 5; yield 6 }
    expect(await valuesOf(fromAsyncIterable(generated()))).toEqual([5, 6])
    const cleanup = vi.fn()
    await flow<number>(async (observer) => { await observer.next(7); return cleanup }, { name: 'named' }).collect(() => undefined)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('cancels pre-aborted and externally aborted collections', async () => {
    const pre = new AbortController()
    pre.abort('already')
    const producer = vi.fn()
    const preSubscription = new Flow(producer).subscribe(() => undefined, { signal: pre.signal })
    await preSubscription.done
    expect(producer).not.toHaveBeenCalled()

    const external = new AbortController()
    let cleaned = false
    const subscription = callbackFlow((_emitter, signal) => {
      signal.addEventListener('abort', () => undefined)
      return () => { cleaned = true }
    }).subscribe(() => undefined, { signal: external.signal })
    external.abort('stop')
    await subscription.done
    expect(cleaned).toBe(true)
  })

  it('isolates observer error callbacks and reports collector/complete failures', async () => {
    const reports: unknown[] = []
    const restore = setFlowErrorReporter((error) => reports.push(error))
    const producerError = new Flow<number>(() => { throw new Error('producer') })
    const subscription = producerError.subscribe({
      next: () => undefined,
      error: () => { throw new Error('observer-error') }
    })
    await expect(subscription.done).rejects.toThrow('producer')

    const collector = flowOf(1).subscribe(() => { throw new Error('collector') })
    await expect(collector.done).rejects.toThrow('collector')

    const complete = flowOf<number>().subscribe({ next: () => undefined, complete: () => { throw new Error('complete') } })
    await expect(complete.done).rejects.toThrow('complete')
    expect(reports).toHaveLength(3)
    restore()
  })

  it('supports callback close, fail, ignored post-abort emission and async cleanup', async () => {
    let close!: () => void
    let fail!: (error: unknown) => void
    let emit!: (value: number) => Promise<void>
    const cleanup = vi.fn(async () => undefined)
    const source = callbackFlow<number>((emitter) => {
      close = emitter.close; fail = emitter.fail; emit = emitter.emit
      return cleanup
    })
    const seen: number[] = []
    const first = source.subscribe((value) => { seen.push(value) })
    await emit(1)
    close()
    await first.done
    expect(seen).toEqual([1])
    expect(cleanup).toHaveBeenCalledOnce()

    const second = source.subscribe(() => undefined)
    fail(new Error('failed'))
    await expect(second.done).rejects.toThrow('failed')
    expect(cleanup).toHaveBeenCalledTimes(2)
  })
})

describe('operators', () => {
  it('covers filtering, distinct, scan, take, drop and lifecycle operators', async () => {
    const actions: string[] = []
    const source = onCompletion(
      onStart(
        onEach(
          scan(
            distinctUntilChanged(
              filter(flowOf(1, 1, 2, 3), async (value) => value < 3),
              (left, right) => left === right
            ),
            0,
            async (total, value) => total + value
          ),
          (value) => { actions.push(`each:${value}`) }
        ),
        () => { actions.push('start') }
      ),
      (error) => { actions.push(error ? 'failed' : 'complete') }
    )
    expect(await valuesOf(drop(take(source, 3), 1))).toEqual([1, 3])
    expect(actions).toEqual(['start', 'each:0', 'each:1', 'each:3', 'complete'])
    expect(await valuesOf(take(flowOf(1, 2), 0))).toEqual([])
    for (const count of [-1, 1.5]) {
      expect(() => take(flowOf(1), count)).toThrow(RangeError)
      expect(() => drop(flowOf(1), count)).toThrow(RangeError)
    }
  })

  it('recovers, observes completion failures and exercises retry predicates/delays', async () => {
    let completionError: unknown
    const failing = onCompletion(new Flow<never>(() => { throw new Error('raw') }), (error) => { completionError = error })
    expect(await valuesOf(catchFlow(failing, async () => flowOf(9)))).toEqual([9])
    expect(completionError).toBeInstanceOf(Error)

    const scheduler = new VirtualScheduler()
    let attempts = 0
    const retried = retryWhen(new Flow<number>(async (observer) => {
      attempts++
      if (attempts < 3) throw new Error(`attempt-${attempts}`)
      await observer.next(3)
    }), async (_error, attempt) => attempt < 2, { delayMs: (attempt) => attempt * 5, scheduler })
    const promise = valuesOf(retried)
    await vi.waitFor(() => expect(scheduler.pendingTaskCount).toBe(1))
    scheduler.advanceBy(5)
    await vi.waitFor(() => expect(scheduler.pendingTaskCount).toBe(1))
    scheduler.advanceBy(10)
    await expect(promise).resolves.toEqual([3])
    expect(() => retry(flowOf(1), { attempts: 0 })).toThrow(RangeError)
    expect(() => retry(flowOf(1), { delayMs: -1 })).not.toThrow()
    await expect(retry(new Flow(() => { throw new Error('stop') }), { attempts: 2, predicate: () => false })
      .collect(() => undefined)).rejects.toThrow('stop')
  })

  it('uses virtual time for delay, debounce, throttle and timeout', async () => {
    const delayScheduler = new VirtualScheduler()
    const delayed = valuesOf(delay(flowOf(1), 10, delayScheduler))
    await vi.waitFor(() => expect(delayScheduler.pendingTaskCount).toBe(1))
    delayScheduler.advanceBy(10)
    await expect(delayed).resolves.toEqual([1])

    const debounceScheduler = new VirtualScheduler()
    const debounced = valuesOf(debounce(flowOf(1, 2, 3), 10, debounceScheduler))
    await expect(debounced).resolves.toEqual([3])

    const throttleScheduler = new VirtualScheduler()
    const throttled = new Flow<number>(async (observer) => {
      await observer.next(1)
      throttleScheduler.advanceBy(5)
      await observer.next(2)
      throttleScheduler.advanceBy(5)
      await observer.next(3)
    })
    expect(await valuesOf(throttle(throttled, 10, throttleScheduler))).toEqual([1, 3])

    const timeoutScheduler_ = new VirtualScheduler()
    const hanging = callbackFlow<never>(() => undefined)
    const timed = timeout(hanging, 10, timeoutScheduler_).collect(() => undefined)
    await vi.waitFor(() => expect(timeoutScheduler_.pendingTaskCount).toBe(1))
    timeoutScheduler_.advanceBy(10)
    await expect(timed).rejects.toMatchObject({ name: 'TimeoutError' })

    for (const value of [-1, Number.NaN]) {
      expect(() => delay(flowOf(1), value)).toThrow(RangeError)
      expect(() => debounce(flowOf(1), value)).toThrow(RangeError)
      expect(() => throttle(flowOf(1), value)).toThrow(RangeError)
      expect(() => timeout(flowOf(1), value)).toThrow(RangeError)
    }
  })

  it('handles zip/combine empty sources and propagates composition failures', async () => {
    expect(await valuesOf(zip(flowOf<number>(), flowOf('a')))).toEqual([])
    expect(await valuesOf(combine(flowOf<number>(), flowOf('a'), (left, right) => `${left}${right}`))).toEqual([])
    const failing = new Flow<never>(() => { throw new Error('zip') })
    await expect(zip(failing, callbackFlow(() => undefined)).collect(() => undefined)).rejects.toThrow('zip')
    await expect(combine(failing, callbackFlow(() => undefined), () => 1).collect(() => undefined)).rejects.toThrow('zip')
  })

  it('implements latest, concat, first and bounded merge flattening', async () => {
    expect(await valuesOf(flatMapConcat(flowOf(1, 2), (value) => flowOf(value, value * 10))))
      .toEqual([1, 10, 2, 20])
    expect(await valuesOf(flatMapMerge(flowOf(1, 2), (value) => flowOf(value), 1))).toEqual([1, 2])
    expect(await valuesOf(flatMapLatest(flowOf(1, 2), (value) => flowOf(value)))).toEqual([1, 2])
    expect(await valuesOf(flatMapFirst(flowOf(1, 2), (value) => flowOf(value)))).toEqual([1])
    for (const concurrency of [0, -1, 1.5]) {
      expect(() => flatMapMerge(flowOf(1), (value) => flowOf(value), concurrency)).toThrow(RangeError)
    }
    await expect(flatMapConcat(flowOf(1), () => new Flow(() => { throw new Error('inner') }))
      .collect(() => undefined)).rejects.toThrow('inner')
    await expect(flatMapConcat(new Flow(() => { throw new Error('outer') }), () => flowOf(1))
      .collect(() => undefined)).rejects.toThrow('outer')
  })
})

describe('schedulers and managed subscriptions', () => {
  it('schedules immediate, microtask, timeout and animation fallback work', async () => {
    const calls: string[] = []
    const immediate = immediateScheduler.schedule(() => calls.push('immediate'))
    immediate.cancel(); immediate.cancel()
    expect(immediate.cancelled).toBe(true)
    const micro = microtaskScheduler.schedule(() => calls.push('micro'))
    await Promise.resolve()
    expect(calls).toEqual(['immediate', 'micro'])
    micro.cancel()

    const cancelled = microtaskScheduler.schedule(() => calls.push('cancelled'))
    cancelled.cancel()
    await Promise.resolve()
    expect(calls).not.toContain('cancelled')

    await immediateScheduler.sleep(0)
    await microtaskScheduler.sleep(0)
    await timeoutScheduler.sleep(0)
    await animationFrameScheduler.sleep(0)
    expect(Number.isFinite(animationFrameScheduler.now)).toBe(true)
  })

  it('aborts sleeps and validates virtual time ordering/cancellation', async () => {
    const scheduler = new VirtualScheduler()
    const aborted = new AbortController()
    aborted.abort('pre-abort')
    await expect(scheduler.sleep(1, aborted.signal)).rejects.toBe('pre-abort')

    const controller = new AbortController()
    const sleeping = scheduler.sleep(10, controller.signal)
    controller.abort('cancelled')
    await expect(sleeping).rejects.toBe('cancelled')
    expect(scheduler.pendingTaskCount).toBe(0)

    expect(() => scheduler.advanceTo(-1)).toThrow(RangeError)
    const calls: number[] = []
    scheduler.schedule(() => calls.push(1), 2)
    const cancelled = scheduler.schedule(() => calls.push(2), 1)
    cancelled.cancel()
    scheduler.schedule(() => calls.push(3), 2)
    scheduler.runAll()
    expect(calls).toEqual([1, 3])
  })

  it('aggregates producer and cleanup failures and handles early terminal states', async () => {
    expect(new FlowCancelledError().message).toBe('Flow collection was cancelled')
    const failed = new ManagedSubscription()
    failed.fail(new Error('producer'))
    failed.setCleanup(() => { throw new Error('cleanup') })
    await expect(failed.done).rejects.toBeInstanceOf(AggregateError)

    const completed = new ManagedSubscription()
    completed.complete()
    completed.setCleanup(() => { throw new Error('cleanup') })
    await expect(completed.done).rejects.toThrow('cleanup')

    const cancelled = new ManagedSubscription()
    cancelled.cancel('stop')
    cancelled.setCleanup(undefined)
    cancelled.dispose()
    await expect(cancelled.done).resolves.toBeUndefined()

    completed.complete()
    completed.fail(new Error('ignored'))
  })
})

describe('StateFlow and SharedFlow edge semantics', () => {
  it('handles equality, reducers, function patches, nested transactions and aborts', async () => {
    const state = new MutableStateFlow(1, { comparator: (left, right) => left === right, name: 'state' })
    const values: number[] = []
    const controller = new AbortController()
    const subscription = state.subscribe((value) => { values.push(value) }, { signal: controller.signal })
    state.set(1)
    state.update((value) => value + 1)
    state.transaction(() => state.transaction(() => state.set(3)))
    controller.abort('stop')
    await subscription.done
    state.set(4)
    expect(values).toEqual([1, 2, 3])

    const pre = new AbortController(); pre.abort('already')
    expect(state.subscribe(() => undefined, { signal: pre.signal }).closed).toBe(true)

    const object = new MutableObjectStateFlow({ count: 0, label: 'a' })
    object.patch((value) => ({ count: value.count + 1 }))
    expect(object.value).toEqual({ count: 1, label: 'a' })
  })

  it('reports async listener failures and defers a reentrant initial emission', async () => {
    const errors: Array<{ error: unknown; context: unknown }> = []
    const restore = setFlowErrorReporter((error, context) => errors.push({ error, context }))
    const state = new MutableStateFlow(0, { name: 'async-state' })
    state.subscribe(async () => { throw new Error('async listener') }, { emitCurrent: false })
    const calls: number[] = []
    state.subscribe((value) => {
      calls.push(value)
      if (value === 1) {
        state.subscribe((nested) => calls.push(nested))
        const cancelled = state.subscribe(() => calls.push(99))
        cancelled.cancel()
      }
    }, { emitCurrent: false })
    state.set(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual([1, 1])
    expect(errors).toEqual([{
      error: expect.objectContaining({ message: 'async listener' }),
      context: { operation: 'listener', flowName: 'async-state' }
    }])
    restore()

    const unnamed = new MutableStateFlow(0)
    const restoreUnnamed = setFlowErrorReporter((error, context) => errors.push({ error, context }))
    unnamed.subscribe(async () => { throw new Error('unnamed async') }, { emitCurrent: false })
    unnamed.set(1)
    await Promise.resolve()
    expect(errors.at(-1)).toEqual({
      error: expect.objectContaining({ message: 'unnamed async' }), context: { operation: 'listener' }
    })
    restoreUnnamed()
  })

  it('skips subscribers removed earlier in the same StateFlow emission and suppresses no-op transactions', () => {
    const state = new MutableStateFlow(0, { name: 'named-sync' })
    const calls: string[] = []
    const subscriptions: { second?: ReturnType<typeof state.subscribe> } = {}
    state.subscribe((value) => { calls.push(`first:${value}`); subscriptions.second?.cancel() }, { emitCurrent: false })
    subscriptions.second = state.subscribe((value) => calls.push(`second:${value}`), { emitCurrent: false })
    state.set(1)
    state.transaction(() => { state.set(2); state.set(1) })
    expect(calls).toEqual(['first:1'])

    const stable = new MutableStateFlow(1)
    const stableValues: number[] = []
    stable.subscribe((value) => stableValues.push(value), { emitCurrent: false })
    stable.transaction(() => stable.set(1))
    expect(stableValues).toEqual([])

    const synchronous: number[] = []
    state.subscribe((value) => synchronous.push(value))
    expect(synchronous).toEqual([1])
  })

  it('reports named synchronous StateFlow listener failures', () => {
    const errors: Array<{ error: unknown; context: unknown }> = []
    const restore = setFlowErrorReporter((error, context) => errors.push({ error, context }))
    const state = new MutableStateFlow(0, { name: 'named-state' })
    const subscription = state.subscribe(() => { throw new Error('named sync listener') }, { emitCurrent: false })
    state.set(1)
    expect(errors).toEqual([{
      error: expect.objectContaining({ message: 'named sync listener' }),
      context: { operation: 'listener', flowName: 'named-state' }
    }])
    subscription.cancel()
    restore()
  })

  it('keeps derived sources alive for the configured window and cancels pending stop', async () => {
    const scheduler = new VirtualScheduler()
    const source = new MutableStateFlow(1)
    expect(() => derivedStateFlow([source] as const, (value) => value, { keepAliveMs: -1 })).toThrow(RangeError)
    const derived = derivedStateFlow([source] as const, (value) => value * 2, {
      keepAliveMs: 10, scheduler, comparator: (left, right) => left === right
    })
    const first = derived.subscribe(() => undefined)
    const concurrent = derived.subscribe(() => undefined)
    expect(derived.value).toBe(2)
    concurrent.cancel(); await concurrent.done
    first.cancel(); await first.done
    expect(source.subscriberCount).toBe(1)
    scheduler.advanceBy(5)
    const second = derived.subscribe(() => undefined)
    scheduler.advanceBy(10)
    expect(source.subscriberCount).toBe(1)
    source.set(2)
    expect(derived.value).toBe(4)
    second.cancel(); await second.done
    scheduler.advanceBy(10)
    expect(source.subscriberCount).toBe(0)
    source.set(3)
    expect(derived.value).toBe(6)

    const defaultScheduled = derivedStateFlow([source] as const, (value) => value, { keepAliveMs: 10 })
    const defaultLease = defaultScheduled.subscribe(() => undefined)
    defaultLease.cancel()
    await defaultLease.done
    const replacementLease = defaultScheduled.subscribe(() => undefined)
    replacementLease.cancel()
    await replacementLease.done

    const readonlyValues: number[] = []
    const readonlyLease = source.asStateFlow().subscribe((value) => readonlyValues.push(value))
    source.set(4)
    expect(readonlyValues).toEqual([3, 4])
    readonlyLease.cancel()

    let derives = 0
    const parity = derivedStateFlow([source] as const, (value) => {
      derives++
      return { parity: value % 2 }
    }, { comparator: (left, right) => left.parity === right.parity })
    const parityValues: number[] = []
    const parityLease = parity.subscribe((value) => parityValues.push(value.parity))
    const afterStart = derives
    expect(parity.value.parity).toBe(0)
    expect(derives).toBe(afterStart)
    source.set(6)
    source.set(7)
    expect(parityValues).toEqual([0, 1])
    parityLease.cancel()
    await parityLease.done
  })

  it('validates capacities and preserves stable readonly identity/replay reset', async () => {
    for (const value of [-1, 1.5]) {
      expect(() => new MutableSharedFlow({ replay: value })).toThrow(RangeError)
      expect(() => new MutableSharedFlow({ extraBufferCapacity: value })).toThrow(RangeError)
    }
    const shared = new MutableSharedFlow<number>({ replay: 1 })
    expect(shared.asSharedFlow()).toBe(shared.asSharedFlow())
    expect(shared.asSharedFlow().subscriberCount).toBe(0)
    await shared.emit(1)
    shared.resetReplayCache()
    const values: number[] = []
    const subscription = shared.subscribe((value) => { values.push(value) })
    await Promise.resolve()
    expect(values).toEqual([])
    subscription.cancel()

    const readonlyValues: number[] = []
    const readonlySubscription = shared.asSharedFlow().subscribe((value) => readonlyValues.push(value))
    await shared.emit(4)
    expect(readonlyValues).toEqual([4])
    readonlySubscription.cancel()
  })

  it('waits for emit delivery and treats any full subscriber as backpressure', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const shared = new MutableSharedFlow<number>({ overflow: 'suspend' })
    const slow = shared.subscribe(async () => blocked)
    const fastValues: number[] = []
    const fast = shared.subscribe((value) => { fastValues.push(value) })
    let settled = false
    const first = shared.emit(1).then(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(fastValues).toEqual([1])
    expect(shared.tryEmit(2)).toBe(false)
    release()
    await first
    expect(settled).toBe(true)
    slow.cancel(); fast.cancel()
  })

  it('implements drop-latest, drop-oldest and error overflow policies', async () => {
    for (const policy of ['drop-latest', 'drop-oldest', 'error'] as const) {
      let release!: () => void
      const firstBlocked = new Promise<void>((resolve) => { release = resolve })
      const values: number[] = []
      const errors: unknown[] = []
      const restore = setFlowErrorReporter((error) => errors.push(error))
      const shared = new MutableSharedFlow<number>({ extraBufferCapacity: 1, overflow: policy, name: policy })
      const subscription = shared.subscribe(async (value) => {
        values.push(value)
        if (value === 1) await firstBlocked
      })
      const first = shared.emit(1)
      await Promise.resolve()
      expect(shared.tryEmit(2)).toBe(true)
      if (policy === 'error') {
        expect(shared.tryEmit(3)).toBe(false)
        await expect(shared.emit(3)).rejects.toBeInstanceOf(SharedFlowOverflowError)
      } else expect(shared.tryEmit(3)).toBe(true)
      release()
      await first
      await vi.waitFor(() => expect(values.length).toBeGreaterThanOrEqual(2))
      if (policy === 'drop-latest') expect(values).toEqual([1, 2])
      if (policy === 'drop-oldest') expect(values).toEqual([1, 3])
      expect(errors).toEqual([])
      subscription.cancel()
      restore()
    }
  })

  it('resolves a dropped oldest delivery and releases suspended emitters when buffer space opens', async () => {
    let releaseDrop!: () => void
    const dropBlock = new Promise<void>((resolve) => { releaseDrop = resolve })
    const droppedValues: number[] = []
    const dropOldest = new MutableSharedFlow<number>({ extraBufferCapacity: 1, overflow: 'drop-oldest' })
    const dropLease = dropOldest.subscribe(async (value) => {
      droppedValues.push(value)
      if (value === 1) await dropBlock
    })
    const firstDrop = dropOldest.emit(1)
    await Promise.resolve()
    let secondResolved = false
    const secondDrop = dropOldest.emit(2).then(() => { secondResolved = true })
    await Promise.resolve()
    expect(dropOldest.tryEmit(3)).toBe(true)
    await vi.waitFor(() => expect(secondResolved).toBe(true))
    releaseDrop()
    await Promise.all([firstDrop, secondDrop])
    await vi.waitFor(() => expect(droppedValues).toEqual([1, 3]))
    dropLease.cancel()

    let releaseSuspend!: () => void
    const suspendBlock = new Promise<void>((resolve) => { releaseSuspend = resolve })
    const suspendedValues: number[] = []
    const suspended = new MutableSharedFlow<number>({ extraBufferCapacity: 1, overflow: 'suspend' })
    const suspendLease = suspended.subscribe(async (value) => {
      suspendedValues.push(value)
      if (value === 1) await suspendBlock
    })
    const firstSuspend = suspended.emit(1)
    await Promise.resolve()
    const secondSuspend = suspended.emit(2)
    await Promise.resolve()
    const thirdSuspend = suspended.emit(3)
    releaseSuspend()
    await Promise.all([firstSuspend, secondSuspend, thirdSuspend])
    expect(suspendedValues).toEqual([1, 2, 3])
    suspendLease.cancel()
  })

  it('returns false for a full suspending tryEmit and closes pre-aborted subscribers', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const shared = new MutableSharedFlow<number>({ overflow: 'suspend' })
    const subscription = shared.subscribe(async () => blocked)
    const first = shared.emit(1)
    await Promise.resolve()
    expect(shared.tryEmit(2)).toBe(false)
    const second = shared.emit(2)
    await Promise.resolve()
    subscription.cancel()
    await expect(second).resolves.toBeUndefined()
    release(); await first

    const controller = new AbortController(); controller.abort('before')
    const closed = shared.subscribe(() => undefined, { signal: controller.signal })
    expect(closed.closed).toBe(true)
    expect(shared.subscriberCount).toBe(0)
  })

  it('stops replay delivery when a listener aborts its own subscription and reports named listener failures', async () => {
    const replayed = new MutableSharedFlow<number>({ replay: 2 })
    await replayed.emit(1); await replayed.emit(2)
    const controller = new AbortController()
    const values: number[] = []
    const subscription = replayed.subscribe((value) => {
      values.push(value)
      controller.abort('first replay only')
    }, { signal: controller.signal })
    await subscription.done
    expect(values).toEqual([1])

    const errors: Array<{ error: unknown; context: unknown }> = []
    const restore = setFlowErrorReporter((error, context) => errors.push({ error, context }))
    const named = new MutableSharedFlow<number>({ name: 'named-shared' })
    const failing = named.subscribe(() => { throw new Error('named listener') })
    await named.emit(1)
    expect(errors).toEqual([{
      error: expect.objectContaining({ message: 'named listener' }),
      context: { operation: 'listener', flowName: 'named-shared' }
    }])
    failing.cancel()
    restore()
  })

  it('stops while-subscribed stateIn after the last lease', async () => {
    let aborted = false
    const source = callbackFlow<number>(async (emitter, signal) => {
      await emitter.emit(1)
      signal.addEventListener('abort', () => { aborted = true }, { once: true })
    })
    const state = stateIn(source, 0, { started: { type: 'while-subscribed' } })
    const first = state.subscribe(() => undefined)
    const second = state.subscribe(() => undefined)
    await vi.waitFor(() => expect(state.value).toBe(1))
    first.cancel(); await first.done
    expect(aborted).toBe(false)
    second.cancel(); await second.done
    await vi.waitFor(() => expect(aborted).toBe(true))
  })
})

describe('TaskController policies', () => {
  it('ignores duplicate work and limits parallel work', async () => {
    let release!: () => void
    const ignore = new TaskController<number, number>(async (value) => {
      await new Promise<void>((resolve) => { release = resolve })
      return value
    }, { policy: 'ignore' })
    const first = ignore.run(1)
    await expect(ignore.run(2)).resolves.toBeUndefined()
    release(); await expect(first).resolves.toBe(1)

    let active = 0
    let maximum = 0
    const parallel = new TaskController<number, number>(async (value) => {
      active++; maximum = Math.max(maximum, active)
      await Promise.resolve(); active--
      return value
    }, { policy: 'parallel', concurrency: 2 })
    await Promise.all([parallel.run(1), parallel.run(2), parallel.run(3)])
    expect(maximum).toBe(2)
    expect(() => new TaskController(async () => 1, { policy: 'parallel', concurrency: 0 })).toThrow(RangeError)
  })

  it('publishes cancelled and failure states with previous data and mapping failures', async () => {
    const controller = new TaskController<string, string, Error>(async (input, { signal }) => {
      if (input === 'ok') return 'success'
      if (input === 'wait') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
      throw new Error('raw')
    }, { mapError: () => { throw new Error('mapping') } })
    await controller.run('ok')
    const waiting = controller.run('wait')
    controller.cancel('manual')
    await expect(waiting).resolves.toBeUndefined()
    expect(controller.state.value).toEqual({ status: 'cancelled', previous: 'success' })
    await expect(controller.run('fail')).rejects.toThrow('mapping')
    expect(controller.state.value).toMatchObject({ status: 'failure', previous: 'success' })
  })

  it('resolves queued requests when cancelled before they start', async () => {
    let release!: () => void
    const controller = new TaskController<number, number>(async (value) => {
      await new Promise<void>((resolve) => { release = resolve })
      return value
    }, { policy: 'enqueue' })
    const first = controller.run(1)
    const queued = controller.run(2)
    controller.cancel('stop')
    await expect(queued).resolves.toBeUndefined()
    release()
    await expect(first).resolves.toBeUndefined()
  })
})
