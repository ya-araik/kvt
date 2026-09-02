import { KvtError } from '../errors.js'
import { isProviderRegistration, type ProviderDefinition, type ProviderRegistration } from './provider.js'

export interface ModuleRequirement {
  readonly id: string
  readonly version: string
}

export interface ModuleDefinition {
  readonly id: string
  readonly version: string
  readonly requires: readonly ModuleRequirement[]
  readonly providers: readonly ProviderDefinition[]
  readonly includes: readonly ModuleDefinition[]
}

export interface DefineModuleOptions {
  readonly id: string
  readonly version: string
  readonly requires?: readonly ModuleRequirement[]
  readonly providers?: readonly ProviderRegistration[]
  readonly includes?: readonly ModuleDefinition[]
}

export function defineModule(options: DefineModuleOptions): ModuleDefinition {
  validateManifestIdentity(options.id, options.version, 'module')
  validateRequirements(options.requires ?? [], `module ${options.id}`)
  return Object.freeze({
    id: options.id,
    version: options.version,
    requires: Object.freeze((options.requires ?? []).map((requirement) => Object.freeze({ ...requirement }))),
    providers: Object.freeze((options.providers ?? []).map((provider) => {
      if (!isProviderRegistration(provider)) throw new KvtError('Module providers must be created with bind() or provide()', {
        code: 'KVT_DI_PROVIDER_REGISTRATION_INVALID', subsystem: 'di', operation: 'define-module',
        context: { moduleId: options.id }
      })
      return provider.toProviderDefinition()
    })),
    includes: Object.freeze([...(options.includes ?? [])])
  })
}

export function validateManifestIdentity(id: string, version: string, kind: 'module' | 'plugin'): void {
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(id)) {
    throw new KvtError(`Invalid ${kind} id: ${id}`, {
      code: 'KVT_MANIFEST_ID_INVALID', subsystem: kind, operation: 'define', context: { id }
    })
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new KvtError(`Invalid ${kind} version: ${version}`, {
      code: 'KVT_MANIFEST_VERSION_INVALID', subsystem: kind, operation: 'define', context: { id, version }
    })
  }
}

export function validateRequirements(requirements: readonly ModuleRequirement[], owner: string): void {
  const ids = new Set<string>()
  for (const requirement of requirements) {
    if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(requirement.id)) {
      throw new KvtError(`Invalid dependency id ${requirement.id} in ${owner}`, {
        code: 'KVT_MANIFEST_REQUIREMENT_INVALID', subsystem: 'module', operation: 'define',
        context: { owner, dependencyId: requirement.id }
      })
    }
    if (!/^(?:\*|[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(requirement.version)) {
      throw new KvtError(`Invalid dependency version ${requirement.version} in ${owner}`, {
        code: 'KVT_MANIFEST_REQUIREMENT_INVALID', subsystem: 'module', operation: 'define',
        context: { owner, dependencyId: requirement.id, requiredVersion: requirement.version }
      })
    }
    if (ids.has(requirement.id)) throw new KvtError(`Duplicate dependency ${requirement.id} in ${owner}`, {
      code: 'KVT_MANIFEST_REQUIREMENT_DUPLICATE', subsystem: 'module', operation: 'define',
      context: { owner, dependencyId: requirement.id }
    })
    ids.add(requirement.id)
  }
}

export function satisfiesVersion(actual: string, requirement: string): boolean {
  if (requirement === '*' || requirement === actual) return true
  const actualParts = parseVersion(actual)
  if (requirement.startsWith('^')) {
    const expected = parseVersion(requirement.slice(1))
    if (compareVersion(actualParts, expected) < 0) return false
    if (expected.major > 0) return actualParts.major === expected.major
    if (expected.minor > 0) return actualParts.major === 0 && actualParts.minor === expected.minor
    return actualParts.major === 0 && actualParts.minor === 0 && actualParts.patch === expected.patch
  }
  if (requirement.startsWith('~')) {
    const expected = parseVersion(requirement.slice(1))
    return actualParts.major === expected.major && actualParts.minor === expected.minor && compareVersion(actualParts, expected) >= 0
  }
  return false
}

interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

function parseVersion(version: string): ParsedVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version)
  if (!match) return { major: -1, minor: -1, patch: -1, prerelease: [] }
  return {
    major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
    prerelease: Object.freeze(match[4]?.split('.') ?? [])
  }
}

function compareVersion(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const difference = left[key] - right[key]
    if (difference !== 0) return difference
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index++) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    // At least one part exists because the loop is bounded by the longest prerelease.
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber
    if (leftNumber !== undefined) return -1
    if (rightNumber !== undefined) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}
