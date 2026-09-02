import { bootstrapKvt } from '@kvt/core'
import { describe, expect, it, vi } from 'vitest'
import {
  createKvtQueryClient,
  createQueryKey,
  kvtQueryClientToken,
  queryPlugin,
  type QueryState
} from '../src/index.js'

describe('@kvt/query', () => {
  it('deduplicates requests and shares cached data without React', async () => {
    const runtime = await bootstrapKvt()
    const query = vi.fn(async () => 'ready')
    const client = createKvtQueryClient({ scope: runtime.rootScope })
    const definition = { key: createQueryKey('status'), query }
    const first = client.observe(definition)
    const second = client.observe(definition)
    const firstSuccess = waitForSuccess(first)
    const secondSuccess = waitForSuccess(second)
    expect((await firstSuccess).data).toBe('ready')
    expect((await secondSuccess).data).toBe('ready')
    expect(query).toHaveBeenCalledOnce()
    await runtime.shutdown({ reason: 'test' })
  })

  it('aborts active query work when its scope shuts down', async () => {
    const runtime = await bootstrapKvt()
    let aborted = false
    const client = createKvtQueryClient({ scope: runtime.rootScope })
    const flow = client.observe({
      key: createQueryKey('long'),
      query: ({ signal }) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => {
        aborted = true
        reject(signal.reason)
      }, { once: true }))
    })
    const subscription = flow.subscribe(() => undefined)
    await runtime.shutdown({ reason: 'test' })
    await subscription.done
    expect(aborted).toBe(true)
  })

  it('round-trips a versioned dehydrated cache', async () => {
    const first = createKvtQueryClient()
    const key = createQueryKey('cached', 1)
    first.setData(key, { id: 1 })
    const state = first.dehydrate()
    const second = createKvtQueryClient()
    second.hydrate(state)
    expect(second.getData(key)).toEqual({ id: 1 })
    await first.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
    await second.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('keeps the last successful value as previousData while refetching', async () => {
    const client = createKvtQueryClient()
    let resolveSecond!: (value: string) => void
    let calls = 0
    const flow = client.observe({
      key: createQueryKey('previous'),
      query: () => ++calls === 1 ? Promise.resolve('first') : new Promise<string>((resolve) => { resolveSecond = resolve })
    })
    const first = await waitForSuccess(flow)
    expect(first.previousData).toBeUndefined()
    const refetch = flow.refetch()
    await vi.waitFor(() => expect(flow.value.fetching).toBe(true))
    expect(flow.value.previousData).toBe('first')
    resolveSecond('second')
    await refetch
    expect(flow.value.data).toBe('second')
    expect(flow.value.previousData).toBe('first')
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('installs as a local runtime plugin and owns the client lifecycle', async () => {
    const events: Array<{ readonly subsystem: string; readonly operation: string }> = []
    const runtime = await bootstrapKvt({
      plugins: [queryPlugin()],
      diagnostics: { emit: (event) => events.push(event) }
    })
    const client = runtime.resolve(kvtQueryClientToken)
    const flow = client.observe({ key: createQueryKey('plugin'), query: async () => ({ private: 'not-diagnostic-data' }) })
    await waitForSuccess(flow)
    flow.dispose()
    expect(events.some((event) => event.subsystem === 'query' && event.operation === 'fetch')).toBe(true)
    await runtime.shutdown({ reason: 'test' })
    expect(() => client.observe({ key: createQueryKey('stopped'), query: async () => 1 }))
      .toThrow(expect.objectContaining({ code: 'KVT_QUERY_CLIENT_STOPPED' }))
  })

  it('releases observers and mutations explicitly without waiting for client shutdown', async () => {
    const client = createKvtQueryClient()
    const flow = client.observe({ key: createQueryKey('disposable'), query: async () => 1 })
    const subscription = flow.subscribe(() => undefined)
    flow.dispose()
    await subscription.done
    const mutation = client.mutation({ mutate: async (value: number) => value + 1 })
    await expect(mutation.execute(1)).resolves.toBe(2)
    mutation.dispose()
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })

  it('maps mutation failures once for both the caller and lifecycle callback', async () => {
    const client = createKvtQueryClient()
    const onError = vi.fn()
    const mutation = client.mutation({
      mutate: async () => { throw new Error('transport') },
      mapError: () => ({ code: 'DOMAIN_FAILURE' as const }),
      onError
    })
    await expect(mutation.execute(undefined)).rejects.toEqual({ code: 'DOMAIN_FAILURE' })
    expect(onError).toHaveBeenCalledWith({ code: 'DOMAIN_FAILURE' }, undefined, undefined)
    mutation.dispose()
    await client.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
  })
})

function waitForSuccess<T, E>(flow: { subscribe(listener: (state: QueryState<T, E>) => void): { cancel(): void } }): Promise<QueryState<T, E>> {
  return new Promise((resolve, reject) => {
    let settled = false
    let cancel = () => undefined
    const subscription = flow.subscribe((state) => {
      if (state.status === 'success') {
        settled = true
        cancel()
        resolve(state)
      } else if (state.status === 'error') {
        settled = true
        cancel()
        reject(state.error)
      }
    })
    cancel = () => subscription.cancel()
    if (settled) cancel()
  })
}
