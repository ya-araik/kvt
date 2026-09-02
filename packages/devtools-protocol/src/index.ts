import { redactDiagnosticContext, type DiagnosticEvent, type DiagnosticSink } from '@kvt/core'

export const KVT_DEVTOOLS_PROTOCOL_VERSION = 1 as const

export interface DevtoolsEvent {
  readonly protocolVersion: typeof KVT_DEVTOOLS_PROTOCOL_VERSION
  readonly sequence: number
  readonly timestamp: number
  readonly subsystem: string
  readonly operation: string
  readonly phase: string
  readonly context: Readonly<Record<string, string | number | boolean | null>>
}

export interface DevtoolsExport {
  readonly protocolVersion: typeof KVT_DEVTOOLS_PROTOCOL_VERSION
  readonly exportedAt: number
  readonly events: readonly DevtoolsEvent[]
}

export class DiagnosticEventBuffer implements DiagnosticSink {
  readonly #capacity: number
  readonly #events: DevtoolsEvent[] = []
  readonly #listeners = new Set<() => void>()
  #snapshot: readonly DevtoolsEvent[] = Object.freeze([])

  constructor(capacity = 2_000) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError('capacity must be a positive safe integer')
    this.#capacity = capacity
  }

  emit(event: DiagnosticEvent): void {
    if (event.protocolVersion !== 1 || !Number.isSafeInteger(event.sequence) || event.sequence < 0
      || !Number.isFinite(event.timestamp)) throw new TypeError('Invalid diagnostic event')
    this.#events.push(Object.freeze({
      protocolVersion: KVT_DEVTOOLS_PROTOCOL_VERSION,
      sequence: event.sequence,
      timestamp: event.timestamp,
      subsystem: event.subsystem,
      operation: event.operation,
      phase: event.phase,
      context: redactDiagnosticContext(event.context)
    }))
    if (this.#events.length > this.#capacity) this.#events.splice(0, this.#events.length - this.#capacity)
    this.#snapshot = Object.freeze([...this.#events])
    for (const listener of [...this.#listeners]) listener()
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  readonly snapshot = (): readonly DevtoolsEvent[] => this.#snapshot

  export(): DevtoolsExport {
    return Object.freeze({
      protocolVersion: KVT_DEVTOOLS_PROTOCOL_VERSION,
      exportedAt: Date.now(),
      events: this.snapshot()
    })
  }

  clear(): void {
    if (this.#events.length === 0) return
    this.#events.length = 0
    this.#snapshot = Object.freeze([])
    for (const listener of [...this.#listeners]) listener()
  }
}

export function serializeDevtoolsExport(value: DevtoolsExport): string {
  return JSON.stringify(normalizeExport(value)).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}

export function parseDevtoolsExport(value: string): DevtoolsExport {
  const parsed: unknown = JSON.parse(value)
  return normalizeExport(parsed)
}

function normalizeExport(value: unknown): DevtoolsExport {
  if (!isRecord(value) || value.protocolVersion !== KVT_DEVTOOLS_PROTOCOL_VERSION
    || !Number.isFinite(value.exportedAt) || !Array.isArray(value.events)) {
    throw new TypeError('Unsupported DevTools export')
  }
  const events = value.events.map((event): DevtoolsEvent => {
    if (!isRecord(event) || event.protocolVersion !== KVT_DEVTOOLS_PROTOCOL_VERSION
      || !Number.isSafeInteger(event.sequence) || (event.sequence as number) < 0
      || !Number.isFinite(event.timestamp) || typeof event.subsystem !== 'string'
      || typeof event.operation !== 'string' || typeof event.phase !== 'string' || !isRecord(event.context)) {
      throw new TypeError('Invalid DevTools event')
    }
    return Object.freeze({
      protocolVersion: KVT_DEVTOOLS_PROTOCOL_VERSION,
      sequence: event.sequence as number,
      timestamp: event.timestamp as number,
      subsystem: event.subsystem,
      operation: event.operation,
      phase: event.phase,
      context: redactDiagnosticContext(event.context)
    })
  })
  return Object.freeze({
    protocolVersion: KVT_DEVTOOLS_PROTOCOL_VERSION,
    exportedAt: value.exportedAt as number,
    events: Object.freeze(events)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
