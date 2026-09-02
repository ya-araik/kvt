import { Diagnostics } from '../diagnostics.js'
import { KvtError } from '../errors.js'
import { raceWithAbort, shutdownResource, type ShutdownContext } from '../lifecycle.js'
import { isLazyDependency, isOptionalDependency, type Dependency, type ProviderDefinition } from './provider.js'
import { ProviderRegistry, type ProviderLookup } from './registry.js'
import {
  type ClassIdentifier,
  identifierDescription,
  isMultiIdentifier,
  type MultiToken,
  type ServiceIdentifier,
  type SingleIdentifier
} from './token.js'
import type { ViewModel } from '../view-model.js'

export type ScopeState = 'active' | 'shutting-down' | 'stopped'

export interface CreateScopeOptions {
  readonly id?: string
  readonly registry?: ProviderRegistry
}

export interface ScopeInspection {
  readonly id: string
  readonly state: ScopeState
  readonly childCount: number
  readonly ownedResourceCount: number
  readonly ownedResources: readonly { readonly label: string }[]
  readonly modules: readonly { readonly id: string; readonly version: string }[]
  readonly children: readonly ScopeInspection[]
}

interface OwnedResource {
  readonly value: unknown
  readonly provider: ProviderDefinition | undefined
  readonly label: string
}

export class KvtScope {
  readonly id: string
  readonly parent: KvtScope | undefined
  readonly registry: ProviderRegistry | undefined
  readonly #diagnostics: Diagnostics
  readonly #children = new Set<KvtScope>()
  readonly #instances = new Map<ProviderDefinition, unknown>()
  readonly #pending = new Map<ProviderDefinition, Promise<unknown>>()
  readonly #creations = new Set<Promise<unknown>>()
  readonly #owned: OwnedResource[] = []
  #state: ScopeState = 'active'
  #shutdownPromise: Promise<void> | undefined
  #shutdownContext: ShutdownContext | undefined

  constructor(parent: KvtScope | undefined, options: CreateScopeOptions = {}, diagnostics = new Diagnostics()) {
    this.parent = parent
    this.registry = options.registry
    this.id = options.id ?? `scope-${crypto.randomUUID()}`
    this.#diagnostics = diagnostics
    if (parent) {
      parent.#assertActive('create-child')
      parent.#children.add(this)
    }
    this.#diagnostics.emit('scope', 'create', 'success', { scopeId: this.id, parentScopeId: parent?.id ?? null })
  }

  get state(): ScopeState {
    return this.#state
  }

  get ownedResourceCount(): number {
    return this.#owned.length
  }

  get childCount(): number {
    return this.#children.size
  }

  inspect(): ScopeInspection {
    return Object.freeze({
      id: this.id,
      state: this.state,
      childCount: this.childCount,
      ownedResourceCount: this.ownedResourceCount,
      ownedResources: Object.freeze(this.#owned.map((resource) => Object.freeze({ label: resource.label }))),
      modules: Object.freeze((this.registry?.modules ?? []).map((module) => Object.freeze({ id: module.id, version: module.version }))),
      children: Object.freeze([...this.#children].map((child) => child.inspect()))
    })
  }

  own<T>(resource: T, label = 'external-resource'): T {
    this.#assertActive('own-resource')
    if (!this.#owned.some((entry) => entry.value === resource)) {
      this.#owned.push({ value: resource, provider: undefined, label })
    }
    return resource
  }

  createChild(options: CreateScopeOptions = {}): KvtScope {
    this.#assertActive('create-child')
    return new KvtScope(this, options, this.#diagnostics)
  }

  /** @internal ViewModelOwner is the only supported caller. */
  createViewModel<T extends ViewModel>(identifier: ClassIdentifier<T>): T {
    this.#assertActive('create-view-model')
    const lookup = this.#lookup(identifier)
    if (!lookup || lookup.providers.length !== 1) throw missing(identifier, [])
    const provider = lookup.providers[0]!
    if (provider.lifecycle !== 'view-model') throw new KvtError(`${identifierDescription(identifier)} is not registered as a ViewModel`, {
      code: 'KVT_VIEW_MODEL_PROVIDER_REQUIRED', subsystem: 'view-model', operation: 'create',
      context: { identifier: identifierDescription(identifier) }
    })
    const registryScope = this.#scopeForRegistry(lookup.registry)
    const value = this.#getProviderSync(provider, this, registryScope, [], true)
    if (!(value instanceof identifier)) throw new KvtError(`Provider ${identifierDescription(identifier)} returned an incompatible value`, {
      code: 'KVT_VIEW_MODEL_PROVIDER_INVALID', subsystem: 'view-model', operation: 'create',
      context: { identifier: identifierDescription(identifier) }
    })
    return value
  }

  resolve<T>(token: SingleIdentifier<T>): T
  resolve<T>(token: MultiToken<T>): readonly T[]
  resolve<T>(token: ServiceIdentifier<T>): T | readonly T[] {
    this.#assertActive('resolve')
    return this.#resolveTokenSync(token, []) as T | readonly T[]
  }

  resolveAsync<T>(token: SingleIdentifier<T>): Promise<T>
  resolveAsync<T>(token: MultiToken<T>): Promise<readonly T[]>
  resolveAsync<T>(token: ServiceIdentifier<T>): Promise<T | readonly T[]> {
    this.#assertActive('resolve-async')
    return this.#resolveTokenAsync(token, []) as Promise<T | readonly T[]>
  }

  initializeEagerProviders(): Promise<void> {
    this.#assertActive('initialize-eager')
    const providers = this.registry?.eagerProviders() ?? []
    return Promise.all(providers.map((provider) => this.#getProviderAsync(provider, this, this, []))).then(() => undefined)
  }

  shutdown(context: ShutdownContext): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    this.#state = 'shutting-down'
    this.#shutdownContext = context
    this.#shutdownPromise = this.#shutdown(context)
    return this.#shutdownPromise
  }

  #resolveTokenSync(token: ServiceIdentifier<unknown>, path: readonly string[]): unknown {
    const multiple = isMultiIdentifier(token)
    const lookups = multiple ? this.#lookupAll(token) : [this.#lookup(token)].filter(Boolean) as ProviderLookup[]
    if (lookups.length === 0) {
      if (multiple) return Object.freeze([])
      throw missing(token, path)
    }
    const values = lookups.flatMap((lookup) => lookup.providers.map((provider) => {
      const ownerBoundary = this.#scopeForRegistry(lookup.registry)
      return this.#getProviderSync(provider, this, ownerBoundary, path)
    }))
    return multiple ? Object.freeze(values) : values[0]
  }

  async #resolveTokenAsync(token: ServiceIdentifier<unknown>, path: readonly string[]): Promise<unknown> {
    const multiple = isMultiIdentifier(token)
    const lookups = multiple ? this.#lookupAll(token) : [this.#lookup(token)].filter(Boolean) as ProviderLookup[]
    if (lookups.length === 0) {
      if (multiple) return Object.freeze([])
      throw missing(token, path)
    }
    const values = await Promise.all(lookups.flatMap((lookup) => lookup.providers.map((provider) => {
      const ownerBoundary = this.#scopeForRegistry(lookup.registry)
      return this.#getProviderAsync(provider, this, ownerBoundary, path)
    })))
    return multiple ? Object.freeze(values) : values[0]
  }

  #getProviderSync(
    provider: ProviderDefinition,
    requestingScope: KvtScope,
    registryScope: KvtScope,
    path: readonly string[],
    allowViewModel = false
  ): unknown {
    const description = identifierDescription(provider.token)
    if (path.includes(description)) throw circular([...path, description])
    if (provider.lifecycle === 'view-model' && !allowViewModel) throw new KvtError(`ViewModel ${description} requires an owner`, {
      code: 'KVT_VIEW_MODEL_OWNER_REQUIRED', subsystem: 'view-model', operation: 'resolve',
      context: { identifier: description }
    })
    if (provider.async) throw new KvtError(`Provider ${description} requires resolveAsync()`, {
      code: 'KVT_DI_ASYNC_RESOLVE_REQUIRED', subsystem: 'di', operation: 'resolve',
      context: { token: description }, path
    })
    const owner = provider.lifetime === 'singleton' ? registryScope : requestingScope
    if (provider.lifetime !== 'transient' && owner.#instances.has(provider)) return owner.#instances.get(provider)
    const dependencyScope = provider.lifetime === 'singleton' ? registryScope : requestingScope
    const nextPath = [...path, description]
    const value = provider.kind === 'value' ? provider.value
      : provider.kind === 'alias' ? dependencyScope.#resolveDependencySync(provider.target, nextPath)
        : (provider.factory as (...arguments_: readonly unknown[]) => unknown)(
          ...provider.dependencies.map((dependency) => dependencyScope.#resolveDependencySync(dependency, nextPath))
        )
    if (value instanceof Promise) throw new KvtError(`Provider ${description} returned a Promise without being declared async`, {
      code: 'KVT_DI_UNDECLARED_ASYNC_PROVIDER', subsystem: 'di', operation: 'resolve',
      context: { token: description }
    })
    owner.#record(provider, value)
    return value
  }

  async #getProviderAsync(
    provider: ProviderDefinition,
    requestingScope: KvtScope,
    registryScope: KvtScope,
    path: readonly string[]
  ): Promise<unknown> {
    const description = identifierDescription(provider.token)
    if (path.includes(description)) throw circular([...path, description])
    if (provider.lifecycle === 'view-model') throw new KvtError(`ViewModel ${description} requires an owner`, {
      code: 'KVT_VIEW_MODEL_OWNER_REQUIRED', subsystem: 'view-model', operation: 'resolve-async',
      context: { identifier: description }
    })
    const owner = provider.lifetime === 'singleton' ? registryScope : requestingScope
    if (provider.lifetime !== 'transient' && owner.#instances.has(provider)) return owner.#instances.get(provider)
    if (provider.lifetime !== 'transient') {
      const pending = owner.#pending.get(provider)
      if (pending) return pending
    }
    const dependencyScope = provider.lifetime === 'singleton' ? registryScope : requestingScope
    const nextPath = [...path, description]
    const creation = (async () => {
      const value = provider.kind === 'value' ? provider.value
        : provider.kind === 'alias' ? await dependencyScope.#resolveDependencyAsync(provider.target, nextPath)
          : await (provider.factory as (...arguments_: readonly unknown[]) => unknown)(
            ...await Promise.all(provider.dependencies.map((dependency) => dependencyScope.#resolveDependencyAsync(dependency, nextPath)))
          )
      if (owner.#state !== 'active') {
        // The only transition out of active records the context before cleanup starts.
        await shutdownResource(value, owner.#shutdownContext!)
        throw new KvtError(`Provider ${description} completed after its scope started shutdown`, {
          code: 'KVT_DI_PROVIDER_COMPLETED_AFTER_SHUTDOWN', subsystem: 'di', operation: 'provider-create',
          context: { token: description, scopeId: owner.id }
        })
      }
      owner.#record(provider, value)
      return value
    })()
    owner.#creations.add(creation)
    if (provider.lifetime !== 'transient') owner.#pending.set(provider, creation)
    try {
      return await creation
    } finally {
      owner.#creations.delete(creation)
      owner.#pending.delete(provider)
    }
  }

  #record(provider: ProviderDefinition, value: unknown): void {
    if (provider.lifetime !== 'transient') this.#instances.set(provider, value)
    if (provider.kind === 'factory' && provider.lifecycle !== 'view-model' && !this.#owned.some((entry) => entry.value === value)) {
      const description = identifierDescription(provider.token)
      this.#owned.push({ provider, value, label: description })
      this.#diagnostics.emit('provider', 'create', 'success', {
        token: description, lifetime: provider.lifetime, scopeId: this.id
      })
    }
  }

  #resolveDependencySync(dependency: Dependency<unknown>, path: readonly string[]): unknown {
    if (isOptionalDependency(dependency)) {
      const lookup = this.#lookup(dependency.token)
      return lookup ? this.#resolveTokenSync(dependency.token, path) : undefined
    }
    if (isLazyDependency(dependency)) return () => this.resolveAsync(dependency.token)
    return this.#resolveTokenSync(dependency, path)
  }

  async #resolveDependencyAsync(dependency: Dependency<unknown>, path: readonly string[]): Promise<unknown> {
    if (isOptionalDependency(dependency)) {
      const lookup = this.#lookup(dependency.token)
      return lookup ? this.#resolveTokenAsync(dependency.token, path) : undefined
    }
    if (isLazyDependency(dependency)) return () => this.resolveAsync(dependency.token)
    return this.#resolveTokenAsync(dependency, path)
  }

  #lookup(token: ServiceIdentifier<unknown>): ProviderLookup | undefined {
    for (const scope of this.#ancestors()) {
      const local = scope.registry?.lookup(token)
      if (local) return local
    }
    return undefined
  }

  #lookupAll(token: ServiceIdentifier<unknown>): readonly ProviderLookup[] {
    const result: ProviderLookup[] = []
    const seen = new Set<ProviderRegistry>()
    for (const scope of this.#ancestors()) {
      for (const lookup of scope.registry?.lookupAll(token) ?? []) {
        if (!seen.has(lookup.registry)) {
          seen.add(lookup.registry)
          result.push(lookup)
        }
      }
    }
    return result
  }

  #scopeForRegistry(registry: ProviderRegistry): KvtScope {
    for (const scope of this.#ancestors()) {
      if (scope.registry === registry) return scope
    }
    throw new KvtError('Provider registry has no owning scope', {
      code: 'KVT_DI_REGISTRY_OWNER_MISSING', subsystem: 'di', operation: 'resolve'
    })
  }

  #ancestors(): readonly KvtScope[] {
    const scopes: KvtScope[] = [this]
    let parent = this.parent
    while (parent) {
      scopes.push(parent)
      parent = parent.parent
    }
    return scopes
  }

  async #shutdown(context: ShutdownContext): Promise<void> {
    const errors: unknown[] = []
    this.#diagnostics.emit('scope', 'shutdown', 'start', { scopeId: this.id })
    for (const child of [...this.#children].reverse()) {
      try {
        await raceWithAbort(child.shutdown(context), context.signal)
      } catch (error) {
        errors.push(error)
      }
    }
    if (this.#creations.size > 0) {
      try {
        await raceWithAbort(Promise.allSettled([...this.#creations]).then(() => undefined), context.signal)
      } catch (error) {
        errors.push(error)
      }
    }
    for (const resource of [...this.#owned].reverse()) {
      try {
        await shutdownResource(resource.value, context)
        this.#diagnostics.emit('provider', 'shutdown', 'success', {
          token: resource.label, scopeId: this.id
        })
      } catch (error) {
        errors.push(error)
        this.#diagnostics.emit('provider', 'shutdown', 'failure', {
          token: resource.label, scopeId: this.id, error
        })
      }
    }
    this.#owned.length = 0
    this.#instances.clear()
    this.#pending.clear()
    this.#creations.clear()
    this.#children.clear()
    if (this.parent) this.parent.#children.delete(this)
    this.#state = 'stopped'
    this.#diagnostics.emit('scope', 'shutdown', errors.length === 0 ? 'success' : 'failure', {
      scopeId: this.id, errorCount: errors.length
    })
    if (errors.length > 0) throw new AggregateError(errors, `Scope ${this.id} shutdown failed`)
  }

  #assertActive(operation: string): void {
    if (this.#state !== 'active') throw new KvtError(`Scope ${this.id} is ${this.#state}`, {
      code: 'KVT_SCOPE_NOT_ACTIVE', subsystem: 'di', operation, context: { scopeId: this.id, state: this.#state }
    })
  }
}

function missing(token: ServiceIdentifier<unknown>, path: readonly string[]): KvtError {
  const description = identifierDescription(token)
  return new KvtError(`No provider registered for ${description}`, {
    code: 'KVT_DI_PROVIDER_MISSING', subsystem: 'di', operation: 'resolve',
    context: { token: description }, path
  })
}

function circular(path: readonly string[]): KvtError {
  return new KvtError(`Circular dependency: ${path.join(' -> ')}`, {
    code: 'KVT_DI_CIRCULAR_DEPENDENCY', subsystem: 'di', operation: 'resolve', path
  })
}
