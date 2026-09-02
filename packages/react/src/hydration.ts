import type { StateFlow } from '@kvt/flow'

export const KVT_HYDRATION_VERSION = 1 as const

export interface HydrationState {
  readonly version: typeof KVT_HYDRATION_VERSION
  readonly states: Readonly<Record<string, unknown>>
}

export interface HydrationEntry<T> {
  readonly key: string
  readonly flow: StateFlow<T>
  readonly serialize: (value: T) => unknown
}

export interface HydrationRegistry {
  read<T>(key: string, deserialize: (value: unknown) => T): T | undefined
  has(key: string): boolean
}

export function createHydrationState(entries: readonly HydrationEntry<unknown>[]): HydrationState {
  const states: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const entry of entries) {
    validateStateKey(entry.key)
    if (Object.hasOwn(states, entry.key)) throw new Error(`Duplicate hydration state key: ${entry.key}`)
    const serialized = entry.serialize(entry.flow.value)
    assertSerializable(serialized, entry.key)
    states[entry.key] = serialized
  }
  return Object.freeze({ version: KVT_HYDRATION_VERSION, states: Object.freeze(states) })
}

export function createHydrationRegistry(state?: HydrationState): HydrationRegistry {
  const states: Readonly<Record<string, unknown>> = state === undefined
    ? Object.freeze({})
    : normalizeHydrationState(state).states
  return Object.freeze({
    read<T>(key: string, deserialize: (value: unknown) => T): T | undefined {
      validateStateKey(key)
      return Object.hasOwn(states, key) ? deserialize(states[key]) : undefined
    },
    has(key: string): boolean {
      return Object.hasOwn(states, key)
    }
  })
}

export function serializeHydrationState(state: HydrationState): string {
  return JSON.stringify(normalizeHydrationState(state))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

export function parseHydrationState(serialized: string): HydrationState {
  const parsed: unknown = JSON.parse(serialized)
  if (typeof parsed !== 'object' || parsed === null) throw new TypeError('Hydration state must be an object')
  const candidate = parsed as { readonly version?: unknown; readonly states?: unknown }
  if (candidate.version !== KVT_HYDRATION_VERSION || typeof candidate.states !== 'object' || candidate.states === null
    || Array.isArray(candidate.states)) throw new TypeError('Invalid KVT hydration state')
  return normalizeHydrationState(candidate as HydrationState)
}

function validateStateKey(key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
    throw new TypeError(`Invalid hydration state key: ${key}`)
  }
}

function assertSerializable(value: unknown, key: string): void {
  try {
    assertJsonValue(value, new Set())
  } catch (error) {
    throw new TypeError(`Hydration state "${key}" is not JSON serializable`, { cause: error })
  }
}

function normalizeHydrationState(state: HydrationState): HydrationState {
  if (state.version !== KVT_HYDRATION_VERSION || typeof state.states !== 'object' || state.states === null
    || Array.isArray(state.states)) {
    throw new TypeError(`Unsupported or invalid hydration state version: ${String(state.version)}`)
  }
  const states: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const [key, value] of Object.entries(state.states)) {
    validateStateKey(key)
    assertSerializable(value, key)
    states[key] = value
  }
  return Object.freeze({ version: KVT_HYDRATION_VERSION, states: Object.freeze(states) })
}

function assertJsonValue(value: unknown, ancestors: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite numbers are not deterministic JSON values')
    return
  }
  if (typeof value !== 'object') throw new TypeError(`unsupported JSON value: ${typeof value}`)
  if (ancestors.has(value)) throw new TypeError('cyclic value')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    throw new TypeError('only plain objects and arrays can be hydrated')
  }
  if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) throw new TypeError('symbol keys are not supported')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError('sparse arrays are not supported')
        assertJsonValue(value[index], ancestors)
      }
      return
    }
    for (const nested of Object.values(value as Record<string, unknown>)) assertJsonValue(nested, ancestors)
  } finally {
    ancestors.delete(value)
  }
}
