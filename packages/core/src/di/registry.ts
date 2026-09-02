import { KvtError } from '../errors.js'
import type { ModuleDefinition } from './module.js'
import { satisfiesVersion } from './module.js'
import { isLazyDependency, isOptionalDependency, type Dependency, type ProviderDefinition } from './provider.js'
import {
  identifierDescription,
  identifierKey,
  isMultiIdentifier,
  type IdentifierKey,
  type ServiceIdentifier
} from './token.js'

export interface ProviderLookup {
  readonly providers: readonly ProviderDefinition[]
  readonly registry: ProviderRegistry
}

export class ProviderRegistry {
  readonly #providers = new Map<IdentifierKey, readonly ProviderDefinition[]>()
  readonly #modules: ReadonlyMap<string, ModuleDefinition>
  readonly parent: ProviderRegistry | undefined

  constructor(modules: readonly ModuleDefinition[], parent?: ProviderRegistry) {
    this.parent = parent
    const flattened = flattenModules(modules)
    this.#modules = validateModules(flattened, parent)
    const mutable = new Map<IdentifierKey, ProviderDefinition[]>()
    for (const module of flattened) {
      for (const provider of module.providers) {
        const key = identifierKey(provider.token)
        const existing = mutable.get(key) ?? []
        if (!isMultiIdentifier(provider.token) && existing.length > 0) {
          if (provider.override) {
            mutable.set(key, [provider])
            continue
          }
          throw duplicateProvider(provider.token, module.id)
        }
        if (!isMultiIdentifier(provider.token) && parent?.has(provider.token) && !provider.override) {
          const description = identifierDescription(provider.token)
          throw new KvtError(`Provider ${description} shadows a parent binding without an explicit override`, {
            code: 'KVT_DI_OVERRIDE_REQUIRED', subsystem: 'di', operation: 'registry-create',
            context: { token: description, moduleId: module.id }
          })
        }
        existing.push(provider)
        mutable.set(key, existing)
      }
    }
    for (const [id, providers] of mutable) this.#providers.set(id, Object.freeze(providers))
    this.validateGraph()
  }

  get modules(): readonly ModuleDefinition[] {
    return [...this.#modules.values()]
  }

  has(token: ServiceIdentifier<unknown>): boolean {
    return this.#providers.has(identifierKey(token)) || (this.parent?.has(token) ?? false)
  }

  lookup(token: ServiceIdentifier<unknown>): ProviderLookup | undefined {
    const providers = this.#providers.get(identifierKey(token))
    if (providers) return { providers, registry: this }
    return this.parent?.lookup(token)
  }

  lookupAll(token: ServiceIdentifier<unknown>): readonly ProviderLookup[] {
    const result: ProviderLookup[] = []
    const providers = this.#providers.get(identifierKey(token))
    if (providers) result.push({ providers, registry: this })
    if (this.parent) result.push(...this.parent.lookupAll(token))
    return result
  }

  eagerProviders(): readonly ProviderDefinition[] {
    return [...this.#providers.values()].flat().filter((provider) => provider.eager)
  }

  validateGraph(): void {
    for (const providers of this.#providers.values()) {
      for (const provider of providers) this.#validateProvider(provider, [])
    }
  }

  #validateProvider(provider: ProviderDefinition, path: readonly ProviderDefinition[]): void {
    if (path.includes(provider)) {
      const descriptions = [...path, provider].map((entry) => identifierDescription(entry.token))
      throw new KvtError(`Circular dependency: ${descriptions.join(' -> ')}`, {
        code: 'KVT_DI_CIRCULAR_DEPENDENCY', subsystem: 'di', operation: 'graph-validation', path: descriptions
      })
    }
    for (const dependency of provider.dependencies) {
      if (isLazyDependency(dependency)) {
        if (!this.has(dependency.token)) throw missingProvider(dependency.token, identifierDescription(provider.token))
        continue
      }
      const token = isOptionalDependency(dependency) ? dependency.token : dependency
      const lookup = this.lookup(token)
      if (!lookup) {
        if (isOptionalDependency(dependency) || isMultiIdentifier(token)) continue
        throw missingProvider(token, identifierDescription(provider.token))
      }
      for (const target of lookup.providers) this.#validateProvider(target, [...path, provider])
    }
  }
}

function flattenModules(input: readonly ModuleDefinition[]): readonly ModuleDefinition[] {
  const result: ModuleDefinition[] = []
  const byId = new Map<string, ModuleDefinition>()
  const visiting = new Set<string>()
  const visit = (module: ModuleDefinition) => {
    if (visiting.has(module.id)) throw new KvtError(`Circular module include at ${module.id}`, {
      code: 'KVT_MODULE_INCLUDE_CYCLE', subsystem: 'module', operation: 'flatten', context: { id: module.id }
    })
    const existing = byId.get(module.id)
    if (existing) {
      if (existing.version !== module.version) {
        throw new KvtError(`Conflicting module versions for ${module.id}`, {
          code: 'KVT_MODULE_VERSION_CONFLICT', subsystem: 'module', operation: 'flatten',
          context: { id: module.id, existing: existing.version, received: module.version }
        })
      }
      if (existing !== module) throw new KvtError(`Conflicting module definitions for ${module.id}@${module.version}`, {
        code: 'KVT_MODULE_DEFINITION_CONFLICT', subsystem: 'module', operation: 'flatten',
        context: { id: module.id, version: module.version }
      })
      return
    }
    visiting.add(module.id)
    byId.set(module.id, module)
    for (const included of module.includes) visit(included)
    visiting.delete(module.id)
    result.push(module)
  }
  for (const module of input) visit(module)
  return result
}

function validateModules(modules: readonly ModuleDefinition[], parent?: ProviderRegistry): ReadonlyMap<string, ModuleDefinition> {
  const result = new Map(parent?.modules.map((module) => [module.id, module] as const) ?? [])
  for (const module of modules) {
    const existing = result.get(module.id)
    if (existing && existing !== module) {
      throw new KvtError(`Module ${module.id} is already installed with version ${existing.version}`, {
        code: 'KVT_MODULE_VERSION_CONFLICT', subsystem: 'module', operation: 'validate',
        context: { id: module.id, existing: existing.version, received: module.version }
      })
    }
    result.set(module.id, module)
  }
  for (const module of modules) {
    for (const requirement of module.requires) {
      const installed = result.get(requirement.id)
      if (!installed || !satisfiesVersion(installed.version, requirement.version)) {
        throw new KvtError(`Module ${module.id} requires ${requirement.id}@${requirement.version}`, {
          code: 'KVT_MODULE_REQUIREMENT_UNSATISFIED', subsystem: 'module', operation: 'validate',
          context: { moduleId: module.id, dependencyId: requirement.id, requiredVersion: requirement.version,
            installedVersion: installed?.version ?? null }
        })
      }
    }
  }
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (module: ModuleDefinition, path: readonly string[]) => {
    if (visited.has(module.id)) return
    if (visiting.has(module.id)) throw new KvtError(`Circular module requirement: ${[...path, module.id].join(' -> ')}`, {
      code: 'KVT_MODULE_REQUIREMENT_CYCLE', subsystem: 'module', operation: 'validate', path: [...path, module.id]
    })
    visiting.add(module.id)
    for (const requirement of module.requires) {
      // Requirements were validated above, so every dependency exists here.
      visit(result.get(requirement.id)!, [...path, module.id])
    }
    visiting.delete(module.id)
    visited.add(module.id)
  }
  for (const module of result.values()) visit(module, [])
  return result
}

function missingProvider(token: ServiceIdentifier<unknown>, requestedBy: string): KvtError {
  const description = identifierDescription(token)
  return new KvtError(`Missing provider ${description} required by ${requestedBy}`, {
    code: 'KVT_DI_PROVIDER_MISSING', subsystem: 'di', operation: 'graph-validation',
    context: { token: description, requestedBy }
  })
}

function duplicateProvider(token: ServiceIdentifier<unknown>, moduleId: string): KvtError {
  const description = identifierDescription(token)
  return new KvtError(`Duplicate provider for ${description}`, {
    code: 'KVT_DI_PROVIDER_DUPLICATE', subsystem: 'di', operation: 'registry-create',
    context: { token: description, moduleId }
  })
}

export function dependencyToken(dependency: Dependency<unknown>): ServiceIdentifier<unknown> {
  return isOptionalDependency(dependency) || isLazyDependency(dependency) ? dependency.token : dependency
}
