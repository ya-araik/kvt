import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import {
  Flow,
  MutableObjectStateFlow,
  MutableSharedFlow,
  MutableStateFlow,
  TaskController,
  VirtualScheduler,
  batch,
  combine,
  derivedStateFlow,
  callbackFlow,
  flowOf,
  map,
  merge,
  retry,
  sample,
  shareIn,
  stateIn,
  setFlowErrorReporter,
  zip
} from '../src/index.js'

describe('cold Flow', () => {
  it('starts independently for every collector and supports async callbacks', async () => {
    let starts = 0
    const source = new Flow<number>(async (observer) => {
      starts++
      await observer.next(starts)
    })
    const first: number[] = []
    const second: number[] = []
    await source.collect(async (value) => { first.push(value) })
    await source.collect((value) => { second.push(value) })
    expect(first).toEqual([1])
    expect(second).toEqual([2])
  })

  it('composes without sharing producer state', async () => {
    const values: number[] = []
    await map(flowOf(1, 2, 3), (value) => value * 2).collect((value) => { values.push(value) })
    expect(values).toEqual([2, 4, 6])
  })

  it('counts retry attempts as total producer executions', async () => {
    let executions = 0
    const source = new Flow<never>(() => { executions++; throw new Error('failure') })
    await expect(retry(source, { attempts: 3 }).collect(() => undefined)).rejects.toThrow('failure')
    expect(executions).toBe(3)
  })
})

describe('StateFlow', () => {
  it('has stable readonly identity and object-only patching', () => {
    const state = new MutableObjectStateFlow({ count: 0, label: 'ready' })
    expect(state.asStateFlow()).toBe(state.asStateFlow())
    state.patch({ count: 1 })
    expect(state.value).toEqual({ count: 1, label: 'ready' })
  })

  it('uses a subscriber snapshot for reentrant mutation', async () => {
    const state = new MutableStateFlow(0)
    const calls: string[] = []
    const second = state.subscribe((value) => { calls.push(`second:${value}`) }, { emitCurrent: false })
    state.subscribe((value) => {
      calls.push(`first:${value}`)
      second.cancel()
      state.subscribe((nested) => { calls.push(`nested:${nested}`) })
    }, { emitCurrent: false })
    state.set(1)
    await Promise.resolve()
    expect(calls).toEqual(['second:1', 'first:1', 'nested:1'])
  })

  it('isolates listener failures and publishes one snapshot per transaction', () => {
    const errors: unknown[] = []
    const restore = setFlowErrorReporter((error) => errors.push(error))
    const left = new MutableStateFlow(0)
    const right = new MutableStateFlow(0)
    const snapshots: string[] = []
    left.subscribe(() => { throw new Error('listener') }, { emitCurrent: false })
    left.subscribe(() => snapshots.push(`${left.value}:${right.value}`), { emitCurrent: false })
    batch(() => {
      left.set(1)
      right.set(2)
    }, left, right)
    restore()
    expect(errors).toHaveLength(1)
    expect(snapshots).toEqual(['1:2'])
  })

  it('releases derived sources after the last subscriber', async () => {
    const source = new MutableStateFlow(2)
    const derived = derivedStateFlow([source] as const, (value) => value * 2)
    expect(source.subscriberCount).toBe(0)
    const subscription = derived.subscribe(() => undefined)
    expect(source.subscriberCount).toBe(1)
    subscription.cancel()
    await subscription.done
    await Promise.resolve()
    expect(source.subscriberCount).toBe(0)
    expect(derived.value).toBe(4)
  })
})

describe('SharedFlow', () => {
  it('replays only the configured number of values', async () => {
    const shared = new MutableSharedFlow<number>({ replay: 2 })
    await shared.emit(1)
    await shared.emit(2)
    await shared.emit(3)
    const values: number[] = []
    const subscription = shared.subscribe((value) => { values.push(value) })
    await Promise.resolve()
    subscription.cancel()
    expect(values).toEqual([2, 3])
  })

  it('suspends concurrent emit when a zero-capacity subscriber is busy', async () => {
    const shared = new MutableSharedFlow<number>({ overflow: 'suspend' })
    let release!: () => void
    const firstDelivery = new Promise<void>((resolve) => { release = resolve })
    const values: number[] = []
    shared.subscribe(async (value) => {
      values.push(value)
      if (value === 1) await firstDelivery
    })
    const first = shared.emit(1)
    const second = shared.emit(2)
    await Promise.resolve()
    expect(values).toEqual([1])
    release()
    await Promise.all([first, second])
    expect(values).toEqual([1, 2])
  })

  it('isolates listener failures and releases a blocked emitter when the subscriber cancels', async () => {
    const errors: unknown[] = []
    const restore = setFlowErrorReporter((error) => errors.push(error))
    const shared = new MutableSharedFlow<number>()
    const failing = shared.subscribe(() => { throw new Error('listener') })
    await expect(shared.emit(1)).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
    failing.cancel()

    let release!: () => void
    const blocked = new MutableSharedFlow<number>()
    const subscription = blocked.subscribe(() => new Promise<void>((resolve) => { release = resolve }))
    const emission = blocked.emit(1)
    await Promise.resolve()
    subscription.cancel('closed')
    await expect(emission).resolves.toBeUndefined()
    release()
    restore()
  })

  it('preserves exactly the configured replay suffix for generated event sequences', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.integer(), { maxLength: 30 }),
      fc.integer({ min: 0, max: 6 }),
      async (events, replay) => {
        const shared = new MutableSharedFlow<number>({ replay })
        for (const event of events) await shared.emit(event)
        const received: number[] = []
        const subscription = shared.subscribe((value) => { received.push(value) })
        const expected = replay === 0 ? [] : events.slice(-replay)
        if (expected.length > 0) await vi.waitFor(() => expect(received).toHaveLength(expected.length))
        subscription.cancel()
        expect(received).toEqual(expected)
      }
    ))
  })
})

describe('Flow composition', () => {
  it('cancels merge siblings after the first source fails', async () => {
    let siblingAborted = false
    const sibling = callbackFlow<never>((_emitter, signal) => {
      signal.addEventListener('abort', () => { siblingAborted = true }, { once: true })
    })
    const failure = new Flow<never>(() => { throw new Error('merge-failure') })
    await expect(merge(sibling, failure).collect(() => undefined)).rejects.toThrow('merge-failure')
    expect(siblingAborted).toBe(true)
  })

  it('completes zip when a completed source has no remaining pair', async () => {
    const values: Array<readonly [number, string]> = []
    await zip(flowOf(1), flowOf('a', 'b')).collect((value) => { values.push(value) })
    expect(values).toEqual([[1, 'a']])
  })

  it('captures each combine pair instead of reading a later mutable latest value', async () => {
    const values: string[] = []
    await combine(flowOf(1, 2), flowOf('a', 'b'), async (left, right) => `${left}${right}`)
      .collect((value) => { values.push(value) })
    expect(values).toEqual(['1a', '2a', '2b'])
  })

  it('does not miss a synchronous first lazy share emission or restart a completed lazy source', async () => {
    let starts = 0
    const shared = shareIn(new Flow<number>(async (observer) => {
      starts++
      await observer.next(starts)
    }))
    const first: number[] = []
    const firstSubscription = shared.subscribe((value) => { first.push(value) })
    await vi.waitFor(() => expect(first).toEqual([1]))
    const second: number[] = []
    const secondSubscription = shared.subscribe((value) => { second.push(value) })
    await Promise.resolve()
    expect(starts).toBe(1)
    expect(second).toEqual([])
    firstSubscription.cancel()
    secondSubscription.cancel()
  })
})

describe('scheduler and tasks', () => {
  it('runs virtual tasks deterministically', () => {
    const scheduler = new VirtualScheduler()
    const calls: number[] = []
    scheduler.schedule(() => calls.push(scheduler.now), 10)
    scheduler.schedule(() => calls.push(scheduler.now), 5)
    scheduler.advanceBy(10)
    expect(calls).toEqual([5, 10])
  })

  it('cancels the currently scheduled sample tick with its collector', async () => {
    const scheduler = new VirtualScheduler()
    const source = new Flow<never>(async (_observer, { signal }) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true })
    }))
    const subscription = sample(source, 10, scheduler).subscribe(() => undefined)
    scheduler.advanceBy(10)
    expect(scheduler.pendingTaskCount).toBe(1)
    subscription.cancel()
    await subscription.done
    expect(scheduler.pendingTaskCount).toBe(0)
  })

  it('prevents a cancelled latest generation from updating state', async () => {
    const completions = new Map<number, (value: string) => void>()
    const controller = new TaskController<string, string>(
      (input, context) => new Promise((resolve) => completions.set(context.generation, () => resolve(input))),
      { policy: 'latest' }
    )
    const first = controller.run('old')
    const second = controller.run('new')
    completions.get(1)?.('old')
    completions.get(2)?.('new')
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBe('new')
    expect(controller.state.value).toEqual({ status: 'success', data: 'new' })
  })

  it('keeps enqueue strictly sequential and validates parallel concurrency', async () => {
    expect(() => new TaskController(async () => 1, { policy: 'enqueue', concurrency: 2 })).toThrow(RangeError)
    const releases: Array<() => void> = []
    let active = 0
    let maximum = 0
    const controller = new TaskController<number, number>(async (input) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active--
      return input
    }, { policy: 'enqueue' })
    const first = controller.run(1)
    const second = controller.run(2)
    expect(controller.activeCount).toBe(1)
    releases.shift()?.()
    await first
    expect(controller.activeCount).toBe(1)
    releases.shift()?.()
    await second
    expect(maximum).toBe(1)
  })

  it('cleans bookkeeping after a synchronous task throw and rejects the mapped error', async () => {
    const controller = new TaskController<void, never, string>(() => { throw new Error('raw') }, {
      mapError: () => 'mapped'
    })
    await expect(controller.run()).rejects.toBe('mapped')
    expect(controller.activeCount).toBe(0)
    expect(controller.state.value).toEqual({ status: 'failure', error: 'mapped' })
    expect(Object.isFrozen(controller.state.value)).toBe(true)
  })

  it('updates eager stateIn before an external subscriber is attached', async () => {
    const state = stateIn(flowOf(1, 2), 0, { started: { type: 'eager' } })
    await vi.waitFor(() => expect(state.value).toBe(2))
  })

  it('stops and expires replay with virtual time while subscribed policy', async () => {
    const scheduler = new VirtualScheduler()
    let starts = 0
    let stops = 0
    const source = new Flow<number>(async (observer, { signal }) => {
      starts++
      await observer.next(starts)
      if (signal.aborted) { stops++; return }
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => { stops++; resolve() }, { once: true }))
    })
    const shared = shareIn(source, {
      replay: 1,
      scheduler,
      started: { type: 'while-subscribed', stopTimeoutMs: 10, replayExpirationMs: 20 }
    })
    const values: number[] = []
    const subscription = shared.subscribe((value) => { values.push(value) })
    await Promise.resolve()
    expect(values).toEqual([1])
    subscription.cancel()
    await subscription.done
    scheduler.advanceBy(9)
    expect(stops).toBe(0)
    scheduler.advanceBy(1)
    await vi.waitFor(() => expect(stops).toBe(1))
    scheduler.advanceBy(20)
    const replayed: number[] = []
    const next = shared.subscribe((value) => { replayed.push(value) })
    await vi.waitFor(() => expect(replayed).toEqual([2]))
    next.cancel()
  })
})
