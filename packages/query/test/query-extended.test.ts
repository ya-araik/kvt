import { bootstrapKvt } from '@kvt/core'
import { setFlowErrorReporter } from '@kvt/flow'
import { describe, expect, it, vi } from 'vitest'
import {
  createKvtQueryClient,
  createQueryKey,
  type InfiniteQueryFlow,
  type KvtInfiniteData,
  type PersistedQueryCache,
  type QueryState
} from '../src/index.js'

function waitForState<T, E>(
  flow: { subscribe(listener: (state: QueryState<T, E>) => void): { cancel(): void } },
  predicate: (state: QueryState<T, E>) => boolean
): Promise<QueryState<T, E>> {
  return new Promise((resolve) => {
    let cancel = () => undefined
    let settled = false
    const subscription = flow.subscribe((state) => {
      if (!settled && predicate(state)) {
        settled = true
        cancel()
        resolve(state)
      }
    })
    cancel = () => subscription.cancel()
    if (settled) cancel()
  })
}

describe('@kvt/query extended facade', () => {
  it('validates keys, updates cached data and supports filtered invalidation/prefetch', async () => {
    expect(() => createQueryKey('   ')).toThrow(TypeError)
    const client = createKvtQueryClient({ defaultStaleTimeMs: 100, defaultCacheTimeMs: 1_000 })
    const key = createQueryKey('users', { page: 1 })
    expect(Object.isFrozen(key)).toBe(true)
    client.setData<number>(key, 1)
    client.setData<number>(key, (previous) => (previous ?? 0) + 1)
    expect(client.getData(key)).toBe(2)

    const query = vi.fn(async () => 3)
    await client.prefetch({ key, query, staleTimeMs: 0, cacheTimeMs: 100, retry: 0, retryDelayMs: 1, placeholderData: 0 })
    expect(query).toHaveBeenCalledOnce()
    await client.invalidate({ key, exact: true, stale: false })
    await client.invalidate()
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('maps query errors and isolates sync/async listener failures', async () => {
    const reports: unknown[] = []
    const restore = setFlowErrorReporter((error) => reports.push(error))
    const client = createKvtQueryClient()
    const flow = client.observe({
      key: createQueryKey('failure'),
      retry: 0,
      query: async () => { throw new Error('transport') },
      mapError: () => ({ code: 'DOMAIN' as const })
    })
    flow.subscribe(() => { throw new Error('sync listener') })
    flow.subscribe(async () => { throw new Error('async listener') })
    const failure = await waitForState(flow, (state) => state.status === 'error')
    expect(failure.error).toEqual({ code: 'DOMAIN' })
    await vi.waitFor(() => expect(reports.length).toBeGreaterThanOrEqual(2))
    restore()
    flow.dispose()
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('supports emitCurrent false, pre-aborted subscriptions, cancellation and observer recreation', async () => {
    const client = createKvtQueryClient()
    let release!: (value: number) => void
    const flow = client.observe({
      key: createQueryKey('controlled'),
      query: () => new Promise<number>((resolve) => { release = resolve })
    })
    const silent = vi.fn()
    const subscription = flow.subscribe(silent, { emitCurrent: false })
    expect(silent).not.toHaveBeenCalled()
    await flow.cancel()
    subscription.dispose()
    await subscription.done

    const aborted = new AbortController(); aborted.abort('before')
    const closed = flow.subscribe(() => undefined, { signal: aborted.signal })
    expect(closed.closed).toBe(true)
    await closed.done

    const active = flow.subscribe(() => undefined)
    release(42)
    await waitForState(flow, (state) => state.status === 'success')
    active.cancel(); active.cancel()
    flow.dispose(); flow.dispose()
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('fetches next/previous infinite pages and exposes immutable public state', async () => {
    const client = createKvtQueryClient()
    const flow: InfiniteQueryFlow<number, number, unknown> = client.observeInfinite({
      key: createQueryKey('infinite'),
      initialPageParam: 1,
      query: async ({ pageParam }) => pageParam,
      getNextPageParam: (last) => last < 2 ? last + 1 : undefined,
      getPreviousPageParam: (first) => first > 0 ? first - 1 : undefined,
      staleTimeMs: 0,
      cacheTimeMs: 100,
      retry: 0
    })
    expect(flow.value.status).toBe('pending')
    const first = await waitForState<KvtInfiniteData<number, number>, unknown>(flow, (state) => state.status === 'success')
    expect(first.data?.pages).toEqual([1])
    expect(flow.hasNextPage).toBe(true)
    expect(flow.hasPreviousPage).toBe(true)
    await flow.fetchNextPage()
    expect(flow.value.data?.pages).toEqual([1, 2])
    expect(flow.hasNextPage).toBe(false)
    await flow.fetchPreviousPage()
    expect(flow.value.data?.pages).toEqual([0, 1, 2])
    expect(flow.hasPreviousPage).toBe(false)
    await flow.refetch()
    await flow.cancel()
    flow.dispose()
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('maps infinite query failures and closes aborted page observers', async () => {
    const client = createKvtQueryClient()
    const flow = client.observeInfinite({
      key: createQueryKey('infinite-failure'),
      initialPageParam: 0,
      query: async () => { throw new Error('page') },
      getNextPageParam: () => undefined,
      retry: 0,
      mapError: () => 'mapped'
    })
    const failure = await waitForState(flow, (state) => state.status === 'error')
    expect(failure.error).toBe('mapped')
    const aborted = new AbortController(); aborted.abort('before')
    const subscription = flow.subscribe(() => undefined, { emitCurrent: false, signal: aborted.signal })
    expect(subscription.closed).toBe(true)
    flow.dispose()
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('persists/restores versioned caches and rejects invalid ages/versions', async () => {
    const client = createKvtQueryClient()
    const key = createQueryKey('persisted')
    client.setData(key, { value: 1 })
    let saved: PersistedQueryCache | undefined
    const adapter = {
      save: (cache: PersistedQueryCache) => { saved = cache },
      restore: () => saved ?? null,
      remove: vi.fn()
    }
    await client.persist(adapter)
    expect(saved?.version).toBe(1)

    const restored = createKvtQueryClient()
    await expect(restored.restore(adapter, Infinity)).resolves.toBe(true)
    expect(restored.getData(key)).toEqual({ value: 1 })
    await expect(restored.restore({ ...adapter, restore: () => null })).resolves.toBe(false)
    await expect(restored.restore({ ...adapter, restore: () => ({ ...saved!, version: 2 as never }) })).resolves.toBe(false)
    await expect(restored.restore({ ...adapter, restore: () => ({ ...saved!, timestamp: 0 }) }, 1)).resolves.toBe(false)
    await expect(restored.restore(adapter, -1)).rejects.toThrow(RangeError)
    expect(() => restored.hydrate({ ...saved!, version: 2 as never })).toThrow(expect.objectContaining({
      code: 'KVT_QUERY_CACHE_VERSION_UNSUPPORTED'
    }))
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
    await restored.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('runs complete mutation callbacks, resets state and aborts an active mutation on disposal', async () => {
    const client = createKvtQueryClient()
    const calls: string[] = []
    const mutation = client.mutation({
      key: createQueryKey('mutation'),
      onMutate: async (input: number) => { calls.push(`mutate:${input}`); return `ctx:${input}` },
      mutate: async (input: number) => input * 2,
      onSuccess: async (output, input, value) => { calls.push(`success:${output}:${input}:${value}`) },
      onError: async () => { calls.push('unexpected') }
    })
    await expect(mutation.execute(2)).resolves.toBe(4)
    expect(mutation.state.value).toMatchObject({ status: 'success', data: 4, fetching: false })
    expect(calls).toEqual(['mutate:2', 'success:4:2:ctx:2'])
    mutation.reset()
    expect(mutation.state.value.status).toBe('pending')
    mutation.dispose()

    let aborted = false
    let started = false
    const active = client.mutation({
      mutate: (_input: void, { signal }) => new Promise<never>((_resolve, reject) => {
        started = true
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
      })
    })
    const execution = active.execute()
    await vi.waitFor(() => expect(started).toBe(true))
    active.dispose()
    await expect(execution).rejects.toBeDefined()
    expect(aborted).toBe(true)
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('toggles global focus/online managers and blocks every operation after shutdown', async () => {
    const client = createKvtQueryClient()
    client.setFocused(false); client.setFocused(true)
    client.setOnline(false); client.setOnline(true)
    const shutdown = client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
    await shutdown
    await expect(client.shutdown({ signal: new AbortController().signal, reason: 'again', deadline: undefined })).resolves.toBeUndefined()
    const key = createQueryKey('stopped')
    for (const operation of [
      () => client.observe({ key, query: async () => 1 }),
      () => client.observeInfinite({ key, initialPageParam: 0, query: async () => 1, getNextPageParam: () => undefined }),
      () => client.mutation({ mutate: async () => 1 }),
      () => client.getData(key),
      () => client.setData(key, 1),
      () => client.dehydrate(),
      () => client.hydrate({ version: 1, timestamp: 0, cache: {} })
    ]) expect(operation).toThrow(expect.objectContaining({ code: 'KVT_QUERY_CLIENT_STOPPED' }))
    await expect(client.invalidate()).rejects.toMatchObject({ code: 'KVT_QUERY_CLIENT_STOPPED' })
    await expect(client.prefetch({ key, query: async () => 1 })).rejects.toMatchObject({ code: 'KVT_QUERY_CLIENT_STOPPED' })
  })

  it('is owned by an explicit runtime scope and handles shutdown abort', async () => {
    const runtime = await bootstrapKvt()
    const client = createKvtQueryClient({ scope: runtime.rootScope })
    expect(runtime.inspect().rootScope.ownedResources).toEqual(expect.arrayContaining([{ label: 'query-client' }]))
    await runtime.shutdown({ reason: 'test' })
    expect(() => client.getData(createQueryKey('after'))).toThrow(expect.objectContaining({ code: 'KVT_QUERY_CLIENT_STOPPED' }))
  })
})
