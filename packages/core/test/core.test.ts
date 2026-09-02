import { describe, expect, it, vi } from 'vitest'
import {
  KvtError,
  ViewModel,
  bind,
  bootstrapKvt,
  combine,
  createMultiToken,
  createToken,
  defineModule,
  definePlugin,
  err,
  flatMap,
  fromPromise,
  map,
  mapError,
  match,
  ok,
  optional,
  provide,
  satisfiesVersion,
  tap,
  type Result,
  type ShutdownContext
} from '../src/index.js'

describe('runtime lifecycle', () => {
  it('bootstraps asynchronously and returns one shutdown promise', async () => {
    const events: string[] = []
    const service = createToken<{ shutdown(context: ShutdownContext): void }>('service')
    const runtime = await bootstrapKvt({
      modules: [defineModule({
        id: 'app', version: '1.0.0',
        providers: [provide(service).using(() => ({ shutdown: () => { events.push('service') } })).singleton().eager()]
      })]
    })
    expect(runtime.state).toBe('running')
    const first = runtime.shutdown({ reason: 'test' })
    const second = runtime.shutdown({ reason: 'ignored' })
    expect(first).toBe(second)
    await first
    expect(events).toEqual(['service'])
    expect(runtime.state).toBe('stopped')
    expect(() => runtime.resolve(service)).toThrow(KvtError)
  })

  it('rolls back eager resources after partial bootstrap failure', async () => {
    const cleanup = vi.fn()
    const resource = createToken<{ shutdown(): void }>('resource')
    const failure = createToken<never>('failure')
    await expect(bootstrapKvt({ modules: [defineModule({
      id: 'rollback', version: '1.0.0', providers: [
        provide(resource).using(() => ({ shutdown: cleanup })).singleton().eager(),
        provide(failure).usingAsync(async () => { throw new Error('start failed') }).singleton().eager()
      ]
    })] })).rejects.toThrow('start failed')
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('cleans a provider that resolves while shutdown is already in progress', async () => {
    let complete!: (value: { shutdown(): void }) => void
    const cleanup = vi.fn()
    const service = createToken<{ shutdown(): void }>('late-service')
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'late', version: '1.0.0', providers: [
        provide(service).usingAsync(() => new Promise((resolve) => { complete = resolve })).scoped()
      ]
    })] })
    const scope = runtime.rootScope.createChild({ id: 'late-child' })
    const resolving = scope.resolveAsync(service)
    await Promise.resolve()
    const shutdown = scope.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
    complete({ shutdown: cleanup })
    await expect(resolving).rejects.toMatchObject({ code: 'KVT_DI_PROVIDER_COMPLETED_AFTER_SHUTDOWN' })
    await shutdown
    expect(cleanup).toHaveBeenCalledOnce()
    expect(scope.ownedResourceCount).toBe(0)
    await runtime.shutdown({ reason: 'test' })
  })

  it('continues reverse-order cleanup and aggregates failures', async () => {
    const calls: string[] = []
    const runtime = await bootstrapKvt()
    runtime.rootScope.own({ shutdown: () => { calls.push('first') } }, 'first')
    runtime.rootScope.own({ shutdown: () => { calls.push('second'); throw new Error('second failed') } }, 'second')
    runtime.rootScope.own({ dispose: () => { calls.push('third') } }, 'third')
    await expect(runtime.shutdown({ reason: 'test' })).rejects.toBeInstanceOf(AggregateError)
    expect(calls).toEqual(['third', 'second', 'first'])
    expect(runtime.state).toBe('failed')
  })

  it('aborts a hanging cleanup at the runtime deadline', async () => {
    const runtime = await bootstrapKvt()
    let observedAbort = false
    runtime.rootScope.own({ shutdown: ({ signal }: ShutdownContext) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => { observedAbort = true; resolve() }, { once: true })
    }) })
    await expect(runtime.shutdown({ reason: 'test', timeoutMs: 5 })).rejects.toBeInstanceOf(AggregateError)
    expect(observedAbort).toBe(true)
    expect(runtime.state).toBe('failed')
  })

  it('starts and shuts plugins in dependency order', async () => {
    const calls: string[] = []
    const base = definePlugin({ id: 'base', version: '1.0.0', start: () => { calls.push('base:start') }, shutdown: () => { calls.push('base:stop') } })
    const feature = definePlugin({
      id: 'feature', version: '1.0.0', requires: [{ id: 'base', version: '^1.0.0' }],
      start: () => { calls.push('feature:start') }, shutdown: () => { calls.push('feature:stop') }
    })
    const runtime = await bootstrapKvt({ plugins: [feature, base] })
    await runtime.shutdown({ reason: 'test' })
    expect(calls).toEqual(['base:start', 'feature:start', 'feature:stop', 'base:stop'])
  })

  it('rolls back a plugin that fails partway through startup', async () => {
    const shutdown = vi.fn()
    const plugin = definePlugin({
      id: 'partial', version: '1.0.0',
      start: () => { throw new Error('partial startup') },
      shutdown
    })
    await expect(bootstrapKvt({ plugins: [plugin] })).rejects.toThrow('partial startup')
    expect(shutdown).toHaveBeenCalledOnce()
  })

  it('does not poison a running runtime after invalid shutdown options', async () => {
    const runtime = await bootstrapKvt()
    await expect(runtime.shutdown({ reason: 'invalid', timeoutMs: 0 })).rejects.toThrow(RangeError)
    expect(runtime.state).toBe('running')
    await runtime.shutdown({ reason: 'valid' })
    expect(runtime.state).toBe('stopped')
  })

  it('exposes a frozen metadata-only scope and ViewModel inspection graph', async () => {
    const runtime = await bootstrapKvt()
    const child = runtime.rootScope.createChild({ id: 'inspect-child' })
    child.own({ secret: 'must-not-appear', dispose() {} }, 'safe-resource-label')
    const inspection = runtime.inspect()
    expect(inspection.rootScope.children[0]).toMatchObject({
      id: 'inspect-child', ownedResourceCount: 1, ownedResources: [{ label: 'safe-resource-label' }]
    })
    expect(JSON.stringify(inspection)).not.toContain('must-not-appear')
    expect(Object.isFrozen(inspection.rootScope.children)).toBe(true)
    expect(inspection.rootViewModelOwner).toMatchObject({ id: 'root', stopped: false, entries: [] })
    await runtime.shutdown({ reason: 'test' })
  })
})

describe('dependency injection', () => {
  it('uses constructor identity for concrete and abstract class bindings', async () => {
    abstract class Repository { abstract value(): string }
    class MemoryRepository extends Repository { value(): string { return 'memory' } }
    const FirstNamed = class SameName { readonly source = 'first' }
    const SecondNamed = class SameName { readonly source = 'second' }
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'class-identifiers', version: '1.0.0', providers: [
        bind(Repository).to(MemoryRepository).singleton(),
        bind(FirstNamed),
        bind(SecondNamed)
      ]
    })] })
    expect(runtime.resolve(Repository).value()).toBe('memory')
    expect(runtime.resolve(FirstNamed)).toBeInstanceOf(FirstNamed)
    expect(runtime.resolve(SecondNamed)).toBeInstanceOf(SecondNamed)
    expect(() => runtime.resolve(class Unregistered {})).toThrow(expect.objectContaining({ code: 'KVT_DI_PROVIDER_MISSING' }))
    await runtime.shutdown({ reason: 'test' })
  })

  it('requires a ViewModelOwner for .viewModel() bindings', async () => {
    class OwnedViewModel extends ViewModel {}
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'owned-view-model', version: '1.0.0', providers: [bind(OwnedViewModel).viewModel()]
    })] })
    expect(() => runtime.resolve(OwnedViewModel)).toThrow(expect.objectContaining({ code: 'KVT_VIEW_MODEL_OWNER_REQUIRED' }))
    const lease = runtime.rootViewModelOwner.acquire(OwnedViewModel)
    await lease.commit()
    expect(lease.value.lifecycleState.value).toBe('running')
    await runtime.shutdown({ reason: 'test' })
  })

  it('keeps root singleton dependencies in root while child overrides affect scoped/transient graphs', async () => {
    const name = createToken<string>('name')
    const singleton = createToken<string>('singleton')
    const scoped = createToken<string>('scoped')
    const transient = createToken<string>('transient')
    const rootModule = defineModule({ id: 'root', version: '1.0.0', providers: [
      provide(name).value('root'),
      provide(singleton).inject(name).using((value) => `singleton:${value}`).singleton(),
      provide(scoped).inject(name).using((value) => `scoped:${value}`).scoped(),
      provide(transient).inject(name).using((value) => `transient:${value}`).transient()
    ] })
    const runtime = await bootstrapKvt({ modules: [rootModule] })
    const overrideModule = defineModule({
      id: 'child', version: '1.0.0', providers: [provide(name).value('child').override()]
    })
    const registry = new (await import('../src/di/registry.js')).ProviderRegistry([overrideModule], runtime.rootScope.registry)
    const child = runtime.rootScope.createChild({ registry })
    expect(child.resolve(singleton)).toBe('singleton:root')
    expect(child.resolve(scoped)).toBe('scoped:child')
    expect(child.resolve(transient)).toBe('transient:child')
    await runtime.shutdown({ reason: 'test' })
  })

  it('supports optional and multi bindings and rejects duplicates', async () => {
    const missing = createToken<string>('missing')
    const optionalValue = createToken<string | undefined>('optional-value')
    const handlers = createMultiToken<string>('handlers')
    const runtime = await bootstrapKvt({ modules: [defineModule({ id: 'bindings', version: '1.0.0', providers: [
      provide(optionalValue).inject(optional(missing)).using((value) => value).singleton(),
      provide(handlers).value('first'),
      provide(handlers).value('second')
    ] })] })
    expect(runtime.resolve(optionalValue)).toBeUndefined()
    expect(runtime.resolve(handlers)).toEqual(['first', 'second'])
    await runtime.shutdown({ reason: 'test' })

    const token = createToken<string>('duplicate')
    expect(() => defineModule({ id: 'duplicate', version: '1.0.0', providers: [provide(token).value('a'), provide(token).value('b')] })).not.toThrow()
    await expect(bootstrapKvt({ modules: [defineModule({ id: 'duplicate', version: '1.0.0', providers: [
      provide(token).value('a'), provide(token).value('b')
    ] })] })).rejects.toThrow('Duplicate provider')
  })

  it('does not take ownership of externally supplied value providers', async () => {
    const shutdown = vi.fn()
    const external = createToken<{ shutdown(): void }>('external')
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'external-value', version: '1.0.0', providers: [provide(external).value({ shutdown })]
    })] })
    expect(runtime.resolve(external)).toBeDefined()
    await runtime.shutdown({ reason: 'test' })
    expect(shutdown).not.toHaveBeenCalled()
  })

  it('rejects conflicting module identities and circular requirements before startup', async () => {
    const first = defineModule({ id: 'same', version: '1.0.0' })
    const second = defineModule({ id: 'same', version: '1.0.0' })
    await expect(bootstrapKvt({ modules: [first, second] })).rejects.toMatchObject({
      code: 'KVT_MODULE_DEFINITION_CONFLICT'
    })
    const left = defineModule({ id: 'left', version: '1.0.0', requires: [{ id: 'right', version: '^1.0.0' }] })
    const right = defineModule({ id: 'right', version: '1.0.0', requires: [{ id: 'left', version: '^1.0.0' }] })
    await expect(bootstrapKvt({ modules: [left, right] })).rejects.toMatchObject({ code: 'KVT_MODULE_REQUIREMENT_CYCLE' })
  })

  it('deduplicates concurrent feature loads and unloads after the last handle', async () => {
    const runtime = await bootstrapKvt()
    const service = createToken<string>('feature-service')
    const loader = vi.fn(async () => defineModule({
      id: 'users', version: '1.0.0', providers: [provide(service).value('ready')]
    }))
    const [first, second] = await Promise.all([
      runtime.loadFeature({ id: 'users', version: '1.0.0', load: loader }),
      runtime.loadFeature({ id: 'users', version: '1.0.0', load: loader })
    ])
    expect(loader).toHaveBeenCalledOnce()
    expect(first.scope.resolve(service)).toBe('ready')
    await first.release()
    expect(second.scope.state).toBe('active')
    await second.release()
    expect(second.scope.state).toBe('stopped')
    await runtime.shutdown({ reason: 'test' })
  })

  it('keeps a shared feature load alive while another caller is still waiting', async () => {
    const runtime = await bootstrapKvt()
    let finish!: () => void
    const module = defineModule({ id: 'shared', version: '1.0.0' })
    const load = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<typeof module>((resolve, reject) => {
      finish = () => resolve(module)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const definition = { id: 'shared', version: '1.0.0', load }
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = runtime.loadFeature(definition, firstController.signal)
    const second = runtime.loadFeature(definition, secondController.signal)
    firstController.abort('first navigation cancelled')
    await expect(first).rejects.toBe('first navigation cancelled')
    finish()
    const secondHandle = await second
    expect(load).toHaveBeenCalledOnce()
    expect(secondHandle.scope.state).toBe('active')
    await secondHandle.release()
    await runtime.shutdown({ reason: 'test' })
  })

  it('does not cache an all-callers-cancelled feature failure', async () => {
    const runtime = await bootstrapKvt()
    let attempts = 0
    const module = defineModule({ id: 'retryable', version: '1.0.0' })
    const load = ({ signal }: { signal: AbortSignal }) => {
      attempts++
      if (attempts > 1) return Promise.resolve(module)
      return new Promise<typeof module>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    const controller = new AbortController()
    const cancelled = runtime.loadFeature({ id: 'retryable', version: '1.0.0', load }, controller.signal)
    controller.abort('navigation cancelled')
    await expect(cancelled).rejects.toBe('navigation cancelled')
    const retried = await runtime.loadFeature({ id: 'retryable', version: '1.0.0', load })
    expect(attempts).toBe(2)
    await retried.release()
    await runtime.shutdown({ reason: 'test' })
  })

  it('rejects a conflicting loader for the same feature identity', async () => {
    const runtime = await bootstrapKvt()
    const module = defineModule({ id: 'conflict', version: '1.0.0' })
    let finish!: () => void
    const firstLoad = () => new Promise<typeof module>((resolve) => { finish = () => resolve(module) })
    const first = runtime.loadFeature({ id: 'conflict', version: '1.0.0', load: firstLoad })
    await expect(runtime.loadFeature({ id: 'conflict', version: '1.0.0', load: async () => module }))
      .rejects.toMatchObject({ code: 'KVT_FEATURE_LOADER_CONFLICT' })
    finish()
    const handle = await first
    await handle.release()
    await runtime.shutdown({ reason: 'test' })
  })

  it('supports explicit development feature reload and forbids invalidation after shutdown', async () => {
    const runtime = await bootstrapKvt()
    let generation = 0
    const load = async () => defineModule({ id: 'hmr', version: '1.0.0', providers: [
      provide(createToken(`generation-${++generation}`)).value(generation)
    ] })
    const first = await runtime.loadFeature({ id: 'hmr', version: '1.0.0', load })
    const second = await runtime.reloadFeature({ id: 'hmr', version: '1.0.0', load })
    expect(first.scope.state).toBe('stopped')
    expect(second.scope.state).toBe('active')
    expect(generation).toBe(2)
    await second.release()
    await runtime.shutdown({ reason: 'test' })
    await expect(runtime.invalidateFeature('hmr')).rejects.toMatchObject({ code: 'KVT_RUNTIME_INVALID_STATE' })
  })
})

describe('ViewModel lifecycle', () => {
  it('rolls back failed-attempt resources before retrying start', async () => {
    const cleanup = vi.fn()
    let starts = 0
    class RetryingViewModel extends ViewModel {
      protected override onStart() {
        starts++
        this.own({ dispose: cleanup })
        if (starts === 1) throw new Error('temporary')
      }
    }
    const viewModel = new RetryingViewModel()
    await viewModel.start(new AbortController().signal, { attempts: 2 })
    expect(starts).toBe(2)
    expect(cleanup).toHaveBeenCalledOnce()
    await viewModel.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(viewModel.lifecycleState.value).toBe('stopped')
    await expect(viewModel.start(new AbortController().signal)).rejects.toMatchObject({ code: 'KVT_VIEW_MODEL_RESTART_FORBIDDEN' })
  })

  it('cancels and rolls back an in-flight start before stopping', async () => {
    const cleanup = vi.fn()
    class SlowViewModel extends ViewModel {
      protected override onStart(signal: AbortSignal) {
        this.own({ dispose: cleanup })
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }
    }
    const viewModel = new SlowViewModel()
    const starting = viewModel.start(new AbortController().signal)
    const stopping = viewModel.shutdown({ signal: new AbortController().signal, reason: 'test', deadline: undefined })
    await expect(starting).rejects.toMatchObject({ code: 'KVT_VIEW_MODEL_START_CANCELLED' })
    await stopping
    expect(cleanup).toHaveBeenCalledOnce()
    expect(viewModel.lifecycleState.value).toBe('stopped')
  })
})

describe('Result', () => {
  it('supports exhaustive success and failure composition', async () => {
    const action = vi.fn()
    const unit: Result<void, 'failure'> = ok()
    expect(unit).toEqual({ ok: true, value: undefined })
    expect(map(ok(2), (value) => value * 2)).toEqual(ok(4))
    expect(flatMap(ok(2), (value) => ok(String(value)))).toEqual(ok('2'))
    expect(mapError(err('failure'), (error) => error.length)).toEqual(err(7))
    expect(match(ok(3), { ok: (value) => value, err: () => 0 })).toBe(3)
    expect(tap(ok(1), action)).toEqual(ok(1))
    expect(action).toHaveBeenCalledWith(1)
    expect(combine([ok(1), ok('two')] as const)).toEqual(ok([1, 'two']))
    await expect(fromPromise(Promise.reject(new Error('failure')), () => 'mapped')).resolves.toEqual(err('mapped'))
  })
})

describe('manifest versions and safe errors', () => {
  it('applies caret compatibility correctly for zero-major versions', () => {
    expect(satisfiesVersion('1.4.0', '^1.2.0')).toBe(true)
    expect(satisfiesVersion('2.0.0', '^1.2.0')).toBe(false)
    expect(satisfiesVersion('0.3.0', '^0.2.0')).toBe(false)
    expect(satisfiesVersion('0.2.9', '^0.2.0')).toBe(true)
    expect(satisfiesVersion('1.0.0-beta.1', '^1.0.0')).toBe(false)
  })

  it('redacts unsafe KvtError context at construction', () => {
    const error = new KvtError('safe', {
      code: 'TEST', subsystem: 'runtime', operation: 'test',
      context: { userId: 'public-id', password: 'do-not-log', state: { private: true } }
    })
    expect(error.context).toEqual({ userId: 'public-id', password: '[redacted]', state: '[object]' })
  })
})
