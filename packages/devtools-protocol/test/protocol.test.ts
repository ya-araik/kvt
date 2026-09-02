import { describe, expect, it, vi } from 'vitest'
import {
  DiagnosticEventBuffer,
  parseDevtoolsExport,
  serializeDevtoolsExport
} from '../src/index.js'

describe('@kvt/devtools-protocol', () => {
  it('keeps snapshot identity stable until the buffer changes', () => {
    const buffer = new DiagnosticEventBuffer()
    const empty = buffer.snapshot()
    expect(buffer.snapshot()).toBe(empty)
    buffer.clear()
    expect(buffer.snapshot()).toBe(empty)
    buffer.emit({
      protocolVersion: 1,
      sequence: 1,
      timestamp: 1,
      subsystem: 'runtime',
      operation: 'state',
      phase: 'state',
      context: {}
    })
    const populated = buffer.snapshot()
    expect(populated).not.toBe(empty)
    expect(buffer.snapshot()).toBe(populated)
  })

  it('bounds the timeline and redacts unsafe context again at the protocol boundary', () => {
    const buffer = new DiagnosticEventBuffer(1)
    buffer.emit({
      protocolVersion: 1,
      sequence: 1,
      timestamp: 1,
      subsystem: 'query',
      operation: 'fetch',
      phase: 'success',
      context: { queryData: 'secret', count: 2 }
    })
    expect(buffer.snapshot()[0]?.context).toEqual({ queryData: '[redacted]', count: 2 })
    buffer.emit({
      protocolVersion: 1,
      sequence: 2,
      timestamp: 2,
      subsystem: 'runtime',
      operation: 'state',
      phase: 'state',
      context: { state: 'running' }
    })
    expect(buffer.snapshot()).toHaveLength(1)
    expect(buffer.snapshot()[0]?.sequence).toBe(2)
  })

  it('round-trips a frozen, XSS-safe export and rejects malformed events', () => {
    const buffer = new DiagnosticEventBuffer()
    buffer.emit({
      protocolVersion: 1,
      sequence: 1,
      timestamp: 1,
      subsystem: 'module',
      operation: '</script>',
      phase: 'success',
      context: { password: 'secret' }
    })
    const serialized = serializeDevtoolsExport(buffer.export())
    expect(serialized).not.toContain('</script>')
    const parsed = parseDevtoolsExport(serialized)
    expect(parsed.events[0]?.context.password).toBe('[redacted]')
    expect(Object.isFrozen(parsed.events)).toBe(true)
    expect(() => parseDevtoolsExport('{"protocolVersion":1,"exportedAt":1,"events":[{}]}'))
      .toThrow('Invalid DevTools event')
  })

  it('validates capacity and incoming diagnostic event fields', () => {
    for (const capacity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new DiagnosticEventBuffer(capacity)).toThrow(RangeError)
    }
    const buffer = new DiagnosticEventBuffer()
    const base = {
      protocolVersion: 1 as const, sequence: 1, timestamp: 1,
      subsystem: 'runtime' as const, operation: 'state', phase: 'state' as const, context: {}
    }
    expect(() => buffer.emit({ ...base, protocolVersion: 2 as never })).toThrow(TypeError)
    expect(() => buffer.emit({ ...base, sequence: -1 })).toThrow(TypeError)
    expect(() => buffer.emit({ ...base, timestamp: Number.NaN })).toThrow(TypeError)
  })

  it('notifies active listeners on emit and non-empty clear only', () => {
    const buffer = new DiagnosticEventBuffer()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribe = buffer.subscribe(first)
    buffer.subscribe(second)
    buffer.emit({
      protocolVersion: 1, sequence: 0, timestamp: 0, subsystem: 'flow',
      operation: 'subscribe', phase: 'success', context: {}
    })
    unsubscribe()
    buffer.clear()
    buffer.clear()
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledTimes(2)
    expect(buffer.snapshot()).toEqual([])
  })

  it('rejects malformed export envelopes and every event field boundary', () => {
    for (const value of [
      'null', '{}', '{"protocolVersion":2,"exportedAt":1,"events":[]}',
      '{"protocolVersion":1,"exportedAt":"now","events":[]}',
      '{"protocolVersion":1,"exportedAt":1,"events":{}}'
    ]) expect(() => parseDevtoolsExport(value)).toThrow('Unsupported DevTools export')

    const event = { protocolVersion: 1, sequence: 0, timestamp: 0, subsystem: 'runtime', operation: 'state', phase: 'state', context: {} }
    for (const invalid of [
      null,
      { ...event, protocolVersion: 2 },
      { ...event, sequence: -1 },
      { ...event, timestamp: 'now' },
      { ...event, subsystem: 1 },
      { ...event, operation: 1 },
      { ...event, phase: 1 },
      { ...event, context: null }
    ]) {
      expect(() => parseDevtoolsExport(JSON.stringify({ protocolVersion: 1, exportedAt: 1, events: [invalid] })))
        .toThrow('Invalid DevTools event')
    }
  })
})
