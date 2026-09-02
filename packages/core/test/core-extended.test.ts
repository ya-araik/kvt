import { describe, expect, it, vi } from 'vitest'
import { MutableStateFlow } from '@kvt/flow'
import {
  Diagnostics,
  KvtError,
  KvtRuntime,
  KvtScope,
  ProviderRegistry,
  ViewModel,
  ViewModelOwner,
  bind,
  bootstrapKvt,
  combine,
  createMultiToken,
  createToken,
  defineModule,
  definePlugin,
  dependencyToken,
  err,
  flatMap,
  fromPromise,
  isDisposable,
  isErr,
  isKvtError,
  isOk,
  isShutdownable,
  lazy,
  map,
  mapError,
  match,
  ok,
  optional,
  provide,
  raceWithAbort,
  redactDiagnosticContext,
  redactKvtContext,
  satisfiesVersion,
  shutdownResource,
  tap,
  type ModuleDefinition,
  type NoInputUseCase,
  type UseCase,
  type UseCaseContext,
  type ShutdownContext
} from '../src/index.js'

const context = (reason = 'test'): ShutdownContext => ({
  signal: new AbortController().signal,
  reason,
  deadline: undefined
})

describe('errors, diagnostics and lifecycle helpers', () => {
  it('redacts every unsafe value shape and preserves stable KvtError fields', () => {
    const cause = new Error('cause')
    const error = new KvtError('failure', {
      code: 'TEST_FAILURE',
      subsystem: 'runtime',
      operation: 'test',
      cause,
      context: {
        safe: 'yes',
        count: 1,
        enabled: true,
        nullable: null,
        omitted: undefined,
        tokenValue: 'secret',
        list: [1],
        nested: {},
        failure: new TypeError('bad')
      },
      path: ['root', 'child'],
      retryable: true
    })
    expect(isKvtError(error)).toBe(true)
    expect(isKvtError({ code: 'TEST_FAILURE' })).toBe(false)
    expect(error).toMatchObject({
      name: 'KvtError',
      code: 'TEST_FAILURE',
      subsystem: 'runtime',
      operation: 'test',
      retryable: true,
      context: {
        safe: 'yes',
        count: 1,
        enabled: true,
        nullable: null,
        tokenValue: '[redacted]',
        list: '[array]',
        nested: '[object]',
        failure: 'TypeError'
      },
      path: ['root', 'child'],
      cause
    })
    expect(Object.isFrozen(error.context)).toBe(true)
    expect(redactKvtContext()).toEqual({})
    expect(redactDiagnosticContext({ payload: 'private' })).toEqual({
      payload: '[redacted]'
    })
  })

  it('makes diagnostics optional and observational while sequencing frozen events', () => {
    expect(() => new Diagnostics().emit('runtime', 'noop', 'state')).not.toThrow()
    const events: unknown[] = []
    const diagnostics = new Diagnostics({
      emit: (event) => events.push(event)
    })
    diagnostics.emit('runtime', 'state', 'state', { state: 'running' }, { traceId: 'trace' })
    diagnostics.emit('scope', 'create', 'success')
    expect(events).toEqual([
      expect.objectContaining({
        sequence: 1,
        context: { state: 'running' },
        trace: { traceId: 'trace' }
      }),
      expect.objectContaining({ sequence: 2, context: {} })
    ])
    expect(Object.isFrozen(events[0])).toBe(true)
    expect(() =>
      new Diagnostics({
        emit: () => {
          throw new Error('sink')
        }
      }).emit('runtime', 'state', 'state')
    ).not.toThrow()
  })

  it('detects and shuts down sync/async resource contracts', async () => {
    const dispose = vi.fn()
    const shutdown = vi.fn(async () => undefined)
    expect(isDisposable({ dispose })).toBe(true)
    expect(isDisposable(null)).toBe(false)
    expect(isShutdownable({ shutdown })).toBe(true)
    expect(isShutdownable({ shutdown: true })).toBe(false)
    expect(isShutdownable(null)).toBe(false)
    await shutdownResource({ dispose }, context())
    await shutdownResource({ shutdown }, context())
    await shutdownResource({}, context())
    expect(dispose).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledOnce()
  })

  it('races abort before and during an operation with custom and default reasons', async () => {
    const before = new AbortController()
    before.abort('before')
    await expect(raceWithAbort(Promise.resolve(1), before.signal)).rejects.toBe('before')

    const during = new AbortController()
    const pending = raceWithAbort(new Promise<never>(() => undefined), during.signal)
    during.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    const active = new AbortController()
    await expect(raceWithAbort(Promise.resolve(3), active.signal)).resolves.toBe(3)

    let added: EventListenerOrEventListenerObject | undefined
    let removed: EventListenerOrEventListenerObject | undefined
    let addOptions: AddEventListenerOptions | boolean | undefined
    const trackedSignal = {
      aborted: false,
      reason: undefined,
      addEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions | boolean
      ) => {
        added = listener
        addOptions = options
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        removed = listener
      }
    } as AbortSignal
    await expect(raceWithAbort(Promise.resolve(4), trackedSignal)).resolves.toBe(4)
    expect(addOptions).toEqual({ once: true })
    expect(removed).toBe(added)

    const withoutReason = { aborted: true, reason: undefined } as AbortSignal
    await expect(raceWithAbort(Promise.resolve(1), withoutReason)).rejects.toMatchObject({
      code: 'KVT_LIFECYCLE_ABORTED'
    })
  })
})

describe('Result branches', () => {
  it('preserves errors and exhaustively maps both branches', async () => {
    const failure = err('failure')
    expect(isOk(ok(1))).toBe(true)
    expect(isErr(failure)).toBe(true)
    expect(map(failure, () => 1)).toBe(failure)
    expect(flatMap(failure, () => ok(1))).toBe(failure)
    const success = ok(2)
    expect(mapError(success, () => 'mapped')).toBe(success)
    expect(match(failure, { ok: () => 0, err: (value) => value })).toBe('failure')
    const action = vi.fn()
    expect(tap(failure, action)).toBe(failure)
    expect(action).not.toHaveBeenCalled()
    expect(combine([ok(1), failure, ok(3)] as const)).toBe(failure)
    await expect(fromPromise(async () => 4)).resolves.toEqual(ok(4))
    await expect(fromPromise(Promise.resolve(5))).resolves.toEqual(ok(5))
  })
})

describe('manifests and provider registry validation', () => {
  const capturedKvtError = (operation: () => unknown): KvtError => {
    try {
      operation()
      throw new Error('expected KvtError')
    } catch (error) {
      expect(error).toBeInstanceOf(KvtError)
      return error as KvtError
    }
  }

  it('validates module/plugin identities and dependency definitions', () => {
    for (const invalid of ['', ' Upper', 'upper!', 'a-']) {
      expect(() => defineModule({ id: invalid, version: '1.0.0' })).toThrow(
        expect.objectContaining({ code: 'KVT_MANIFEST_ID_INVALID' })
      )
    }
    expect(() => definePlugin({ id: 'plugin', version: 'next' })).toThrow(
      expect.objectContaining({ code: 'KVT_MANIFEST_VERSION_INVALID' })
    )
    expect(() =>
      defineModule({
        id: 'module',
        version: '1.0.0',
        requires: [{ id: 'Bad!', version: '*' }]
      })
    ).toThrow(expect.objectContaining({ code: 'KVT_MANIFEST_REQUIREMENT_INVALID' }))
    expect(() =>
      defineModule({
        id: 'module',
        version: '1.0.0',
        requires: [{ id: 'dep', version: 'latest' }]
      })
    ).toThrow(expect.objectContaining({ code: 'KVT_MANIFEST_REQUIREMENT_INVALID' }))
    expect(() =>
      defineModule({
        id: 'module',
        version: '1.0.0',
        requires: [
          { id: 'dep', version: '*' },
          { id: 'dep', version: '^1.0.0' }
        ]
      })
    ).toThrow(expect.objectContaining({ code: 'KVT_MANIFEST_REQUIREMENT_DUPLICATE' }))
  })

  it('covers exact, wildcard, tilde and prerelease version comparisons', () => {
    expect(satisfiesVersion('1.2.3', '1.2.3')).toBe(true)
    expect(satisfiesVersion('garbage', '*')).toBe(true)
    expect(satisfiesVersion('1.2.3', '~1.2.0')).toBe(true)
    expect(satisfiesVersion('1.3.0', '~1.2.0')).toBe(false)
    expect(satisfiesVersion('1.2.0', '~1.2.1')).toBe(false)
    expect(satisfiesVersion('0.0.4', '^0.0.4')).toBe(true)
    expect(satisfiesVersion('0.0.5', '^0.0.4')).toBe(false)
    expect(satisfiesVersion('1.0.0-alpha.2', '^1.0.0-alpha.1')).toBe(true)
    expect(satisfiesVersion('1.0.0-alpha.1', '^1.0.0-alpha.2')).toBe(false)
    expect(satisfiesVersion('1.0.0-alpha', '^1.0.0-1')).toBe(true)
    expect(satisfiesVersion('1.0.0-1', '^1.0.0-alpha')).toBe(false)
    expect(satisfiesVersion('1.0.0', '^1.0.0')).toBe(true)
    expect(satisfiesVersion('1.0.0-alpha', '^1.0.0-alpha.1')).toBe(false)
    expect(satisfiesVersion('1.0.0-alpha.1', '^1.0.0-alpha')).toBe(true)
    expect(satisfiesVersion('1.0.0-alpha', '^1.0.0-beta')).toBe(false)
    expect(satisfiesVersion('1.0.0', '^1.0.0-alpha')).toBe(true)
    expect(satisfiesVersion('1.0.0-alpha', '^1.0.0')).toBe(false)
    expect(satisfiesVersion('garbage', '^1.0.0')).toBe(false)
    expect(satisfiesVersion('1.0.0-alpha', '>=1')).toBe(false)
  })

  it('freezes definitions and extracts optional/lazy dependency tokens', () => {
    const token = createToken<number>('number')
    const module = defineModule({
      id: 'frozen',
      version: '1.0.0',
      requires: [{ id: 'dep', version: '*' }]
    })
    const plugin = definePlugin({
      id: 'frozen-plugin',
      version: '1.0.0',
      modules: [module]
    })
    expect(Object.isFrozen(module)).toBe(true)
    expect(Object.isFrozen(module.requires[0])).toBe(true)
    expect(Object.isFrozen(plugin.modules)).toBe(true)
    expect(dependencyToken(optional(token))).toBe(token)
    expect(dependencyToken(lazy(token))).toBe(token)
    expect(dependencyToken(token)).toBe(token)
    expect(() => createToken(' bad')).toThrow(TypeError)
    expect(() => createMultiToken('')).toThrow(TypeError)
  })

  it('rejects includes, versions, requirements, missing providers and cycles', () => {
    const a = {
      id: 'a',
      version: '1.0.0',
      requires: [],
      providers: [],
      includes: [] as ModuleDefinition[]
    }
    const b = {
      id: 'b',
      version: '1.0.0',
      requires: [],
      providers: [],
      includes: [a]
    }
    a.includes.push(b)
    expect(() => new ProviderRegistry([a])).toThrow(
      expect.objectContaining({ code: 'KVT_MODULE_INCLUDE_CYCLE' })
    )

    const included = defineModule({ id: 'same', version: '1.0.0' })
    const differentVersion = defineModule({ id: 'same', version: '2.0.0' })
    expect(
      () =>
        new ProviderRegistry([
          defineModule({
            id: 'root',
            version: '1.0.0',
            includes: [included, differentVersion]
          })
        ])
    ).toThrow(expect.objectContaining({ code: 'KVT_MODULE_VERSION_CONFLICT' }))

    const requirement = defineModule({
      id: 'consumer',
      version: '1.0.0',
      requires: [{ id: 'missing', version: '^1.0.0' }]
    })
    expect(() => new ProviderRegistry([requirement])).toThrow(
      expect.objectContaining({ code: 'KVT_MODULE_REQUIREMENT_UNSATISFIED' })
    )

    const missing = createToken<string>('missing')
    const needsMissing = createToken<string>('needs-missing')
    expect(
      () =>
        new ProviderRegistry([
          defineModule({
            id: 'missing-provider',
            version: '1.0.0',
            providers: [
              provide(needsMissing)
                .inject(missing)
                .using((value) => value)
                .singleton()
            ]
          })
        ])
    ).toThrow(expect.objectContaining({ code: 'KVT_DI_PROVIDER_MISSING' }))

    const left = createToken<string>('left')
    const right = createToken<string>('right')
    expect(
      () =>
        new ProviderRegistry([
          defineModule({
            id: 'cycle',
            version: '1.0.0',
            providers: [
              provide(left)
                .inject(right)
                .using((value) => value)
                .singleton(),
              provide(right)
                .inject(left)
                .using((value) => value)
                .singleton()
            ]
          })
        ])
    ).toThrow(expect.objectContaining({ code: 'KVT_DI_CIRCULAR_DEPENDENCY' }))

    expect(
      () =>
        new ProviderRegistry([
          defineModule({
            id: 'lazy-missing',
            version: '1.0.0',
            providers: [
              provide(needsMissing)
                .inject(lazy(missing))
                .using(() => 'value')
                .singleton()
            ]
          })
        ])
    ).toThrow(expect.objectContaining({ code: 'KVT_DI_PROVIDER_MISSING' }))

    const shared = defineModule({ id: 'shared-include', version: '1.0.0' })
    expect(
      () =>
        new ProviderRegistry([
          defineModule({
            id: 'duplicate-include',
            version: '1.0.0',
            includes: [shared, shared]
          })
        ])
    ).not.toThrow()

    const base = defineModule({ id: 'visited-base', version: '1.0.0' })
    const firstConsumer = defineModule({
      id: 'visited-one',
      version: '1.0.0',
      requires: [{ id: 'visited-base', version: '*' }]
    })
    const secondConsumer = defineModule({
      id: 'visited-two',
      version: '1.0.0',
      requires: [{ id: 'visited-base', version: '*' }]
    })
    expect(() => new ProviderRegistry([base, firstConsumer, secondConsumer])).not.toThrow()
  })

  it('requires explicit parent overrides and accepts local replacement', () => {
    const token = createToken<string>('override')
    const parent = new ProviderRegistry([
      defineModule({
        id: 'parent',
        version: '1.0.0',
        providers: [provide(token).value('parent')]
      })
    ])
    expect(
      () =>
        new ProviderRegistry(
          [
            defineModule({
              id: 'child',
              version: '1.0.0',
              providers: [provide(token).value('child')]
            })
          ],
          parent
        )
    ).toThrow(expect.objectContaining({ code: 'KVT_DI_OVERRIDE_REQUIRED' }))
    const child = new ProviderRegistry(
      [
        defineModule({
          id: 'child',
          version: '1.0.0',
          providers: [
            provide(token).value('first').override(),
            provide(token).value('second').override()
          ]
        })
      ],
      parent
    )
    expect(child.lookup(token)?.providers).toHaveLength(1)

    expect(
      () => new ProviderRegistry([defineModule({ id: 'parent', version: '1.0.0' })], parent)
    ).toThrow(expect.objectContaining({ code: 'KVT_MODULE_VERSION_CONFLICT' }))

    const handlers = createMultiToken<string>('parent-handlers')
    const parentMulti = new ProviderRegistry([
      defineModule({
        id: 'parent-multi',
        version: '1.0.0',
        providers: [provide(handlers).value('parent')]
      })
    ])
    const childMulti = new ProviderRegistry(
      [
        defineModule({
          id: 'child-multi',
          version: '1.0.0',
          providers: [provide(handlers).value('child')]
        })
      ],
      parentMulti
    )
    expect(childMulti.lookupAll(handlers).flatMap((lookup) => lookup.providers)).toHaveLength(2)
  })

  it('preserves actionable registry error context and dependency paths', () => {
    const token = createToken<string>('context-token')
    const duplicate = capturedKvtError(
      () =>
        new ProviderRegistry([
          defineModule({
            id: 'duplicate-context',
            version: '1.0.0',
            providers: [provide(token).value('one'), provide(token).value('two')]
          })
        ])
    )
    expect(duplicate).toMatchObject({
      code: 'KVT_DI_PROVIDER_DUPLICATE',
      operation: 'registry-create',
      context: { token: '[redacted]', moduleId: 'duplicate-context' }
    })

    const parentModule = defineModule({
      id: 'parent-context',
      version: '1.0.0',
      providers: [provide(token).value('parent')]
    })
    const parent = new ProviderRegistry([parentModule])
    expect(parent.has(token)).toBe(true)
    const override = capturedKvtError(
      () =>
        new ProviderRegistry(
          [
            defineModule({
              id: 'child-context',
              version: '1.0.0',
              providers: [provide(token).value('child')]
            })
          ],
          parent
        )
    )
    expect(override.context).toEqual({
      token: '[redacted]',
      moduleId: 'child-context'
    })

    const missing = createToken<string>('missing-context')
    const consumer = createToken<string>('consumer-context')
    const missingError = capturedKvtError(
      () =>
        new ProviderRegistry([
          defineModule({
            id: 'missing-context-module',
            version: '1.0.0',
            providers: [
              provide(consumer)
                .inject(missing)
                .using((value) => value)
                .singleton()
            ]
          })
        ])
    )
    expect(missingError).toMatchObject({
      code: 'KVT_DI_PROVIDER_MISSING',
      path: [],
      context: { token: '[redacted]', requestedBy: 'consumer-context' }
    })

    const left = createToken<string>('left-context')
    const right = createToken<string>('right-context')
    const providerCycle = capturedKvtError(
      () =>
        new ProviderRegistry([
          defineModule({
            id: 'provider-cycle-context',
            version: '1.0.0',
            providers: [
              provide(left)
                .inject(right)
                .using((value) => value)
                .singleton(),
              provide(right)
                .inject(left)
                .using((value) => value)
                .singleton()
            ]
          })
        ])
    )
    expect(providerCycle).toMatchObject({
      code: 'KVT_DI_CIRCULAR_DEPENDENCY',
      path: ['left-context', 'right-context', 'left-context']
    })

    const includeCycle = {
      id: 'include-context',
      version: '1.0.0',
      requires: [],
      providers: [],
      includes: [] as ModuleDefinition[]
    }
    includeCycle.includes.push(includeCycle)
    expect(capturedKvtError(() => new ProviderRegistry([includeCycle])).context).toEqual({
      id: 'include-context'
    })

    const sameOne = defineModule({
      id: 'definition-context',
      version: '1.0.0'
    })
    const sameTwo = defineModule({
      id: 'definition-context',
      version: '1.0.0'
    })
    expect(capturedKvtError(() => new ProviderRegistry([sameOne, sameTwo])).context).toEqual({
      id: 'definition-context',
      version: '1.0.0'
    })
    const otherVersion = defineModule({
      id: 'definition-context',
      version: '2.0.0'
    })
    expect(capturedKvtError(() => new ProviderRegistry([sameOne, otherVersion])).context).toEqual({
      id: 'definition-context',
      existing: '1.0.0',
      received: '2.0.0'
    })

    const requirementError = capturedKvtError(
      () =>
        new ProviderRegistry([
          defineModule({
            id: 'requirement-context',
            version: '1.0.0',
            requires: [{ id: 'absent-context', version: '^2.0.0' }]
          })
        ])
    )
    expect(requirementError.context).toEqual({
      moduleId: 'requirement-context',
      dependencyId: 'absent-context',
      requiredVersion: '^2.0.0',
      installedVersion: null
    })

    const requirementLeft = defineModule({
      id: 'requirement-left',
      version: '1.0.0',
      requires: [{ id: 'requirement-right', version: '*' }]
    })
    const requirementRight = defineModule({
      id: 'requirement-right',
      version: '1.0.0',
      requires: [{ id: 'requirement-left', version: '*' }]
    })
    expect(
      capturedKvtError(() => new ProviderRegistry([requirementLeft, requirementRight])).path
    ).toEqual(['requirement-left', 'requirement-right', 'requirement-left'])
  })
})

describe('scope resolution and ownership', () => {
  it('resolves aliases, present optionals, lazy references and all provider lifetimes', async () => {
    const dependency = createToken<number>('dependency')
    const alias = createToken<number>('alias')
    const optionalValue = createToken<number>('optional-value')
    const lazyValue = createToken<() => number | Promise<number>>('lazy-value')
    const scoped = createToken<object>('scoped')
    const transient = createToken<object>('transient')
    const asyncTransient = createToken<object>('async-transient')
    const registry = new ProviderRegistry([
      defineModule({
        id: 'providers',
        version: '1.0.0',
        providers: [
          provide(dependency).value(7),
          provide(alias).toExisting(dependency),
          provide(optionalValue)
            .inject(optional(dependency))
            .using((value) => value ?? 0)
            .singleton(),
          provide(lazyValue)
            .inject(lazy(dependency))
            .using((load) => load)
            .singleton(),
          provide(scoped)
            .using(() => ({}))
            .scoped(),
          provide(transient)
            .using(() => ({}))
            .transient(),
          provide(asyncTransient)
            .usingAsync(async () => ({}))
            .transient()
        ]
      })
    ])
    const root = new KvtScope(undefined, { id: 'root', registry })
    const child = root.createChild({ id: 'child' })
    expect(child.resolve(alias)).toBe(7)
    expect(child.resolve(optionalValue)).toBe(7)
    expect(await child.resolve(lazyValue)()).toBe(7)
    expect(child.resolve(scoped)).toBe(child.resolve(scoped))
    expect(child.resolve(transient)).not.toBe(child.resolve(transient))
    expect(await child.resolveAsync(asyncTransient)).not.toBe(
      await child.resolveAsync(asyncTransient)
    )
    await root.shutdown(context())
  })

  it('handles missing/multi providers, async constraints, undeclared promises and concurrent caching', async () => {
    const missing = createToken<string>('direct-missing')
    const emptyMulti = createMultiToken<string>('empty-multi')
    const asyncToken = createToken<string>('async')
    const undeclared = createToken<Promise<string>>('undeclared')
    const registry = new ProviderRegistry([
      defineModule({
        id: 'async',
        version: '1.0.0',
        providers: [
          provide(asyncToken)
            .usingAsync(async () => 'ready')
            .singleton(),
          provide(undeclared)
            .using(() => Promise.resolve('bad'))
            .singleton()
        ]
      })
    ])
    const scope = new KvtScope(undefined, { registry })
    expect(() => scope.resolve(missing)).toThrow(
      expect.objectContaining({ code: 'KVT_DI_PROVIDER_MISSING' })
    )
    await expect(scope.resolveAsync(missing)).rejects.toMatchObject({
      code: 'KVT_DI_PROVIDER_MISSING'
    })
    expect(scope.resolve(emptyMulti)).toEqual([])
    expect(await scope.resolveAsync(emptyMulti)).toEqual([])
    expect(() => scope.resolve(asyncToken)).toThrow(
      expect.objectContaining({ code: 'KVT_DI_ASYNC_RESOLVE_REQUIRED' })
    )
    expect(() => scope.resolve(undeclared)).toThrow(
      expect.objectContaining({ code: 'KVT_DI_UNDECLARED_ASYNC_PROVIDER' })
    )
    const [first, second] = await Promise.all([
      scope.resolveAsync(asyncToken),
      scope.resolveAsync(asyncToken)
    ])
    expect(first).toBe('ready')
    expect(second).toBe(first)
    await scope.shutdown(context())
  })

  it('resolves populated multi/optional/alias dependencies asynchronously and tolerates scopes without registries', async () => {
    const handlers = createMultiToken<string>('async-handlers')
    const base = createToken<string>('async-base')
    const alias = createToken<string>('async-alias')
    const optionalValue = createToken<string | undefined>('async-optional')
    const missingOptionalValue = createToken<string | undefined>('async-missing-optional')
    const missing = createToken<string>('async-missing')
    const lazyValue = createToken<() => string | Promise<string>>('async-lazy')
    const registry = new ProviderRegistry([
      defineModule({
        id: 'async-dependencies',
        version: '1.0.0',
        providers: [
          provide(handlers).value('one'),
          provide(handlers).value('two'),
          provide(base).value('base'),
          provide(alias).toExisting(base),
          provide(optionalValue)
            .inject(optional(base))
            .usingAsync(async (value) => value)
            .scoped(),
          provide(missingOptionalValue)
            .inject(optional(missing))
            .usingAsync(async (value) => value)
            .scoped(),
          provide(lazyValue)
            .inject(lazy(base))
            .usingAsync(async (load) => load)
            .scoped()
        ]
      })
    ])
    const parent = new KvtScope(undefined, { id: 'no-registry' })
    const scope = parent.createChild({ id: 'registry-child', registry })
    expect(await scope.resolveAsync(handlers)).toEqual(['one', 'two'])
    expect(await scope.resolveAsync(alias)).toBe('base')
    expect(await scope.resolveAsync(optionalValue)).toBe('base')
    expect(await scope.resolveAsync(missingOptionalValue)).toBeUndefined()
    expect(await (await scope.resolveAsync(lazyValue))()).toBe('base')
    await parent.initializeEagerProviders()
    await parent.shutdown(context())
  })

  it('detects runtime circular resolution even for externally supplied registries', async () => {
    const token = createToken<string>('runtime-cycle')
    const provider = provide(token)
      .inject(token)
      .using((value) => value)
      .singleton()
      .toProviderDefinition()
    const lookupResult = {
      providers: [provider],
      registry: undefined as unknown
    }
    const fakeRegistry = {
      modules: [],
      lookup: () => lookupResult,
      lookupAll: () => [],
      eagerProviders: () => []
    }
    lookupResult.registry = fakeRegistry
    const scope = new KvtScope(undefined, { registry: fakeRegistry as never })
    expect(() => scope.resolve(token)).toThrow(
      expect.objectContaining({
        code: 'KVT_DI_CIRCULAR_DEPENDENCY',
        path: ['runtime-cycle', 'runtime-cycle']
      })
    )
    await expect(scope.resolveAsync(token)).rejects.toMatchObject({
      code: 'KVT_DI_CIRCULAR_DEPENDENCY',
      path: ['runtime-cycle', 'runtime-cycle']
    })
    await scope.shutdown(context())
  })

  it('deduplicates multi registries encountered through repeated scope ownership', async () => {
    const handlers = createMultiToken<string>('deduplicated-handlers')
    const registry = new ProviderRegistry([
      defineModule({
        id: 'deduplicated',
        version: '1.0.0',
        providers: [provide(handlers).value('one')]
      })
    ])
    const root = new KvtScope(undefined, { registry })
    const child = root.createChild({ registry })
    expect(child.resolve(handlers)).toEqual(['one'])
    await root.shutdown(context())
  })

  it('owns factory resources once, shuts children first and rejects use after shutdown', async () => {
    const calls: string[] = []
    const service = createToken<{ dispose(): void }>('service')
    const registry = new ProviderRegistry([
      defineModule({
        id: 'resources',
        version: '1.0.0',
        providers: [
          provide(service)
            .using(() => ({ dispose: () => calls.push('provider') }))
            .scoped()
        ]
      })
    ])
    const root = new KvtScope(undefined, { id: 'root', registry })
    const child = root.createChild({ id: 'child' })
    child.resolve(service)
    child.own({ dispose: () => calls.push('external') }, 'external')
    child.own(child.resolve(service), 'duplicate')
    const first = root.shutdown(context())
    const second = root.shutdown(context())
    expect(first).toBe(second)
    await first
    expect(calls).toEqual(['external', 'provider'])
    expect(child.state).toBe('stopped')
    for (const operation of [
      () => child.resolve(service),
      () => child.createChild(),
      () => child.own({})
    ])
      expect(operation).toThrow(expect.objectContaining({ code: 'KVT_SCOPE_NOT_ACTIVE' }))
  })

  it('deduplicates identical transient resources and emits complete scope lifecycle metadata', async () => {
    const events: Array<{
      subsystem: string
      operation: string
      phase: string
      context: unknown
    }> = []
    const diagnostics = new Diagnostics({
      emit: (event) => events.push(event)
    })
    const shutdown = vi.fn()
    const shared = { shutdown }
    const token = createToken<typeof shared>('shared-transient-resource')
    const registry = new ProviderRegistry([
      defineModule({
        id: 'scope-metadata',
        version: '1.0.0',
        providers: [
          provide(token)
            .using(() => shared)
            .transient()
        ]
      })
    ])
    const root = new KvtScope(undefined, { id: 'metadata-root', registry }, diagnostics)
    const child = root.createChild({ id: 'metadata-child' })
    expect(child.resolve(token)).toBe(shared)
    expect(child.resolve(token)).toBe(shared)
    expect(child.ownedResourceCount).toBe(1)
    expect(root.inspect()).toMatchObject({
      id: 'metadata-root',
      childCount: 1,
      modules: [{ id: 'scope-metadata', version: '1.0.0' }],
      children: [
        {
          id: 'metadata-child',
          modules: [],
          ownedResources: [{ label: 'shared-transient-resource' }]
        }
      ]
    })
    await child.shutdown(context('metadata-stop'))
    expect(shutdown).toHaveBeenCalledOnce()
    expect(root.childCount).toBe(0)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subsystem: 'scope',
          operation: 'create',
          phase: 'success',
          context: { scopeId: 'metadata-root', parentScopeId: null }
        }),
        expect.objectContaining({
          subsystem: 'scope',
          operation: 'create',
          phase: 'success',
          context: {
            scopeId: 'metadata-child',
            parentScopeId: 'metadata-root'
          }
        }),
        expect.objectContaining({
          subsystem: 'provider',
          operation: 'create',
          phase: 'success',
          context: {
            token: '[redacted]',
            lifetime: 'transient',
            scopeId: 'metadata-child'
          }
        }),
        expect.objectContaining({
          subsystem: 'provider',
          operation: 'shutdown',
          phase: 'success',
          context: { token: '[redacted]', scopeId: 'metadata-child' }
        }),
        expect.objectContaining({
          subsystem: 'scope',
          operation: 'shutdown',
          phase: 'success',
          context: { scopeId: 'metadata-child', errorCount: 0 }
        })
      ])
    )
    await root.shutdown(context())
  })

  it('aggregates child/resource shutdown failures and clears inspection metadata', async () => {
    const root = new KvtScope(undefined, { id: 'root' })
    const child = root.createChild({ id: 'child' })
    child.own({
      dispose: () => {
        throw new Error('resource')
      }
    })
    await expect(root.shutdown(context())).rejects.toBeInstanceOf(AggregateError)
    expect(root.inspect()).toMatchObject({
      state: 'stopped',
      childCount: 0,
      ownedResourceCount: 0
    })
  })
})

describe('runtime feature and plugin failure paths', () => {
  it('keeps reporters and diagnostic sinks observational and supports async resolution', async () => {
    const token = createToken<string>('async-runtime')
    const reports: unknown[] = []
    const runtime = await bootstrapKvt({
      modules: [
        defineModule({
          id: 'app',
          version: '1.0.0',
          providers: [
            provide(token)
              .usingAsync(async () => 'ready')
              .singleton()
          ]
        })
      ],
      diagnostics: {
        emit: () => {
          throw new Error('sink')
        }
      },
      errorReporter: {
        report: (report) => {
          reports.push(report)
          throw new Error('reporter')
        }
      }
    })
    await expect(runtime.resolveAsync(token)).resolves.toBe('ready')
    expect(() =>
      runtime.reportError(new Error('observed'), 'runtime', 'test', {
        data: 'private'
      })
    ).not.toThrow()
    expect(reports).toEqual([expect.objectContaining({ context: { data: '[redacted]' } })])
    expect(() => runtime.emitDiagnostic('runtime', 'manual', 'success')).not.toThrow()
    await runtime.shutdown({ reason: 'test' })
  })

  it('rejects duplicate, circular and incompatible plugins before startup', async () => {
    const duplicate = definePlugin({ id: 'duplicate', version: '1.0.0' })
    await expect(bootstrapKvt({ plugins: [duplicate, duplicate] })).rejects.toMatchObject({
      code: 'KVT_PLUGIN_DUPLICATE'
    })
    const left = definePlugin({
      id: 'left-plugin',
      version: '1.0.0',
      requires: [{ id: 'right-plugin', version: '*' }]
    })
    const right = definePlugin({
      id: 'right-plugin',
      version: '1.0.0',
      requires: [{ id: 'left-plugin', version: '*' }]
    })
    await expect(bootstrapKvt({ plugins: [left, right] })).rejects.toMatchObject({
      code: 'KVT_PLUGIN_CIRCULAR_DEPENDENCY'
    })
    await expect(
      bootstrapKvt({
        plugins: [
          definePlugin({
            id: 'consumer-plugin',
            version: '1.0.0',
            requires: [{ id: 'missing-plugin', version: '^1.0.0' }]
          })
        ]
      })
    ).rejects.toMatchObject({ code: 'KVT_PLUGIN_REQUIREMENT_UNSATISFIED' })
    const base = definePlugin({ id: 'base-plugin', version: '2.0.0' })
    const consumer = definePlugin({
      id: 'consumer-plugin',
      version: '1.0.0',
      requires: [{ id: 'base-plugin', version: '^1.0.0' }]
    })
    await expect(bootstrapKvt({ plugins: [base, consumer] })).rejects.toMatchObject({
      code: 'KVT_PLUGIN_REQUIREMENT_UNSATISFIED'
    })
  })

  it('loads plugin modules, exposes plugin diagnostics and aggregates shutdown errors', async () => {
    const token = createToken<string>('plugin-value')
    const reports: unknown[] = []
    const events: unknown[] = []
    const plugin = definePlugin({
      id: 'module-plugin',
      version: '1.0.0',
      modules: [
        defineModule({
          id: 'plugin-module',
          version: '1.0.0',
          providers: [provide(token).value('value')]
        })
      ],
      start: ({ emitDiagnostic }) =>
        emitDiagnostic({
          subsystem: 'plugin',
          operation: 'custom',
          phase: 'success',
          context: { ok: true }
        }),
      shutdown: () => {
        throw new Error('shutdown')
      }
    })
    const runtime = await bootstrapKvt({
      plugins: [plugin],
      diagnostics: { emit: (event) => events.push(event) },
      errorReporter: { report: (report) => reports.push(report) }
    })
    expect(runtime.resolve(token)).toBe('value')
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ operation: 'custom' })])
    )
    await expect(runtime.shutdown({ reason: 'test' })).rejects.toBeInstanceOf(AggregateError)
    expect(runtime.state).toBe('failed')
    expect(reports).toEqual([
      expect.objectContaining({ subsystem: 'plugin', operation: 'shutdown' })
    ])
  })

  it('retries feature loading and validates identity/version/loader conflicts', async () => {
    const runtime = await bootstrapKvt()
    let attempts = 0
    const load = vi.fn(async () => {
      attempts++
      if (attempts === 1) throw new Error('temporary')
      return defineModule({ id: 'retry-feature', version: '1.0.0' })
    })
    const handle = await runtime.loadFeature({
      id: 'retry-feature',
      version: '1.0.0',
      load,
      retry: { attempts: 2, delayMs: 1 }
    })
    const second = await runtime.loadFeature({
      id: 'retry-feature',
      version: '1.0.0',
      load
    })
    expect(runtime.inspect().features[0]?.references).toBe(2)
    await expect(
      runtime.loadFeature({
        id: 'retry-feature',
        version: '2.0.0',
        load: async () => defineModule({ id: 'retry-feature', version: '2.0.0' })
      })
    ).rejects.toMatchObject({ code: 'KVT_FEATURE_VERSION_CONFLICT' })
    await handle.release()
    await handle.release()
    expect(handle.released).toBe(true)
    await second.release()

    await expect(
      runtime.loadFeature({
        id: 'same-loaded',
        version: '1.0.0',
        load: async () => defineModule({ id: 'same-loaded', version: '1.0.0' })
      })
    ).resolves.toBeDefined()
    const stableLoad = async () => defineModule({ id: 'stable-loaded', version: '1.0.0' })
    const stable = await runtime.loadFeature({
      id: 'stable-loaded',
      version: '1.0.0',
      load: stableLoad
    })
    await expect(
      runtime.loadFeature({
        id: 'stable-loaded',
        version: '1.0.0',
        load: async () => defineModule({ id: 'stable-loaded', version: '1.0.0' })
      })
    ).rejects.toMatchObject({ code: 'KVT_FEATURE_LOADER_CONFLICT' })
    await stable.release()

    await expect(
      runtime.loadFeature({
        id: 'expected',
        version: '1.0.0',
        load: async () => defineModule({ id: 'received', version: '1.0.0' })
      })
    ).rejects.toMatchObject({ code: 'KVT_FEATURE_IDENTITY_MISMATCH' })
    const aborted = new AbortController()
    aborted.abort('pre-aborted')
    await expect(
      runtime.loadFeature(
        {
          id: 'never',
          version: '1.0.0',
          load: async () => defineModule({ id: 'never', version: '1.0.0' })
        },
        aborted.signal
      )
    ).rejects.toBe('pre-aborted')
    await runtime.shutdown({ reason: 'test' })
  })

  it('retries immediately without a delay', async () => {
    const runtime = await bootstrapKvt()
    let attempts = 0
    const handle = await runtime.loadFeature({
      id: 'immediate-retry',
      version: '1.0.0',
      retry: { attempts: 2 },
      load: async () => {
        if (++attempts === 1) throw new Error('temporary')
        return defineModule({ id: 'immediate-retry', version: '1.0.0' })
      }
    })
    expect(attempts).toBe(2)
    await handle.release()
    await runtime.shutdown({ reason: 'test' })
  })

  it('observes an invalidated signal after an ignoring loader resolves and scans unrelated pending entries', async () => {
    const runtime = await bootstrapKvt()
    let finishFirst!: () => void
    let finishSecond!: () => void
    const firstModule = defineModule({ id: 'first-pending', version: '1.0.0' })
    const secondModule = defineModule({
      id: 'second-pending',
      version: '1.0.0'
    })
    const first = runtime.loadFeature({
      id: 'first-pending',
      version: '1.0.0',
      load: () =>
        new Promise((resolve) => {
          finishFirst = () => resolve(firstModule)
        })
    })
    const controller = new AbortController()
    const second = runtime.loadFeature(
      {
        id: 'second-pending',
        version: '1.0.0',
        load: () =>
          new Promise((resolve) => {
            finishSecond = () => resolve(secondModule)
          })
      },
      controller.signal
    )
    controller.abort('cancel-second')
    await expect(second).rejects.toBe('cancel-second')
    finishSecond()
    finishFirst()
    const firstHandle = await first
    await firstHandle.release()
    await runtime.shutdown({ reason: 'test' })
  })

  it('handles concurrent local and shutdown-context feature unload requests', async () => {
    const runtime = await bootstrapKvt()
    let releaseCleanup!: () => void
    const resource = createToken<{ shutdown(): Promise<void> }>('slow-unload')
    const load = async () =>
      defineModule({
        id: 'slow-unload-feature',
        version: '1.0.0',
        providers: [
          provide(resource)
            .using(() => ({
              shutdown: () =>
                new Promise<void>((resolve) => {
                  releaseCleanup = resolve
                })
            }))
            .singleton()
            .eager()
        ]
      })
    const handle = await runtime.loadFeature({
      id: 'slow-unload-feature',
      version: '1.0.0',
      load
    })
    const releasing = handle.release()
    await vi.waitFor(() => expect(releaseCleanup).toBeTypeOf('function'))
    const invalidating = runtime.invalidateFeature('slow-unload-feature')
    const stopping = runtime.shutdown({ reason: 'test' })
    releaseCleanup()
    await Promise.all([releasing, invalidating, stopping])
  })

  it('aggregates bootstrap failure with rollback cleanup failure', async () => {
    const resource = createToken<{ dispose(): void }>('rollback-failure-resource')
    const failure = createToken<never>('rollback-failure')
    await expect(
      bootstrapKvt({
        modules: [
          defineModule({
            id: 'rollback-aggregate',
            version: '1.0.0',
            providers: [
              provide(resource)
                .using(() => ({
                  dispose: () => {
                    throw new Error('cleanup')
                  }
                }))
                .singleton()
                .eager(),
              provide(failure)
                .usingAsync(async () => {
                  throw new Error('bootstrap')
                })
                .singleton()
                .eager()
            ]
          })
        ]
      })
    ).rejects.toBeInstanceOf(AggregateError)
  })

  it('inspects and loads features on a manually constructed runtime without a root registry', async () => {
    const runtime = new KvtRuntime(undefined as never, [], new Diagnostics())
    expect(runtime.inspect().modules).toEqual([])
    await runtime.start()
    await expect(
      runtime.loadFeature({
        id: 'no-root-registry',
        version: '1.0.0',
        load: async () => defineModule({ id: 'no-root-registry', version: '1.0.0' })
      })
    ).rejects.toThrow('Root registry is unavailable')
    await runtime.shutdown({ reason: 'test' })
  })

  it('rejects pending version conflicts and cleans eager feature startup failures', async () => {
    const runtime = await bootstrapKvt()
    let finish!: () => void
    const pendingModule = defineModule({
      id: 'pending-feature',
      version: '1.0.0'
    })
    const pending = runtime.loadFeature({
      id: 'pending-feature',
      version: '1.0.0',
      load: () =>
        new Promise<typeof pendingModule>((resolve) => {
          finish = () => resolve(pendingModule)
        })
    })
    await expect(
      runtime.loadFeature({
        id: 'pending-feature',
        version: '2.0.0',
        load: async () => defineModule({ id: 'pending-feature', version: '2.0.0' })
      })
    ).rejects.toMatchObject({ code: 'KVT_FEATURE_VERSION_CONFLICT' })
    finish()
    const handle = await pending
    await handle.release()

    const cleanup = vi.fn()
    const resource = createToken<{ dispose(): void }>('feature-resource')
    const failure = createToken<never>('feature-failure')
    await expect(
      runtime.loadFeature({
        id: 'failing-feature',
        version: '1.0.0',
        load: async () =>
          defineModule({
            id: 'failing-feature',
            version: '1.0.0',
            providers: [
              provide(resource)
                .using(() => ({ dispose: cleanup }))
                .singleton()
                .eager(),
              provide(failure)
                .usingAsync(async () => {
                  throw new Error('eager')
                })
                .singleton()
                .eager()
            ]
          })
      })
    ).rejects.toThrow('eager')
    expect(cleanup).toHaveBeenCalledOnce()
    await runtime.invalidateFeature('not-loaded')
    await runtime.shutdown({ reason: 'test' })
  })

  it('cancels a pending feature during runtime shutdown', async () => {
    const runtime = await bootstrapKvt()
    let observedAbort = false
    const loading = runtime.loadFeature({
      id: 'shutdown-feature',
      version: '1.0.0',
      load: ({ signal }) =>
        new Promise<ModuleDefinition>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              observedAbort = true
              reject(signal.reason)
            },
            { once: true }
          )
        )
    })
    const shutdown = runtime.shutdown({ reason: 'test' })
    await expect(loading).rejects.toMatchObject({
      code: 'KVT_FEATURE_LOAD_CANCELLED'
    })
    await shutdown
    expect(observedAbort).toBe(true)
  })

  it('forbids feature invalidation in production', async () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const runtime = await bootstrapKvt()
    try {
      await expect(runtime.invalidateFeature('feature')).rejects.toMatchObject({
        code: 'KVT_FEATURE_INVALIDATE_PRODUCTION'
      })
    } finally {
      process.env.NODE_ENV = original
      await runtime.shutdown({ reason: 'test' })
    }
  })

  it('prevents starting a runtime twice and resolves stopped shutdown directly', async () => {
    const registry = new ProviderRegistry([])
    const runtime = new KvtRuntime(registry, [], new Diagnostics())
    await runtime.start()
    await expect(runtime.start()).rejects.toMatchObject({
      code: 'KVT_RUNTIME_INVALID_STATE'
    })
    await runtime.shutdown({ reason: 'test' })
    await expect(runtime.shutdown({ reason: 'again' })).resolves.toBeUndefined()
  })
})

describe('ViewModel ownership and failure semantics', () => {
  it('runs input and no-input use cases with the ViewModel scope context', async () => {
    const signals: AbortSignal[] = []

    class DoubleUseCase implements UseCase<number, number> {
      execute(input: number, useCaseContext: UseCaseContext): number {
        signals.push(useCaseContext.signal)
        return input * 2
      }
    }

    class RefreshUseCase implements NoInputUseCase<string> {
      execute(useCaseContext: UseCaseContext): string {
        signals.push(useCaseContext.signal)
        return 'refreshed'
      }
    }

    class RunnerViewModel extends ViewModel {
      runDouble(input: number) {
        return this.viewModelScope.run(new DoubleUseCase(), input)
      }

      runRefresh() {
        return this.viewModelScope.run(new RefreshUseCase())
      }
    }

    const viewModel = new RunnerViewModel()
    await viewModel.start(new AbortController().signal)
    await expect(viewModel.runDouble(3)).resolves.toBe(6)
    await expect(viewModel.runRefresh()).resolves.toBe('refreshed')
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal === signals[0] && !signal.aborted)).toBe(true)
    await viewModel.shutdown(context())
    expect(signals[0]?.aborted).toBe(true)
  })

  it('suppresses a use-case result completed after the ViewModel stops', async () => {
    class PendingUseCase implements NoInputUseCase<string> {
      execute(useCaseContext: UseCaseContext): Promise<string> {
        return new Promise((resolve) => {
          useCaseContext.signal.addEventListener('abort', () => resolve('late'), { once: true })
        })
      }
    }

    class RunnerViewModel extends ViewModel {
      runPending() {
        return this.viewModelScope.run(new PendingUseCase())
      }
    }

    const viewModel = new RunnerViewModel()
    await viewModel.start(new AbortController().signal)
    const pending = viewModel.runPending()
    await Promise.resolve()
    await viewModel.shutdown(context())
    await expect(pending).resolves.toBeUndefined()
  })

  it('cancels viewModelScope collections, launches and task generations on shutdown', async () => {
    const source = new MutableStateFlow(0)
    let launchSignal: AbortSignal | undefined
    class ScopedViewModel extends ViewModel {
      readonly values: number[] = []
      protected override onStart(): void {
        this.viewModelScope.collect(source, (value) => {
          this.values.push(value)
        })
        void this.viewModelScope.launch((signal) => {
          launchSignal = signal
          return new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true })
          )
        })
      }
      createTask() {
        return this.viewModelScope.task<number, number>('latest', async (value, signal) => {
          await Promise.resolve()
          signal.throwIfAborted()
          return value * 2
        })
      }
    }
    const viewModel = new ScopedViewModel()
    await viewModel.start(new AbortController().signal)
    expect(source.subscriberCount).toBe(1)
    source.set(1)
    expect(viewModel.values).toEqual([0, 1])
    const task = viewModel.createTask()
    await expect(task.run(2)).resolves.toBe(4)
    await viewModel.shutdown(context())
    expect(launchSignal?.aborted).toBe(true)
    expect(source.subscriberCount).toBe(0)
  })

  it('validates options, running idempotency and pre-aborted start', async () => {
    class PlainViewModel extends ViewModel {}
    const viewModel = new PlainViewModel()
    expect(() => viewModel.start(new AbortController().signal, { attempts: 0 })).toThrow(RangeError)
    expect(() => viewModel.start(new AbortController().signal, { delayMs: -1 })).toThrow(RangeError)
    const aborted = new AbortController()
    aborted.abort('pre-aborted')
    await expect(viewModel.start(aborted.signal)).rejects.toBe('pre-aborted')
    await viewModel.start(new AbortController().signal)
    await expect(viewModel.start(new AbortController().signal)).resolves.toBeUndefined()
    await viewModel.shutdown(context())
  })

  it('aggregates start rollback, stop and owned cleanup failures', async () => {
    class BrokenStart extends ViewModel {
      protected override onStart() {
        this.own({
          dispose: () => {
            throw new Error('cleanup')
          }
        })
        throw new Error('start')
      }
    }
    await expect(new BrokenStart().start(new AbortController().signal)).rejects.toBeInstanceOf(
      AggregateError
    )

    class BrokenStop extends ViewModel {
      add() {
        this.own({
          dispose: () => {
            throw new Error('resource')
          }
        })
      }
      protected override onStop() {
        throw new Error('stop')
      }
    }
    const stopped = new BrokenStop()
    stopped.add()
    await stopped.start(new AbortController().signal)
    await expect(stopped.shutdown(context())).rejects.toBeInstanceOf(AggregateError)
    expect(() => stopped.add()).toThrow(
      expect.objectContaining({ code: 'KVT_VIEW_MODEL_NOT_ACTIVE' })
    )
  })

  it('shares owner entries, starts only on commit and releases leases idempotently', async () => {
    const created = vi.fn()
    class SharedViewModel extends ViewModel {
      constructor() {
        super()
        created()
      }
    }
    const registry = new ProviderRegistry([
      defineModule({
        id: 'owner',
        version: '1.0.0',
        providers: [bind(SharedViewModel).viewModel()]
      })
    ])
    const scope = new KvtScope(undefined, { id: 'owner-root', registry })
    const owner = new ViewModelOwner('owner', scope)
    const first = owner.acquire(SharedViewModel)
    const second = owner.acquire(SharedViewModel)
    expect(first.value).toBe(second.value)
    expect(created).toHaveBeenCalledOnce()
    expect(owner.peek(SharedViewModel)).toBe(first.value)
    expect(first.committed).toBe(false)
    await first.commit()
    expect(second.committed).toBe(true)
    first.dispose()
    first.dispose()
    second.dispose()
    expect(owner.inspect().entries[0]?.leases).toBe(0)
    const stopped = owner.shutdown(context())
    expect(owner.shutdown(context())).toBe(stopped)
    await stopped
    expect(owner.inspect()).toMatchObject({ stopped: true, entries: [] })
    expect(() => owner.acquire(SharedViewModel)).toThrow(
      expect.objectContaining({ code: 'KVT_VIEW_MODEL_OWNER_STOPPED' })
    )
    await scope.shutdown(context())
  })

  it('cleans failed owner factories and forbids commit after lease release', async () => {
    class ThrowingViewModel extends ViewModel {
      constructor() {
        super()
        throw new Error('factory')
      }
    }
    class PlainViewModel extends ViewModel {}
    const registry = new ProviderRegistry([
      defineModule({
        id: 'owner-failure',
        version: '1.0.0',
        providers: [bind(ThrowingViewModel).viewModel(), bind(PlainViewModel).viewModel()]
      })
    ])
    const scope = new KvtScope(undefined, { id: 'owner-root', registry })
    const owner = new ViewModelOwner('owner', scope)
    expect(() => owner.acquire(ThrowingViewModel)).toThrow('factory')
    expect(scope.childCount).toBe(0)
    const lease = owner.acquire(PlainViewModel)
    lease.dispose()
    await expect(lease.commit()).rejects.toMatchObject({
      code: 'KVT_VIEW_MODEL_LEASE_RELEASED'
    })
    await owner.shutdown(context())
    await scope.shutdown(context())
  })

  it('aggregates ViewModel and child scope failures during owner shutdown', async () => {
    class Broken extends ViewModel {
      add() {
        this.own({
          dispose: () => {
            throw new Error('vm-resource')
          }
        })
      }
    }
    const registry = new ProviderRegistry([
      defineModule({
        id: 'owner-broken',
        version: '1.0.0',
        providers: [bind(Broken).viewModel()]
      })
    ])
    const scope = new KvtScope(undefined, { id: 'owner-root', registry })
    const owner = new ViewModelOwner('owner', scope)
    const lease = owner.acquire(Broken)
    lease.value.add()
    await lease.commit()
    lease.value.lifecycleState.subscribe(() => undefined).cancel()
    lease.dispose()
    await expect(owner.shutdown(context())).rejects.toBeInstanceOf(AggregateError)
    await scope.shutdown(context()).catch(() => undefined)
  })
})
