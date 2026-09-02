import { KvtError } from '../errors.js'
import { ViewModel } from '../view-model.js'
import type {
  AbstractConstructor,
  Constructor,
  MultiToken,
  ServiceIdentifier,
  SingleIdentifier
} from './token.js'

export interface OptionalDependency<T> {
  readonly kind: 'optional'
  readonly token: SingleIdentifier<T>
}

export interface LazyDependency<T> {
  readonly kind: 'lazy'
  readonly token: SingleIdentifier<T>
}

export type Dependency<T> = ServiceIdentifier<T> | OptionalDependency<T> | LazyDependency<T>

export type ResolvedDependency<TDependency> =
  TDependency extends OptionalDependency<infer T> ? T | undefined
    : TDependency extends LazyDependency<infer T> ? () => T | Promise<T>
      : TDependency extends MultiToken<infer T> ? readonly T[]
        : TDependency extends ServiceIdentifier<infer T> ? T
          : never

export type DependencyTuple<TArguments extends readonly unknown[]> = {
  readonly [TIndex in keyof TArguments]: Dependency<TArguments[TIndex]>
}

export type ResolvedDependencyTuple<TDependencies extends readonly Dependency<unknown>[]> = {
  readonly [TIndex in keyof TDependencies]: ResolvedDependency<TDependencies[TIndex]>
}

export type ProviderLifetime = 'singleton' | 'scoped' | 'transient'
export type ProviderLifecycle = 'provider' | 'view-model'

export interface ProviderBase<T> {
  readonly token: ServiceIdentifier<T>
  readonly lifetime: ProviderLifetime
  readonly lifecycle: ProviderLifecycle
  readonly eager: boolean
  readonly async: boolean
  readonly override: boolean
}

export interface ValueProvider<T> extends ProviderBase<T> {
  readonly kind: 'value'
  readonly value: T
  readonly dependencies: readonly []
}

export interface FactoryProvider<T> extends ProviderBase<T> {
  readonly kind: 'factory'
  readonly dependencies: readonly Dependency<unknown>[]
  readonly factory: (...dependencies: readonly unknown[]) => T | Promise<T>
}

export interface AliasProvider<T> extends ProviderBase<T> {
  readonly kind: 'alias'
  readonly target: Dependency<T>
  readonly dependencies: readonly [Dependency<T>]
}

export type ProviderDefinition<T = unknown> = ValueProvider<T> | FactoryProvider<T> | AliasProvider<T>

const providerRegistration = Symbol('kvt.provider-registration')

export interface ProviderRegistration<T = unknown> {
  readonly [providerRegistration]: true
  toProviderDefinition(): ProviderDefinition<T>
}

export interface OverridableProviderRegistration<T = unknown> extends ProviderRegistration<T> {
  override(): ProviderRegistration<T>
}

interface RegistrationState<T> {
  readonly token: ServiceIdentifier<T>
  readonly implementation?: Constructor<T, readonly unknown[]>
  readonly dependencies: readonly Dependency<unknown>[]
  readonly factory?: (...dependencies: readonly unknown[]) => T | Promise<T>
  readonly value?: T
  readonly target?: Dependency<T>
  readonly kind: 'factory' | 'value' | 'alias'
  readonly lifetime: ProviderLifetime
  readonly lifetimeExplicit: boolean
  readonly lifecycle: ProviderLifecycle
  readonly eager: boolean
  readonly async: boolean
  readonly override: boolean
}

export type FinalBinding<T> = ProviderRegistration<T>

export interface CachedBinding<T> extends ProviderRegistration<T> {
  eager(): FinalBinding<T>
  override(): CachedBinding<T>
}

export interface LifetimeModifiers<T> extends ProviderRegistration<T> {
  singleton(): CachedBinding<T>
  scoped(): CachedBinding<T>
  transient(): FinalBinding<T>
  override(): LifetimeModifiers<T>
}

export interface ViewModelBinding<T> extends ProviderRegistration<T> {
  override(): ViewModelBinding<T>
}

export interface BoundProvider<T, TArguments extends readonly unknown[]>
  extends LifetimeModifiers<T> {
  inject<TDependencies extends DependencyTuple<TArguments>>(...dependencies: TDependencies): BoundProvider<T, TArguments>
  toExisting(target: Dependency<T>): AliasBinding<T>
  viewModel(this: T extends ViewModel ? BoundProvider<T, TArguments> : never): ViewModelBinding<T>
}

export interface BindSelector<T> {
  to<TImplementation extends T, TArguments extends readonly unknown[]>(
    implementation: Constructor<TImplementation, TArguments>
  ): BoundProvider<T, TArguments>
  toExisting(target: Dependency<T>): AliasBinding<T>
}

export type AliasBinding<T> = LifetimeModifiers<T>

export interface ProvideSelector<T> {
  inject<TDependencies extends readonly Dependency<unknown>[]>(
    ...dependencies: TDependencies
  ): FactorySelector<T, TDependencies>
  using(factory: () => T): FactoryBinding<T>
  usingAsync(factory: () => Promise<T>): FactoryBinding<T>
  value(value: T): ValueBinding<T>
  toExisting(target: Dependency<T>): AliasBinding<T>
}

export interface FactorySelector<T, TDependencies extends readonly Dependency<unknown>[]> {
  using(factory: (...dependencies: ResolvedDependencyTuple<TDependencies>) => T): FactoryBinding<T>
  usingAsync(factory: (...dependencies: ResolvedDependencyTuple<TDependencies>) => Promise<T>): FactoryBinding<T>
}

export type FactoryBinding<T> = LifetimeModifiers<T>
export interface ValueBinding<T> extends ProviderRegistration<T> {
  override(): FinalBinding<T>
}

class RegistrationBuilder<T> implements ProviderRegistration<T> {
  readonly [providerRegistration] = true as const
  readonly #state: RegistrationState<T>

  constructor(state: RegistrationState<T>) {
    this.#state = Object.freeze({ ...state, dependencies: Object.freeze([...state.dependencies]) })
  }

  inject(...dependencies: readonly Dependency<unknown>[]): RegistrationBuilder<T> {
    if (this.#state.kind !== 'factory' || this.#state.factory) throw invalidChain('inject')
    return this.#next({ dependencies })
  }

  to<TImplementation extends T>(implementation: Constructor<TImplementation, readonly unknown[]>): RegistrationBuilder<T> {
    if (this.#state.implementation || this.#state.factory || this.#state.kind !== 'factory') throw invalidChain('to')
    return this.#next({ implementation: implementation as Constructor<T, readonly unknown[]> })
  }

  toExisting(target: Dependency<T>): RegistrationBuilder<T> {
    if (this.#state.implementation || this.#state.factory || this.#state.kind !== 'factory') throw invalidChain('toExisting')
    return this.#next({ kind: 'alias', target, dependencies: [target] })
  }

  using(factory: (...dependencies: readonly unknown[]) => T): RegistrationBuilder<T> {
    return this.#withFactory(factory, false)
  }

  usingAsync(factory: (...dependencies: readonly unknown[]) => Promise<T>): RegistrationBuilder<T> {
    return this.#withFactory(factory, true)
  }

  value(value: T): RegistrationBuilder<T> {
    if (this.#state.implementation || this.#state.factory || this.#state.kind !== 'factory') throw invalidChain('value')
    return this.#next({ kind: 'value', value, lifetime: 'singleton', eager: true })
  }

  singleton(): RegistrationBuilder<T> {
    return this.#withLifetime('singleton')
  }

  scoped(): RegistrationBuilder<T> {
    return this.#withLifetime('scoped')
  }

  transient(): RegistrationBuilder<T> {
    return this.#withLifetime('transient')
  }

  viewModel(): RegistrationBuilder<T> {
    if (this.#state.lifecycle === 'view-model' || this.#state.lifetimeExplicit || this.#state.eager) {
      throw invalidChain('viewModel')
    }
    if (this.#state.async || typeof this.#state.token !== 'function' || !(this.#state.token.prototype instanceof ViewModel)) {
      throw invalidChain('viewModel')
    }
    return this.#next({ lifecycle: 'view-model' })
  }

  eager(): RegistrationBuilder<T> {
    if (this.#state.eager || this.#state.lifecycle === 'view-model' || this.#state.lifetime === 'transient') {
      throw invalidChain('eager')
    }
    return this.#next({ eager: true })
  }

  override(): RegistrationBuilder<T> {
    if (this.#state.override) throw invalidChain('override')
    return this.#next({ override: true })
  }

  toProviderDefinition(): ProviderDefinition<T> {
    const base = {
      token: this.#state.token,
      lifetime: this.#state.lifetime,
      lifecycle: this.#state.lifecycle,
      eager: this.#state.eager,
      async: this.#state.async,
      override: this.#state.override
    } as const
    if (this.#state.kind === 'value') {
      return Object.freeze({ ...base, kind: 'value', value: this.#state.value as T, dependencies: Object.freeze([]) as readonly [] })
    }
    if (this.#state.kind === 'alias') {
      if (!this.#state.target) throw incompleteBinding(this.#state.token)
      return Object.freeze({
        ...base,
        kind: 'alias',
        target: this.#state.target,
        dependencies: Object.freeze([this.#state.target]) as readonly [Dependency<T>]
      })
    }
    const implementation = this.#state.implementation
      ?? (typeof this.#state.token === 'function' ? this.#state.token as Constructor<T, readonly unknown[]> : undefined)
    const factory = this.#state.factory ?? (implementation
      ? (...dependencies: readonly unknown[]) => Reflect.construct(implementation, dependencies) as T
      : undefined)
    if (!factory) throw incompleteBinding(this.#state.token)
    return Object.freeze({
      ...base,
      kind: 'factory',
      dependencies: this.#state.dependencies,
      factory
    })
  }

  #withFactory(factory: (...dependencies: readonly unknown[]) => T | Promise<T>, async: boolean): RegistrationBuilder<T> {
    if (this.#state.implementation || this.#state.factory || this.#state.kind !== 'factory') throw invalidChain(async ? 'usingAsync' : 'using')
    return this.#next({ factory, async })
  }

  #withLifetime(lifetime: ProviderLifetime): RegistrationBuilder<T> {
    if (this.#state.lifecycle === 'view-model' || this.#state.lifetimeExplicit) {
      throw invalidChain(lifetime)
    }
    return this.#next({ lifetime, lifetimeExplicit: true })
  }

  #next(patch: Partial<RegistrationState<T>>): RegistrationBuilder<T> {
    return new RegistrationBuilder({ ...this.#state, ...patch })
  }
}

export function optional<T>(token: SingleIdentifier<T>): OptionalDependency<T> {
  return Object.freeze({ kind: 'optional', token })
}

export function lazy<T>(token: SingleIdentifier<T>): LazyDependency<T> {
  return Object.freeze({ kind: 'lazy', token })
}

export function isOptionalDependency(dependency: Dependency<unknown>): dependency is OptionalDependency<unknown> {
  return typeof dependency !== 'function' && dependency.kind === 'optional'
}

export function isLazyDependency(dependency: Dependency<unknown>): dependency is LazyDependency<unknown> {
  return typeof dependency !== 'function' && dependency.kind === 'lazy'
}

export function bind<T, TArguments extends readonly unknown[]>(
  token: Constructor<T, TArguments>
): BoundProvider<T, TArguments>
export function bind<T>(token: AbstractConstructor<T>): BindSelector<T>
export function bind<T>(token: AbstractConstructor<T>): BoundProvider<T, readonly unknown[]> | BindSelector<T> {
  return new RegistrationBuilder<T>({
    token,
    dependencies: [],
    kind: 'factory',
    lifetime: 'transient',
    lifetimeExplicit: false,
    lifecycle: 'provider',
    eager: false,
    async: false,
    override: false
  }) as unknown as BoundProvider<T, readonly unknown[]>
}

export function provide<T>(token: ServiceIdentifier<T>): ProvideSelector<T> {
  return new RegistrationBuilder<T>({
    token,
    dependencies: [],
    kind: 'factory',
    lifetime: 'transient',
    lifetimeExplicit: false,
    lifecycle: 'provider',
    eager: false,
    async: false,
    override: false
  }) as unknown as ProvideSelector<T>
}

export function isProviderRegistration(value: unknown): value is ProviderRegistration {
  return typeof value === 'object' && value !== null && providerRegistration in value
}

function incompleteBinding(token: ServiceIdentifier<unknown>): KvtError {
  const name = typeof token === 'function' ? token.name : token.description
  return new KvtError(`Provider ${name} has no implementation`, {
    code: 'KVT_DI_BINDING_INCOMPLETE', subsystem: 'di', operation: 'define-module', context: { provider: name }
  })
}

function invalidChain(operation: string): KvtError {
  return new KvtError(`Provider builder modifier ${operation} is not valid in this chain`, {
    code: 'KVT_DI_BINDING_CHAIN_INVALID', subsystem: 'di', operation
  })
}
