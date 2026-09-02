import { MutableStateFlow } from '@kvt/flow'
import { describe, expect, it } from 'vitest'
import {
  createHydrationRegistry,
  createHydrationState,
  parseHydrationState,
  serializeHydrationState,
  type HydrationState
} from '../src/index.js'

const entry = (key: string, value: unknown) => ({
  key, flow: new MutableStateFlow(value), serialize: (current: unknown) => current
})

describe('hydration serialization contract', () => {
  it('creates frozen null-prototype state and rejects duplicate/unsafe keys', () => {
    const state = createHydrationState([entry('user:1.profile', { id: 1 })])
    expect(state).toEqual({ version: 1, states: { 'user:1.profile': { id: 1 } } })
    expect(Object.getPrototypeOf(state.states)).toBeNull()
    expect(Object.isFrozen(state.states)).toBe(true)
    expect(() => createHydrationState([entry('same', 1), entry('same', 2)])).toThrow('Duplicate hydration')
    for (const key of ['', '-bad', 'bad key', '__proto__', 'constructor', 'prototype']) {
      expect(() => createHydrationState([entry(key, 1)])).toThrow('Invalid hydration state key')
      expect(() => createHydrationRegistry().read(key, Number)).toThrow('Invalid hydration state key')
    }
  })

  it('round-trips every JSON value and escapes all HTML/script separators', () => {
    const nullPrototype = Object.create(null) as Record<string, unknown>
    nullPrototype.safe = true
    const state = createHydrationState([
      entry('values', [null, 'text', true, false, 0, { nested: nullPrototype }]),
      entry('html', '<script>&>\u2028\u2029')
    ])
    const serialized = serializeHydrationState(state)
    expect(serialized).not.toContain('<script>')
    expect(serialized).not.toContain('&')
    expect(serialized).toContain('\\u003c')
    expect(serialized).toContain('\\u003e')
    expect(serialized).toContain('\\u0026')
    expect(serialized).toContain('\\u2028')
    expect(serialized).toContain('\\u2029')
    expect(parseHydrationState(serialized)).toEqual(state)
  })

  it('supports empty registries, has/read and deserializers', () => {
    const empty = createHydrationRegistry()
    expect(empty.has('missing')).toBe(false)
    expect(empty.read('missing', Number)).toBeUndefined()
    const registry = createHydrationRegistry({ version: 1, states: { answer: '42' } })
    expect(registry.has('answer')).toBe(true)
    expect(registry.read('answer', (value) => Number(value))).toBe(42)
  })

  it('rejects malformed parsed and in-memory envelopes', () => {
    for (const serialized of ['null', '1', '"value"']) {
      expect(() => parseHydrationState(serialized)).toThrow(new TypeError('Hydration state must be an object'))
    }
    for (const serialized of [
      '{"version":2,"states":{}}',
      '{"version":1,"states":"invalid"}',
      '{"version":1,"states":null}',
      '{"version":1,"states":[]}'
    ]) expect(() => parseHydrationState(serialized)).toThrow(new TypeError('Invalid KVT hydration state'))

    for (const state of [
      { version: 2, states: {} },
      { version: 1, states: 'invalid' },
      { version: 1, states: null },
      { version: 1, states: [] }
    ]) expect(() => createHydrationRegistry(state as never)).toThrow(
      `Unsupported or invalid hydration state version: ${String(state.version)}`
    )
  })

  it('rejects every nondeterministic or non-plain nested value with a cause', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const symbolKey = { normal: true } as Record<PropertyKey, unknown>
    symbolKey[Symbol('secret')] = true
    const sparse = new Array(2); sparse[1] = 'present'
    const invalid = [
      Number.NaN, Infinity, undefined, 1n, Symbol('value'), () => undefined,
      cyclic, new Date(), symbolKey, sparse
    ]
    for (const value of invalid) {
      try {
        createHydrationState([entry('invalid', value)])
        throw new Error('expected rejection')
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError)
        expect((error as Error).message).toContain('not JSON serializable')
        expect((error as Error & { cause?: unknown }).cause).toBeDefined()
      }
    }

    const unsupported = [undefined, 1n, Symbol('value'), () => undefined]
    for (const value of unsupported) {
      try {
        createHydrationState([entry('unsupported', value)])
        throw new Error('expected rejection')
      } catch (error) {
        expect((error as Error & { cause?: Error }).cause?.message).toBe(`unsupported JSON value: ${typeof value}`)
      }
    }
    try {
      createHydrationState([entry('sparse', sparse)])
      throw new Error('expected rejection')
    } catch (error) {
      expect((error as Error & { cause?: Error }).cause?.message).toBe('sparse arrays are not supported')
    }

    const shared: Record<string, unknown> = { stable: true }
    expect(createHydrationState([entry('shared', { left: shared, right: shared })]).states.shared)
      .toEqual({ left: { stable: true }, right: { stable: true } })
  })

  it('normalizes externally supplied values and rejects unsafe nested state keys', () => {
    const external = {
      version: 1,
      states: { safe: { nested: [1, 2, 3] } }
    } satisfies HydrationState
    const parsed = createHydrationRegistry(external)
    expect(parsed.read('safe', (value) => value)).toEqual({ nested: [1, 2, 3] })
    expect(() => parseHydrationState('{"version":1,"states":{"prototype":1}}')).toThrow('Invalid hydration state key')
  })
})
