import type { StateFlow } from '@kvt/flow'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useKvtContext } from './context.js'

export interface StateFlowSelectionOptions<T, S> {
  readonly selector?: (value: T) => S
  readonly equality?: (left: S, right: S) => boolean
  readonly stateKey?: string
  readonly deserialize?: (value: unknown) => T
}

const identity = <T,>(value: T): T => value

class SelectedStateStore<T, S> {
  readonly #flow: StateFlow<T>
  readonly #selector: (value: T) => S
  readonly #equality: (left: S, right: S) => boolean
  readonly #stateKey: string | undefined
  #initialized = false
  #selection!: S

  constructor(flow: StateFlow<T>, selector: (value: T) => S, equality: (left: S, right: S) => boolean, stateKey?: string) {
    this.#flow = flow
    this.#selector = selector
    this.#equality = equality
    this.#stateKey = stateKey
  }

  readonly getSnapshot = (): S => this.select(this.#flow.value)

  readonly subscribe = (notify: () => void) => {
    let previous = this.select(this.#flow.value)
    const subscription = this.#flow.subscribe((value) => {
      const next = this.select(value)
      if (!this.#equality(previous, next)) {
        previous = next
        notify()
      }
    }, { emitCurrent: false })
    return () => subscription.cancel()
  }

  select(value: T): S {
    assertImmutableSnapshot(value, this.#stateKey)
    const next = this.#selector(value)
    if (!this.#initialized || !this.#equality(this.#selection, next)) {
      this.#initialized = true
      this.#selection = next
    }
    return this.#selection
  }
}

export function useStateFlow<T>(flow: StateFlow<T>): T
export function useStateFlow<T, S>(flow: StateFlow<T>, options: StateFlowSelectionOptions<T, S>): S
export function useStateFlow<T, S = T>(flow: StateFlow<T>, options: StateFlowSelectionOptions<T, S> = {}): S {
  const { hydration } = useKvtContext()
  const selector = options.selector ?? (identity as (value: T) => S)
  const equality = options.equality ?? Object.is
  const selectedStore = useMemo(
    () => new SelectedStateStore(flow, selector, equality, options.stateKey),
    [equality, flow, options.stateKey, selector]
  )
  const checkedHydrationKey = useRef<string | undefined>(undefined)
  const getServerSnapshot = useCallback(() => {
    if (!options.stateKey) return selectedStore.select(flow.value)
    const hydrated = hydration.read(options.stateKey, options.deserialize ?? ((value) => value as T))
    return selectedStore.select(hydrated ?? flow.value)
  }, [flow, hydration, options.deserialize, options.stateKey, selectedStore])
  const value = useSyncExternalStore(selectedStore.subscribe, selectedStore.getSnapshot, getServerSnapshot)
  useEffect(() => {
    const key = options.stateKey
    if (!key || checkedHydrationKey.current === key || !hydration.has(key)) return
    checkedHydrationKey.current = key
    const hydrated = hydration.read(key, options.deserialize ?? ((entry) => entry as T))
    if (hydrated !== undefined && !equality(selector(hydrated), selector(flow.value))) {
      throw new Error(`KVT hydration mismatch for StateFlow key "${key}"`)
    }
  }, [equality, flow, hydration, options.deserialize, options.stateKey, selector])
  return value
}

interface ShallowSnapshot {
  readonly keys: readonly PropertyKey[]
  readonly values: readonly unknown[]
}

const developmentSnapshots = new WeakMap<object, ShallowSnapshot>()

function assertImmutableSnapshot(value: unknown, stateKey?: string): void {
  const environment = (globalThis as { readonly process?: { readonly env?: { readonly NODE_ENV?: string } } }).process?.env?.NODE_ENV
  if (environment === 'production' || typeof value !== 'object' || value === null) return
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return
  const keys = Reflect.ownKeys(value)
  const values = keys.map((key) => Reflect.get(value, key))
  const previous = developmentSnapshots.get(value)
  if (previous && (previous.keys.length !== keys.length || keys.some((key, index) => key !== previous.keys[index]
    || !Object.is(values[index], previous.values[index])))) {
    throw new Error(`KVT StateFlow snapshot was mutated without changing identity${stateKey ? ` (state key "${stateKey}")` : ''}`)
  }
  if (!previous) developmentSnapshots.set(value, { keys: Object.freeze(keys), values: Object.freeze(values) })
}
