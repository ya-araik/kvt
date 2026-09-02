import {
  Diagnostics,
  KvtError,
  createToken,
  defineModule,
  definePlugin,
  provide,
  raceWithAbort,
  type DiagnosticEvent,
  type DiagnosticSink,
  type KvtScope,
  type PluginDefinition,
  type PluginStartContext,
  type ShutdownContext
} from '@kvt/core'
import { MutableStateFlow, reportFlowError, type StateFlow, type Subscription } from '@kvt/flow'
import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryObserver,
  dehydrate,
  focusManager,
  hydrate,
  onlineManager,
  type InfiniteData,
  type InfiniteQueryObserverOptions,
  type InfiniteQueryObserverResult,
  type QueryObserverOptions,
  type QueryObserverResult
} from '@tanstack/query-core'

declare const queryKeyBrand: unique symbol
export type KvtQueryKey<TName extends string = string> = readonly unknown[] & { readonly [queryKeyBrand]: TName }

export function createQueryKey<TName extends string>(name: TName, ...parts: readonly unknown[]): KvtQueryKey<TName> {
  if (name.trim().length === 0) throw new TypeError('Query key name must be non-empty')
  return Object.freeze([name, ...parts]) as KvtQueryKey<TName>
}

export interface QueryFunctionContext {
  readonly signal: AbortSignal
}

export interface QueryDefinition<T, E = unknown> {
  readonly key: KvtQueryKey
  readonly query: (context: QueryFunctionContext) => T | Promise<T>
  readonly enabled?: boolean
  readonly staleTimeMs?: number
  readonly cacheTimeMs?: number
  readonly retry?: number | ((failureCount: number, error: E) => boolean)
  readonly retryDelayMs?: number | ((attempt: number, error: E) => number)
  readonly mapError?: (error: unknown) => E
  readonly placeholderData?: T
}

export interface InfiniteQueryDefinition<TPage, TPageParam, E = unknown> {
  readonly key: KvtQueryKey
  readonly query: (context: QueryFunctionContext & { readonly pageParam: TPageParam }) => TPage | Promise<TPage>
  readonly initialPageParam: TPageParam
  readonly getNextPageParam: (lastPage: TPage, pages: readonly TPage[]) => TPageParam | undefined
  readonly getPreviousPageParam?: (firstPage: TPage, pages: readonly TPage[]) => TPageParam | undefined
  readonly enabled?: boolean
  readonly staleTimeMs?: number
  readonly cacheTimeMs?: number
  readonly retry?: number | ((failureCount: number, error: E) => boolean)
  readonly mapError?: (error: unknown) => E
}

export type QueryStatus = 'pending' | 'success' | 'error'

export interface QueryState<T, E> {
  readonly status: QueryStatus
  readonly data?: T
  readonly error?: E
  readonly previousData?: T
  readonly fetching: boolean
  readonly paused: boolean
  readonly stale: boolean
  readonly dataUpdatedAt: number
  readonly errorUpdatedAt: number
  readonly failureCount: number
}

export interface QueryFlow<T, E> extends StateFlow<QueryState<T, E>> {
  refetch(): Promise<QueryState<T, E>>
  cancel(): Promise<void>
  dispose(): void
}

export interface InfiniteQueryFlow<TPage, TPageParam, E> extends QueryFlow<KvtInfiniteData<TPage, TPageParam>, E> {
  fetchNextPage(): Promise<QueryState<KvtInfiniteData<TPage, TPageParam>, E>>
  fetchPreviousPage(): Promise<QueryState<KvtInfiniteData<TPage, TPageParam>, E>>
  readonly hasNextPage: boolean
  readonly hasPreviousPage: boolean
}

export interface KvtInfiniteData<TPage, TPageParam> {
  readonly pages: readonly TPage[]
  readonly pageParams: readonly TPageParam[]
}

export interface MutationContext<TContext> {
  readonly value: TContext
}

export interface MutationDefinition<I, O, E = unknown, TContext = unknown> {
  readonly key?: KvtQueryKey
  readonly mutate: (input: I, context: QueryFunctionContext) => O | Promise<O>
  readonly mapError?: (error: unknown) => E
  readonly onMutate?: (input: I) => TContext | Promise<TContext>
  readonly onSuccess?: (output: O, input: I, context: TContext | undefined) => void | Promise<void>
  readonly onError?: (error: E, input: I, context: TContext | undefined) => void | Promise<void>
}

export interface Mutation<I, O, E> {
  readonly state: StateFlow<QueryState<O, E>>
  execute(input: I): Promise<O>
  reset(): void
  dispose(): void
}

export interface QueryFilter {
  readonly key?: KvtQueryKey
  readonly exact?: boolean
  readonly stale?: boolean
}

export interface PersistedQueryCache {
  readonly version: 1
  readonly timestamp: number
  readonly cache: unknown
}

export interface QueryPersistenceAdapter {
  save(cache: PersistedQueryCache): void | Promise<void>
  restore(): PersistedQueryCache | null | Promise<PersistedQueryCache | null>
  remove(): void | Promise<void>
}

export interface KvtQueryClientOptions {
  readonly scope?: KvtScope
  readonly defaultStaleTimeMs?: number
  readonly defaultCacheTimeMs?: number
  readonly diagnostics?: DiagnosticSink
}

export interface KvtQueryClient {
  observe<T, E = unknown>(definition: QueryDefinition<T, E>): QueryFlow<T, E>
  observeInfinite<TPage, TPageParam, E = unknown>(definition: InfiniteQueryDefinition<TPage, TPageParam, E>): InfiniteQueryFlow<TPage, TPageParam, E>
  mutation<I, O, E = unknown, TContext = unknown>(definition: MutationDefinition<I, O, E, TContext>): Mutation<I, O, E>
  invalidate(filter?: QueryFilter): Promise<void>
  prefetch<T, E = unknown>(definition: QueryDefinition<T, E>): Promise<void>
  getData<T>(key: KvtQueryKey): T | undefined
  setData<T>(key: KvtQueryKey, updater: T | ((previous: T | undefined) => T | undefined)): void
  dehydrate(): PersistedQueryCache
  hydrate(cache: PersistedQueryCache): void
  persist(adapter: QueryPersistenceAdapter): Promise<void>
  restore(adapter: QueryPersistenceAdapter, maxAgeMs?: number): Promise<boolean>
  setFocused(focused: boolean): void
  setOnline(online: boolean): void
  shutdown(context: ShutdownContext): Promise<void>
}

export const kvtQueryClientToken = createToken<KvtQueryClient>('kvt.query-client')

export type QueryPluginOptions = Omit<KvtQueryClientOptions, 'scope' | 'diagnostics'>

export function queryPlugin(options: QueryPluginOptions = {}): PluginDefinition {
  let forward: PluginStartContext['emitDiagnostic'] | undefined
  const diagnostics: DiagnosticSink = {
    emit(event: DiagnosticEvent) {
      forward?.({
        subsystem: event.subsystem,
        operation: event.operation,
        phase: event.phase,
        context: event.context,
        ...(event.trace === undefined ? {} : { trace: event.trace })
      })
    }
  }
  const module = defineModule({
    id: 'query',
    version: '1.0.0',
    providers: [provide(kvtQueryClientToken)
      .using(() => createKvtQueryClient({ ...options, diagnostics }))
      .singleton()
      .eager()]
  })
  return definePlugin({
    id: 'query',
    version: '1.0.0',
    modules: [module],
    start: (context) => { forward = context.emitDiagnostic },
    shutdown: () => { forward = undefined }
  })
}

export function createKvtQueryClient(options: KvtQueryClientOptions = {}): KvtQueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: options.defaultStaleTimeMs ?? 0,
        gcTime: options.defaultCacheTimeMs ?? 5 * 60_000
      }
    }
  })
  const facade = new KvtQueryClientImpl(client, new Diagnostics(options.diagnostics))
  options.scope?.own(facade, 'query-client')
  return facade
}

class KvtQueryClientImpl implements KvtQueryClient {
  readonly #client: QueryClient
  readonly #resources = new Set<{ destroy(): void }>()
  readonly #diagnostics: Diagnostics
  #stopped = false

  constructor(client: QueryClient, diagnostics: Diagnostics) {
    this.#client = client
    this.#diagnostics = diagnostics
  }

  observe<T, E = unknown>(definition: QueryDefinition<T, E>): QueryFlow<T, E> {
    this.#assertActive()
    return new QueryFlowImpl(this.#client, definition, this.#resources, this.#diagnostics)
  }

  observeInfinite<TPage, TPageParam, E = unknown>(
    definition: InfiniteQueryDefinition<TPage, TPageParam, E>
  ): InfiniteQueryFlow<TPage, TPageParam, E> {
    this.#assertActive()
    return new InfiniteQueryFlowImpl(this.#client, definition, this.#resources, this.#diagnostics)
  }

  mutation<I, O, E = unknown, TContext = unknown>(definition: MutationDefinition<I, O, E, TContext>): Mutation<I, O, E> {
    this.#assertActive()
    return new MutationImpl(this.#client, definition, this.#resources, this.#diagnostics)
  }

  async invalidate(filter: QueryFilter = {}): Promise<void> {
    this.#assertActive()
    await this.#client.invalidateQueries({
      ...(filter.key === undefined ? {} : { queryKey: [...filter.key] }),
      ...(filter.exact === undefined ? {} : { exact: filter.exact }),
      ...(filter.stale === undefined ? {} : { stale: filter.stale })
    })
    this.#diagnostics.emit('query', 'invalidate', 'success', { filtered: filter.key !== undefined })
  }

  async prefetch<T, E = unknown>(definition: QueryDefinition<T, E>): Promise<void> {
    this.#assertActive()
    await this.#client.prefetchQuery(toQueryOptions(definition, this.#diagnostics))
  }

  getData<T>(key: KvtQueryKey): T | undefined {
    this.#assertActive()
    return this.#client.getQueryData<T>([...key])
  }

  setData<T>(key: KvtQueryKey, updater: T | ((previous: T | undefined) => T | undefined)): void {
    this.#assertActive()
    this.#client.setQueryData<T>([...key], updater)
  }

  dehydrate(): PersistedQueryCache {
    this.#assertActive()
    return Object.freeze({ version: 1, timestamp: Date.now(), cache: dehydrate(this.#client) })
  }

  hydrate(cache: PersistedQueryCache): void {
    this.#assertActive()
    if (cache.version !== 1) throw new KvtError(`Unsupported query cache version: ${String(cache.version)}`, {
      code: 'KVT_QUERY_CACHE_VERSION_UNSUPPORTED', subsystem: 'query', operation: 'hydrate'
    })
    hydrate(this.#client, cache.cache)
    this.#diagnostics.emit('query', 'hydrate', 'success')
  }

  async persist(adapter: QueryPersistenceAdapter): Promise<void> {
    await adapter.save(this.dehydrate())
  }

  async restore(adapter: QueryPersistenceAdapter, maxAgeMs = Infinity): Promise<boolean> {
    this.#assertActive()
    if (maxAgeMs !== Infinity && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)) {
      throw new RangeError('maxAgeMs must be a non-negative finite number or Infinity')
    }
    const cache = await adapter.restore()
    if (!cache || cache.version !== 1 || Date.now() - cache.timestamp > maxAgeMs) return false
    this.hydrate(cache)
    return true
  }

  setFocused(focused: boolean): void {
    focusManager.setFocused(focused)
  }

  setOnline(online: boolean): void {
    onlineManager.setOnline(online)
  }

  async shutdown(context: ShutdownContext): Promise<void> {
    if (this.#stopped) return
    this.#stopped = true
    for (const resource of this.#resources) resource.destroy()
    this.#resources.clear()
    await raceWithAbort(this.#client.cancelQueries(), context.signal)
    this.#client.clear()
    this.#diagnostics.emit('query', 'shutdown', 'success')
  }

  #assertActive(): void {
    if (this.#stopped) throw new KvtError('Query client is stopped', {
      code: 'KVT_QUERY_CLIENT_STOPPED', subsystem: 'query', operation: 'client-operation'
    })
  }
}

class QueryFlowImpl<T, E> implements QueryFlow<T, E> {
  readonly #client: QueryClient
  readonly #definition: QueryDefinition<T, E>
  readonly #resources: Set<{ destroy(): void }>
  readonly #diagnostics: Diagnostics
  #observer: QueryObserver<T, E> | undefined
  #unsubscribe: (() => void) | undefined
  #listeners = new Set<(value: QueryState<T, E>) => void | Promise<void>>()
  readonly #cancellations = new Set<() => void>()
  #value: QueryState<T, E>
  #previousData: T | undefined

  constructor(client: QueryClient, definition: QueryDefinition<T, E>, resources: Set<{ destroy(): void }>, diagnostics: Diagnostics) {
    this.#client = client
    this.#definition = definition
    this.#resources = resources
    this.#diagnostics = diagnostics
    resources.add(this)
    const observer = new QueryObserver<T, E, T, T, readonly unknown[]>(client, toQueryOptions(definition, diagnostics))
    this.#value = this.#map(observer.getCurrentResult())
    observer.destroy()
  }

  get value(): QueryState<T, E> { return this.#value }

  subscribe(listener: (value: QueryState<T, E>) => void | Promise<void>, options: { readonly emitCurrent?: boolean; readonly signal?: AbortSignal } = {}): Subscription {
    this.#ensureObserver()
    this.#listeners.add(listener)
    if (options.emitCurrent !== false) notifyQueryListener(listener, this.#value)
    let closed = false
    let resolve!: () => void
    const done = new Promise<void>((doneResolve) => { resolve = doneResolve })
    const cancel = () => {
      if (closed) return
      closed = true
      this.#listeners.delete(listener)
      this.#cancellations.delete(cancel)
      options.signal?.removeEventListener('abort', cancel)
      if (this.#listeners.size === 0) this.destroy()
      resolve()
    }
    this.#cancellations.add(cancel)
    if (options.signal?.aborted) cancel()
    else options.signal?.addEventListener('abort', cancel, { once: true })
    return { get closed() { return closed }, done, cancel, dispose: cancel }
  }

  async refetch(): Promise<QueryState<T, E>> {
    this.#ensureObserver()
    await this.#observer?.refetch()
    return this.#value
  }

  async cancel(): Promise<void> {
    await this.#client.cancelQueries({ queryKey: [...this.#definition.key], exact: true })
  }

  destroy(): void {
    for (const cancel of [...this.#cancellations]) cancel()
    this.#resources.delete(this)
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    if (this.#observer) {
      this.#observer.destroy()
      this.#observer = undefined
    }
  }

  dispose(): void { this.destroy() }

  #ensureObserver(): void {
    if (this.#observer) return
    this.#resources.add(this)
    const observer = new QueryObserver<T, E, T, T, readonly unknown[]>(this.#client, toQueryOptions(this.#definition, this.#diagnostics))
    this.#observer = observer
    this.#value = this.#map(observer.getCurrentResult())
    this.#unsubscribe = observer.subscribe((result) => {
      this.#value = this.#map(result)
      for (const listener of [...this.#listeners]) notifyQueryListener(listener, this.#value)
    })
  }

  #map(result: QueryObserverResult<T, E>): QueryState<T, E> {
    const previousData = this.#previousData
    const state = mapQueryResult(result, this.#definition.mapError, previousData)
    if (result.data !== undefined) this.#previousData = result.data
    return state
  }
}

class InfiniteQueryFlowImpl<TPage, TPageParam, E> implements InfiniteQueryFlow<TPage, TPageParam, E> {
  readonly #client: QueryClient
  readonly #definition: InfiniteQueryDefinition<TPage, TPageParam, E>
  readonly #resources: Set<{ destroy(): void }>
  readonly #diagnostics: Diagnostics
  #observer: InfiniteQueryObserver<TPage, E, InfiniteData<TPage, TPageParam>, readonly unknown[], TPageParam> | undefined
  #unsubscribe: (() => void) | undefined
  #listeners = new Set<(value: QueryState<KvtInfiniteData<TPage, TPageParam>, E>) => void | Promise<void>>()
  readonly #cancellations = new Set<() => void>()
  #value: QueryState<KvtInfiniteData<TPage, TPageParam>, E>
  #hasNext = false
  #hasPrevious = false

  constructor(
    client: QueryClient,
    definition: InfiniteQueryDefinition<TPage, TPageParam, E>,
    resources: Set<{ destroy(): void }>,
    diagnostics: Diagnostics
  ) {
    this.#client = client
    this.#definition = definition
    this.#resources = resources
    this.#diagnostics = diagnostics
    resources.add(this)
    this.#value = emptyQueryState()
  }

  get value() { return this.#value }
  get hasNextPage() { return this.#hasNext }
  get hasPreviousPage() { return this.#hasPrevious }

  subscribe(listener: (value: QueryState<KvtInfiniteData<TPage, TPageParam>, E>) => void | Promise<void>, options: { readonly emitCurrent?: boolean; readonly signal?: AbortSignal } = {}): Subscription {
    this.#ensureObserver()
    this.#listeners.add(listener)
    if (options.emitCurrent !== false) notifyQueryListener(listener, this.#value)
    let closed = false
    let resolve!: () => void
    const done = new Promise<void>((doneResolve) => { resolve = doneResolve })
    const cancel = () => {
      if (closed) return
      closed = true
      this.#listeners.delete(listener)
      this.#cancellations.delete(cancel)
      options.signal?.removeEventListener('abort', cancel)
      if (this.#listeners.size === 0) this.destroy()
      resolve()
    }
    this.#cancellations.add(cancel)
    if (options.signal?.aborted) cancel()
    else options.signal?.addEventListener('abort', cancel, { once: true })
    return { get closed() { return closed }, done, cancel, dispose: cancel }
  }

  async refetch() { this.#ensureObserver(); await this.#observer!.refetch(); return this.#value }
  async fetchNextPage() { this.#ensureObserver(); await this.#observer!.fetchNextPage(); return this.#value }
  async fetchPreviousPage() { this.#ensureObserver(); await this.#observer!.fetchPreviousPage(); return this.#value }
  async cancel() { await this.#client.cancelQueries({ queryKey: [...this.#definition.key], exact: true }) }

  destroy(): void {
    for (const cancel of [...this.#cancellations]) cancel()
    this.#resources.delete(this)
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    if (this.#observer) {
      this.#observer.destroy()
      this.#observer = undefined
    }
  }

  dispose(): void { this.destroy() }

  #ensureObserver(): void {
    if (this.#observer) return
    this.#resources.add(this)
    const observer = new InfiniteQueryObserver<TPage, E, InfiniteData<TPage, TPageParam>, readonly unknown[], TPageParam>(
      this.#client,
      toInfiniteOptions(this.#definition, this.#diagnostics)
    )
    this.#observer = observer
    this.#value = this.#map(observer.getCurrentResult() as InfiniteQueryObserverResult<InfiniteData<TPage, TPageParam>, E>)
    this.#unsubscribe = observer.subscribe((result) => {
      this.#value = this.#map(result)
      for (const listener of [...this.#listeners]) notifyQueryListener(listener, this.#value)
    })
  }

  #map(result: InfiniteQueryObserverResult<InfiniteData<TPage, TPageParam>, E>): QueryState<KvtInfiniteData<TPage, TPageParam>, E> {
    this.#hasNext = result.hasNextPage
    this.#hasPrevious = result.hasPreviousPage
    return mapQueryResult(result, this.#definition.mapError, this.#value.data)
  }
}

class MutationImpl<I, O, E, TContext> implements Mutation<I, O, E> {
  readonly #observer: MutationObserver<O, E, I, TContext>
  readonly #stateFlow: MutableStateFlow<QueryState<O, E>>
  readonly #unsubscribe: () => void
  readonly #controllers = new Set<AbortController>()
  readonly #resources: Set<{ destroy(): void }>

  constructor(
    client: QueryClient,
    definition: MutationDefinition<I, O, E, TContext>,
    resources: Set<{ destroy(): void }>,
    diagnostics: Diagnostics
  ) {
    this.#resources = resources
    this.#observer = new MutationObserver(client, {
      ...(definition.key === undefined ? {} : { mutationKey: [...definition.key] }),
      mutationFn: async (input) => {
        const controller = new AbortController()
        this.#controllers.add(controller)
        diagnostics.emit('query', 'mutation', 'start')
        try {
          const result = await definition.mutate(input, { signal: controller.signal })
          diagnostics.emit('query', 'mutation', 'success')
          return result
        } catch (error) {
          diagnostics.emit('query', 'mutation', 'failure', { error })
          throw mapError(error, definition.mapError)
        } finally {
          this.#controllers.delete(controller)
        }
      },
      ...(definition.onMutate === undefined ? {} : { onMutate: definition.onMutate }),
      ...(definition.onSuccess === undefined ? {} : { onSuccess: definition.onSuccess }),
      ...(definition.onError === undefined ? {} : {
        onError: async (error: E, input: I, context: TContext | undefined) => definition.onError?.(error, input, context)
      })
    })
    resources.add(this)
    this.#stateFlow = new MutableStateFlow(emptyQueryState<O, E>())
    this.#unsubscribe = this.#observer.subscribe((result) => {
      this.#stateFlow.set(mapMutationResult<O, E>(result, definition.mapError))
    })
  }

  get state(): StateFlow<QueryState<O, E>> { return this.#stateFlow.asStateFlow() }
  execute(input: I): Promise<O> { return this.#observer.mutate(input) }
  reset(): void { this.#observer.reset() }
  dispose(): void { this.destroy() }
  destroy(): void {
    for (const controller of this.#controllers) controller.abort('mutation-owner-stopped')
    this.#controllers.clear()
    this.#unsubscribe()
    this.#observer.reset()
    this.#resources.delete(this)
  }
}

function toQueryOptions<T, E>(
  definition: QueryDefinition<T, E>,
  diagnostics: Diagnostics
): QueryObserverOptions<T, E, T, T, readonly unknown[]> {
  const options = {
    queryKey: definition.key,
    queryFn: async ({ signal }: { readonly signal: AbortSignal }) => {
      diagnostics.emit('query', 'fetch', 'start', { keyParts: definition.key.length })
      try {
        const result = await definition.query({ signal })
        diagnostics.emit('query', 'fetch', 'success', { keyParts: definition.key.length })
        return result
      } catch (error) {
        diagnostics.emit('query', 'fetch', 'failure', { keyParts: definition.key.length, error })
        throw error
      }
    },
    enabled: definition.enabled ?? true,
    ...(definition.staleTimeMs === undefined ? {} : { staleTime: definition.staleTimeMs }),
    ...(definition.cacheTimeMs === undefined ? {} : { gcTime: definition.cacheTimeMs }),
    ...(definition.retry === undefined ? {} : { retry: definition.retry }),
    ...(definition.retryDelayMs === undefined ? {} : { retryDelay: definition.retryDelayMs }),
    ...(definition.placeholderData === undefined ? {} : { placeholderData: definition.placeholderData })
  }
  return options as unknown as QueryObserverOptions<T, E, T, T, readonly unknown[]>
}

function toInfiniteOptions<TPage, TPageParam, E>(
  definition: InfiniteQueryDefinition<TPage, TPageParam, E>,
  diagnostics: Diagnostics
): InfiniteQueryObserverOptions<TPage, E, InfiniteData<TPage, TPageParam>, readonly unknown[], TPageParam> {
  const options = {
    queryKey: definition.key,
    queryFn: async ({ signal, pageParam }: { readonly signal: AbortSignal; readonly pageParam: TPageParam }) => {
      diagnostics.emit('query', 'fetch-page', 'start', { keyParts: definition.key.length })
      try {
        const result = await definition.query({ signal, pageParam })
        diagnostics.emit('query', 'fetch-page', 'success', { keyParts: definition.key.length })
        return result
      } catch (error) {
        diagnostics.emit('query', 'fetch-page', 'failure', { keyParts: definition.key.length, error })
        throw error
      }
    },
    initialPageParam: definition.initialPageParam,
    getNextPageParam: (lastPage: TPage, pages: TPage[]) => definition.getNextPageParam(lastPage, pages),
    ...(definition.getPreviousPageParam === undefined ? {} : {
      getPreviousPageParam: (firstPage: TPage, pages: TPage[]) => definition.getPreviousPageParam?.(firstPage, pages)
    }),
    enabled: definition.enabled ?? true,
    ...(definition.staleTimeMs === undefined ? {} : { staleTime: definition.staleTimeMs }),
    ...(definition.cacheTimeMs === undefined ? {} : { gcTime: definition.cacheTimeMs }),
    ...(definition.retry === undefined ? {} : { retry: definition.retry })
  }
  return options as unknown as InfiniteQueryObserverOptions<TPage, E, InfiniteData<TPage, TPageParam>, readonly unknown[], TPageParam>
}

function mapQueryResult<T, E>(
  result: QueryObserverResult<T, E>,
  mapper: ((error: unknown) => E) | undefined,
  previousData: T | undefined
): QueryState<T, E> {
  return Object.freeze({
    status: result.status,
    ...(result.data === undefined ? {} : { data: result.data }),
    ...(result.error == null ? {} : { error: mapError(result.error, mapper) }),
    ...(previousData === undefined ? {} : { previousData }),
    fetching: result.fetchStatus === 'fetching',
    paused: result.fetchStatus === 'paused',
    stale: result.isStale,
    dataUpdatedAt: result.dataUpdatedAt,
    errorUpdatedAt: result.errorUpdatedAt,
    failureCount: result.failureCount
  })
}

function mapMutationResult<T, E>(result: {
  readonly status: string
  readonly data: T | undefined
  readonly error: E | null
  readonly failureCount: number
}, mapper?: (error: unknown) => E): QueryState<T, E> {
  const status: QueryStatus = result.status === 'idle' ? 'pending' : result.status as QueryStatus
  return Object.freeze({
    status,
    ...(result.data === undefined ? {} : { data: result.data }),
    ...(result.error == null ? {} : { error: mapError(result.error, mapper) }),
    fetching: result.status === 'pending', paused: false, stale: false,
    dataUpdatedAt: result.data === undefined ? 0 : Date.now(), errorUpdatedAt: result.error == null ? 0 : Date.now(),
    failureCount: result.failureCount
  })
}

function emptyQueryState<T, E>(): QueryState<T, E> {
  return Object.freeze({ status: 'pending', fetching: false, paused: false, stale: true,
    dataUpdatedAt: 0, errorUpdatedAt: 0, failureCount: 0 })
}

function mapError<E>(error: unknown, mapper?: (error: unknown) => E): E {
  return mapper ? mapper(error) : error as E
}

function notifyQueryListener<T>(listener: (value: T) => void | Promise<void>, value: T): void {
  try {
    const result = listener(value)
    if (result instanceof Promise) void result.catch((error: unknown) => reportFlowError(error, { operation: 'listener' }))
  } catch (error) {
    reportFlowError(error, { operation: 'listener' })
  }
}
