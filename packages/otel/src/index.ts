import type { DiagnosticEvent, DiagnosticSink } from '@kvt/core'
import {
  context,
  isSpanContextValid,
  metrics,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes
} from '@opentelemetry/api'

export interface KvtOtelOptions {
  readonly instrumentationName?: string
  readonly instrumentationVersion?: string
  readonly includeMetrics?: boolean
}

export class KvtOtelDiagnosticSink implements DiagnosticSink {
  readonly #tracer
  readonly #counter

  constructor(options: KvtOtelOptions = {}) {
    const name = options.instrumentationName ?? '@kvt/otel'
    this.#tracer = trace.getTracer(name, options.instrumentationVersion ?? '1.0.0')
    this.#counter = options.includeMetrics === false
      ? undefined
      : metrics.getMeter(name, options.instrumentationVersion ?? '1.0.0').createCounter('kvt.diagnostic.events')
  }

  emit(event: DiagnosticEvent): void {
    const attributes: Attributes = {
      'kvt.subsystem': event.subsystem,
      'kvt.operation': event.operation,
      'kvt.phase': event.phase,
      'kvt.sequence': event.sequence,
      ...Object.fromEntries(Object.entries(event.context).map(([key, value]) => [`kvt.context.${key}`, value ?? '[null]']))
    }
    this.#counter?.add(1, attributes)
    const spanContext = event.trace?.traceId && event.trace.spanId ? {
      traceId: event.trace.traceId,
      spanId: event.trace.spanId,
      traceFlags: event.trace.traceFlags ?? TraceFlags.NONE,
      isRemote: true
    } : undefined
    const parentContext = spanContext && isSpanContextValid(spanContext)
      ? trace.setSpanContext(context.active(), spanContext)
      : context.active()
    const span = this.#tracer.startSpan(`kvt.${event.subsystem}.${event.operation}`, {
      attributes,
      startTime: event.timestamp
    }, parentContext)
    if (event.phase === 'failure') span.setStatus({ code: SpanStatusCode.ERROR })
    else if (event.phase === 'success') span.setStatus({ code: SpanStatusCode.OK })
    span.end(event.timestamp)
  }
}
