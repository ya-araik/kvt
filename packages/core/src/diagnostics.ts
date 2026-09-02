import { redactKvtContext } from './errors.js'

export const KVT_DIAGNOSTICS_PROTOCOL_VERSION = 1 as const

export interface TraceContext {
  readonly traceId?: string
  readonly spanId?: string
  readonly traceFlags?: number
}

export type DiagnosticSubsystem =
  | 'runtime'
  | 'provider'
  | 'scope'
  | 'module'
  | 'plugin'
  | 'view-model'
  | 'flow'
  | 'router'
  | 'query'
  | 'theme'

export interface DiagnosticEvent {
  readonly protocolVersion: typeof KVT_DIAGNOSTICS_PROTOCOL_VERSION
  readonly sequence: number
  readonly timestamp: number
  readonly subsystem: DiagnosticSubsystem
  readonly operation: string
  readonly phase: 'start' | 'success' | 'failure' | 'state' | 'metric'
  readonly context: Readonly<Record<string, string | number | boolean | null>>
  readonly trace?: TraceContext
}

export interface DiagnosticSink {
  emit(event: DiagnosticEvent): void
}

export interface ErrorReport {
  readonly error: unknown
  readonly subsystem: DiagnosticSubsystem
  readonly operation: string
  readonly context: Readonly<Record<string, string | number | boolean | null>>
}

export interface ErrorReporter {
  report(report: ErrorReport): void
}

export function redactDiagnosticContext(
  context: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, string | number | boolean | null>> {
  return redactKvtContext(context)
}

export class Diagnostics {
  #sequence = 0
  readonly #sink: DiagnosticSink | undefined

  constructor(sink?: DiagnosticSink) {
    this.#sink = sink
  }

  emit(
    subsystem: DiagnosticSubsystem,
    operation: string,
    phase: DiagnosticEvent['phase'],
    context?: Readonly<Record<string, unknown>>,
    trace?: TraceContext
  ): void {
    if (!this.#sink) return
    const event: DiagnosticEvent = Object.freeze({
      protocolVersion: KVT_DIAGNOSTICS_PROTOCOL_VERSION,
      sequence: ++this.#sequence,
      timestamp: Date.now(),
      subsystem,
      operation,
      phase,
      context: redactDiagnosticContext(context),
      ...(trace === undefined ? {} : { trace: Object.freeze({ ...trace }) })
    })
    try {
      this.#sink.emit(event)
    } catch {
      // Diagnostics must not alter the observed operation.
    }
  }
}
