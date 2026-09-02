import { MutableStateFlow, type StateFlow } from '@kvt/flow'
import {
  Diagnostics,
  KVT_DIAGNOSTICS_PROTOCOL_VERSION,
  redactDiagnosticContext,
  type DiagnosticSink,
  type DiagnosticSubsystem,
  type DiagnosticEvent,
  type ErrorReporter
} from './diagnostics.js'
import { KvtError } from './errors.js'
import { raceWithAbort, type ShutdownContext } from './lifecycle.js'
import type { ModuleDefinition } from './di/module.js'
import { satisfiesVersion } from './di/module.js'
import { ProviderRegistry } from './di/registry.js'
import { KvtScope, type ScopeInspection } from './di/scope.js'
import type { MultiToken, ServiceIdentifier, SingleIdentifier } from './di/token.js'
import type { PluginDefinition } from './plugin.js'
import { ViewModelOwner, type ViewModelOwnerInspection } from './view-model.js'

export type RuntimeState = 'created' | 'starting' | 'running' | 'shutting-down' | 'stopped' | 'failed'

export interface BootstrapKvtOptions {
  readonly modules?: readonly ModuleDefinition[]
  readonly plugins?: readonly PluginDefinition[]
  readonly diagnostics?: DiagnosticSink
  readonly errorReporter?: ErrorReporter
}

export interface RuntimeShutdownOptions {
  readonly reason: string
  readonly timeoutMs?: number
}

export interface FeatureLoadContext {
  readonly signal: AbortSignal
}

export interface FeatureDefinition {
  readonly id: string
  readonly version: string
  readonly load: (context: FeatureLoadContext) => ModuleDefinition | Promise<ModuleDefinition>
  readonly retry?: { readonly attempts: number; readonly delayMs?: number }
}

export interface FeatureHandle {
  readonly id: string
  readonly version: string
  readonly scope: KvtScope
  readonly released: boolean
  release(): Promise<void>
}

interface LoadedFeature {
  readonly id: string
  readonly version: string
  readonly key: string
  readonly scope: KvtScope
  readonly loader: FeatureDefinition['load']
  references: number
  unloading?: Promise<void>
}

interface PendingFeatureLoad {
  readonly id: string
  readonly version: string
  readonly loader: FeatureDefinition['load']
  readonly controller: AbortController
  promise: Promise<LoadedFeature>
  waiters: number
  settled: boolean
}

export class KvtRuntime {
  readonly #mutableState = new MutableStateFlow<RuntimeState>('created')
  readonly #diagnostics: Diagnostics
  readonly #errorReporter: ErrorReporter | undefined
  readonly #plugins: readonly PluginDefinition[]
  readonly #startedPlugins: PluginDefinition[] = []
  readonly #featureLoads = new Map<string, PendingFeatureLoad>()
  readonly #features = new Map<string, LoadedFeature>()
  readonly rootScope: KvtScope
  readonly rootViewModelOwner: ViewModelOwner
  #shutdownPromise: Promise<void> | undefined

  constructor(registry: ProviderRegistry, plugins: readonly PluginDefinition[], diagnostics: Diagnostics, errorReporter?: ErrorReporter) {
    this.#diagnostics = diagnostics
    this.#errorReporter = errorReporter
    this.#plugins = plugins
    this.rootScope = new KvtScope(undefined, { id: 'root', registry }, diagnostics)
    this.rootViewModelOwner = new ViewModelOwner('root', this.rootScope, diagnostics)
  }

  get state(): RuntimeState {
    return this.#mutableState.value
  }

  get stateFlow(): StateFlow<RuntimeState> {
    return this.#mutableState.asStateFlow()
  }

  inspect(): RuntimeInspection {
    return Object.freeze({
      state: this.state,
      modules: Object.freeze((this.rootScope.registry?.modules ?? []).map((module) => Object.freeze({ id: module.id, version: module.version }))),
      plugins: Object.freeze(this.#plugins.map((plugin) => Object.freeze({
        id: plugin.id,
        version: plugin.version,
        started: this.#startedPlugins.includes(plugin)
      }))),
      features: Object.freeze([...this.#features.values()].map((feature) => Object.freeze({
        id: feature.id,
        version: feature.version,
        references: feature.references,
        scopeState: feature.scope.state
      }))),
      rootScope: this.rootScope.inspect(),
      rootViewModelOwner: this.rootViewModelOwner.inspect()
    })
  }

  /** Reports an observational error without allowing the reporter to alter runtime behavior. */
  reportError(
    error: unknown,
    subsystem: DiagnosticSubsystem,
    operation: string,
    context: Readonly<Record<string, unknown>> = {}
  ): void {
    try {
      this.#errorReporter?.report({
        error,
        subsystem,
        operation,
        context: redactDiagnosticContext(context)
      })
    } catch {
      // Error reporters are observational and must never break framework cleanup.
    }
  }

  /** Emits redacted framework metadata without exposing the underlying diagnostics sink. */
  emitDiagnostic(
    subsystem: DiagnosticSubsystem,
    operation: string,
    phase: DiagnosticEvent['phase'],
    context: Readonly<Record<string, unknown>> = {}
  ): void {
    this.#diagnostics.emit(subsystem, operation, phase, context)
  }

  resolve<T>(token: SingleIdentifier<T>): T
  resolve<T>(token: MultiToken<T>): readonly T[]
  resolve<T>(token: ServiceIdentifier<T>): T | readonly T[] {
    this.#assertRunning('resolve')
    return this.rootScope.resolve(token as SingleIdentifier<T>)
  }

  resolveAsync<T>(token: SingleIdentifier<T>): Promise<T>
  resolveAsync<T>(token: MultiToken<T>): Promise<readonly T[]>
  resolveAsync<T>(token: ServiceIdentifier<T>): Promise<T | readonly T[]> {
    this.#assertRunning('resolve-async')
    return this.rootScope.resolveAsync(token as SingleIdentifier<T>)
  }

  async start(): Promise<void> {
    if (this.state !== 'created') throw invalidState(this.state, 'start')
    this.#transition('starting')
    await this.rootScope.initializeEagerProviders()
    for (const plugin of this.#plugins) {
      this.#diagnostics.emit('plugin', 'start', 'start', { pluginId: plugin.id, version: plugin.version })
      this.#startedPlugins.push(plugin)
      await plugin.start?.({
        scope: this.rootScope,
        emitDiagnostic: (event) => this.#diagnostics.emit(event.subsystem, event.operation, event.phase, event.context, event.trace)
      })
      this.#diagnostics.emit('plugin', 'start', 'success', { pluginId: plugin.id, version: plugin.version })
    }
    this.#transition('running')
  }

  async loadFeature(definition: FeatureDefinition, signal?: AbortSignal): Promise<FeatureHandle> {
    this.#assertRunning('feature-load')
    if (signal?.aborted) throw signal.reason
    const key = `${definition.id}@${definition.version}`
    const existing = this.#features.get(key)
    if (existing) {
      if (existing.loader !== definition.load) throw conflictingFeatureLoader(key)
      return this.#leaseFeature(existing)
    }
    const conflicting = [...this.#features.values()].find((feature) => feature.id === definition.id && feature.version !== definition.version)
    if (conflicting) throw new KvtError(`Feature ${definition.id} is already loaded at ${conflicting.version}`, {
      code: 'KVT_FEATURE_VERSION_CONFLICT', subsystem: 'module', operation: 'feature-load',
      context: { id: definition.id, loadedVersion: conflicting.version, requestedVersion: definition.version }
    })
    const pendingVersion = [...this.#featureLoads.values()].find((feature) => feature.id === definition.id && feature.version !== definition.version)
    if (pendingVersion) throw new KvtError(`Feature ${definition.id} is already loading at ${pendingVersion.version}`, {
      code: 'KVT_FEATURE_VERSION_CONFLICT', subsystem: 'module', operation: 'feature-load',
      context: { id: definition.id, loadedVersion: pendingVersion.version, requestedVersion: definition.version }
    })
    let pending = this.#featureLoads.get(key)
    if (!pending) {
      const controller = new AbortController()
      pending = {
        id: definition.id,
        version: definition.version,
        loader: definition.load,
        controller,
        promise: Promise.resolve(undefined as never),
        waiters: 0,
        settled: false
      }
      const current = pending
      pending.promise = this.#loadFeature(definition, controller.signal).finally(() => {
        current.settled = true
        if (this.#featureLoads.get(key) === current) this.#featureLoads.delete(key)
      })
      this.#featureLoads.set(key, pending)
      void pending.promise.catch(() => undefined)
    } else if (pending.loader !== definition.load) {
      throw conflictingFeatureLoader(key)
    }
    return this.#leaseFeature(await this.#awaitFeature(pending, signal))
  }

  async invalidateFeature(id: string): Promise<void> {
    this.#assertRunning('feature-invalidate')
    const nodeEnvironment = (globalThis as { readonly process?: { readonly env?: { readonly NODE_ENV?: string } } }).process?.env?.NODE_ENV
    if (nodeEnvironment === 'production') {
      throw new KvtError('Feature invalidation is development-only', {
        code: 'KVT_FEATURE_INVALIDATE_PRODUCTION', subsystem: 'module', operation: 'feature-invalidate'
      })
    }
    const pending = [...this.#featureLoads.values()].filter((candidate) => candidate.id === id)
    for (const candidate of pending) candidate.controller.abort(new KvtError('Feature load invalidated by development runtime', {
      code: 'KVT_FEATURE_LOAD_CANCELLED', subsystem: 'module', operation: 'feature-invalidate', context: { moduleId: id }
    }))
    await Promise.allSettled(pending.map((candidate) => candidate.promise))
    const feature = [...this.#features.values()].find((candidate) => candidate.id === id)
    if (!feature) return
    feature.references = 0
    await this.#unloadFeature(feature, 'hmr-invalidate')
  }

  async reloadFeature(definition: FeatureDefinition, signal?: AbortSignal): Promise<FeatureHandle> {
    await this.invalidateFeature(definition.id)
    return this.loadFeature(definition, signal)
  }

  shutdown(options: RuntimeShutdownOptions): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    const timeoutMs = options.timeoutMs ?? 10_000
    if (!(timeoutMs > 0)) return Promise.reject(new RangeError('timeoutMs must be greater than zero'))
    this.#shutdownPromise = this.#shutdown(options)
    return this.#shutdownPromise
  }

  async rollback(cause: unknown): Promise<never> {
    let shutdownFailure: unknown
    try {
      await this.shutdown({ reason: 'bootstrap-failed', timeoutMs: 10_000 })
    } catch (error) {
      shutdownFailure = error
    }
    this.#transition('failed')
    throw shutdownFailure === undefined
      ? cause
      : new AggregateError([cause, shutdownFailure], 'KVT bootstrap and rollback failed')
  }

  #transition(state: RuntimeState): void {
    this.#mutableState.set(state)
    this.#diagnostics.emit('runtime', 'state', 'state', { state })
  }

  async #loadFeature(definition: FeatureDefinition, signal: AbortSignal): Promise<LoadedFeature> {
    const attempts = Math.max(1, definition.retry?.attempts ?? 1)
    try {
      let failure: unknown
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const module = await definition.load({ signal })
          if (signal.aborted) throw signal.reason
          if (module.id !== definition.id || module.version !== definition.version) {
            throw new KvtError('Feature loader returned a different module identity', {
              code: 'KVT_FEATURE_IDENTITY_MISMATCH', subsystem: 'module', operation: 'feature-load',
              context: { expected: `${definition.id}@${definition.version}`, received: `${module.id}@${module.version}` }
            })
          }
          const rootRegistry = this.rootScope.registry
          if (!rootRegistry) throw new Error('Root registry is unavailable')
          const registry = new ProviderRegistry([module], rootRegistry)
          const scope = this.rootScope.createChild({ id: `feature:${definition.id}`, registry })
          try {
            await scope.initializeEagerProviders()
          } catch (error) {
            const cleanup = new AbortController()
            await scope.shutdown({ signal: cleanup.signal, reason: 'feature-start-failed', deadline: undefined })
            throw error
          }
          const loaded: LoadedFeature = { id: definition.id, version: definition.version,
            key: `${definition.id}@${definition.version}`, scope, loader: definition.load, references: 0 }
          this.#features.set(loaded.key, loaded)
          this.#diagnostics.emit('module', 'feature-load', 'success', { moduleId: loaded.id, version: loaded.version })
          return loaded
        } catch (error) {
          failure = error
          if (signal.aborted || attempt === attempts) throw error
          if ((definition.retry?.delayMs ?? 0) > 0) {
            await raceWithAbort(new Promise((resolve) => setTimeout(resolve, definition.retry?.delayMs)), signal)
          }
        }
      }
      throw failure
    } catch (error) {
      this.#diagnostics.emit('module', 'feature-load', 'failure', {
        moduleId: definition.id, version: definition.version, error
      })
      throw error
    }
  }

  async #awaitFeature(pending: PendingFeatureLoad, signal?: AbortSignal): Promise<LoadedFeature> {
    pending.waiters++
    try {
      return await (signal ? raceWithAbort(pending.promise, signal) : pending.promise)
    } finally {
      pending.waiters = Math.max(0, pending.waiters - 1)
      if (pending.waiters === 0 && !pending.settled) {
        for (const [key, candidate] of this.#featureLoads) {
          if (candidate === pending) this.#featureLoads.delete(key)
        }
        pending.controller.abort(new KvtError('Feature load has no active callers', {
          code: 'KVT_FEATURE_LOAD_CANCELLED', subsystem: 'module', operation: 'feature-load',
          context: { moduleId: pending.id, version: pending.version }
        }))
      }
    }
  }

  #leaseFeature(feature: LoadedFeature): FeatureHandle {
    feature.references++
    let released = false
    return Object.freeze({
      id: feature.id,
      version: feature.version,
      scope: feature.scope,
      get released() { return released },
      release: async () => {
        if (released) return
        released = true
        feature.references = Math.max(0, feature.references - 1)
        if (feature.references === 0) await this.#unloadFeature(feature, 'feature-released')
      }
    })
  }

  #unloadFeature(feature: LoadedFeature, reason: string, context?: ShutdownContext): Promise<void> {
    if (feature.unloading) return context ? raceWithAbort(feature.unloading, context.signal) : feature.unloading
    const localController = context ? undefined : new AbortController()
    const shutdownContext = context ?? { signal: localController!.signal, reason, deadline: undefined }
    feature.unloading = feature.scope.shutdown(shutdownContext).finally(() => {
      this.#features.delete(feature.key)
      this.#diagnostics.emit('module', 'feature-unload', 'success', { moduleId: feature.id, version: feature.version })
    })
    return feature.unloading
  }

  async #shutdown(options: RuntimeShutdownOptions): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 10_000
    this.#transition('shutting-down')
    const controller = new AbortController()
    const deadline = Date.now() + timeoutMs
    const timeout = setTimeout(() => controller.abort(new KvtError('Runtime shutdown timed out', {
      code: 'KVT_RUNTIME_SHUTDOWN_TIMEOUT', subsystem: 'runtime', operation: 'shutdown',
      context: { timeoutMs }, retryable: false
    })), timeoutMs)
    const context: ShutdownContext = { signal: controller.signal, reason: options.reason, deadline }
    const errors: unknown[] = []
    try {
      const pendingLoads = [...this.#featureLoads.values()]
      for (const pending of pendingLoads) pending.controller.abort(new KvtError('Runtime stopped during feature load', {
        code: 'KVT_FEATURE_LOAD_CANCELLED', subsystem: 'module', operation: 'feature-load',
        context: { moduleId: pending.id, version: pending.version }
      }))
      this.#featureLoads.clear()
      try {
        await raceWithAbort(Promise.allSettled(pendingLoads.map((pending) => pending.promise)).then(() => undefined), context.signal)
      } catch (error) {
        errors.push(error)
      }
      for (const feature of [...this.#features.values()].reverse()) {
        try { await this.#unloadFeature(feature, options.reason, context) } catch (error) { errors.push(error) }
      }
      try { await this.rootViewModelOwner.shutdown(context) } catch (error) { errors.push(error) }
      for (const plugin of [...this.#startedPlugins].reverse()) {
        try { await plugin.shutdown?.(context) } catch (error) {
          errors.push(error)
          this.reportError(error, 'plugin', 'shutdown', { pluginId: plugin.id })
        }
      }
      try { await this.rootScope.shutdown(context) } catch (error) { errors.push(error) }
      if (controller.signal.aborted) errors.push(controller.signal.reason)
    } finally {
      clearTimeout(timeout)
    }
    this.#transition(errors.length === 0 ? 'stopped' : 'failed')
    if (errors.length > 0) throw new AggregateError(deduplicate(errors), 'KVT runtime shutdown failed')
  }

  #assertRunning(operation: string): void {
    if (this.state !== 'running') throw invalidState(this.state, operation)
  }
}

export async function bootstrapKvt(options: BootstrapKvtOptions = {}): Promise<KvtRuntime> {
  const plugins = orderPlugins(options.plugins ?? [])
  const modules = [...(options.modules ?? []), ...plugins.flatMap((plugin) => plugin.modules)]
  const diagnostics = new Diagnostics(options.diagnostics)
  const registry = new ProviderRegistry(modules)
  const runtime = new KvtRuntime(registry, plugins, diagnostics, options.errorReporter)
  try {
    await runtime.start()
    return runtime
  } catch (error) {
    return runtime.rollback(error)
  }
}

export interface RuntimeInspection {
  readonly state: RuntimeState
  readonly modules: readonly { readonly id: string; readonly version: string }[]
  readonly plugins: readonly { readonly id: string; readonly version: string; readonly started: boolean }[]
  readonly features: readonly {
    readonly id: string
    readonly version: string
    readonly references: number
    readonly scopeState: string
  }[]
  readonly rootScope: ScopeInspection
  readonly rootViewModelOwner: ViewModelOwnerInspection
}

function orderPlugins(plugins: readonly PluginDefinition[]): readonly PluginDefinition[] {
  const byId = new Map<string, PluginDefinition>()
  for (const plugin of plugins) {
    const existing = byId.get(plugin.id)
    if (existing) throw new KvtError(`Duplicate plugin ${plugin.id}`, {
      code: 'KVT_PLUGIN_DUPLICATE', subsystem: 'plugin', operation: 'validate', context: { pluginId: plugin.id }
    })
    byId.set(plugin.id, plugin)
  }
  const ordered: PluginDefinition[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (plugin: PluginDefinition) => {
    if (visited.has(plugin.id)) return
    if (visiting.has(plugin.id)) throw new KvtError(`Circular plugin dependency at ${plugin.id}`, {
      code: 'KVT_PLUGIN_CIRCULAR_DEPENDENCY', subsystem: 'plugin', operation: 'validate', context: { pluginId: plugin.id }
    })
    visiting.add(plugin.id)
    for (const requirement of plugin.requires) {
      const dependency = byId.get(requirement.id)
      if (!dependency || !satisfiesVersion(dependency.version, requirement.version)) {
        throw new KvtError(`Plugin ${plugin.id} requires ${requirement.id}@${requirement.version}`, {
          code: 'KVT_PLUGIN_REQUIREMENT_UNSATISFIED', subsystem: 'plugin', operation: 'validate',
          context: { pluginId: plugin.id, dependencyId: requirement.id, requiredVersion: requirement.version }
        })
      }
      visit(dependency)
    }
    visiting.delete(plugin.id)
    visited.add(plugin.id)
    ordered.push(plugin)
  }
  for (const plugin of plugins) visit(plugin)
  return Object.freeze(ordered)
}

function invalidState(state: RuntimeState, operation: string): KvtError {
  return new KvtError(`Runtime is ${state}; cannot ${operation}`, {
    code: 'KVT_RUNTIME_INVALID_STATE', subsystem: 'runtime', operation, context: { state }
  })
}

function conflictingFeatureLoader(key: string): KvtError {
  return new KvtError(`Feature ${key} was requested with a conflicting loader`, {
    code: 'KVT_FEATURE_LOADER_CONFLICT', subsystem: 'module', operation: 'feature-load', context: { key }
  })
}

function deduplicate(errors: readonly unknown[]): unknown[] {
  return [...new Set(errors)]
}

export { KVT_DIAGNOSTICS_PROTOCOL_VERSION }
