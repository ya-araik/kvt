import { describe, expect, it } from 'vitest'
import { KvtOtelDiagnosticSink } from '../src/index.js'

describe('@kvt/otel', () => {
  it('maps redacted diagnostics through the API-only no-op provider', () => {
    const sink = new KvtOtelDiagnosticSink({ includeMetrics: true })
    expect(() => sink.emit({
      protocolVersion: 1,
      sequence: 1,
      timestamp: Date.now(),
      subsystem: 'runtime',
      operation: 'bootstrap',
      phase: 'success',
      context: { state: 'running' },
      trace: { traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331', traceFlags: 1 }
    })).not.toThrow()
  })

  it('handles failures, neutral phases, null context and invalid trace parents without metrics', () => {
    const sink = new KvtOtelDiagnosticSink({
      instrumentationName: 'test', instrumentationVersion: '2.0.0', includeMetrics: false
    })
    for (const phase of ['failure', 'state'] as const) {
      expect(() => sink.emit({
        protocolVersion: 1,
        sequence: phase === 'failure' ? 2 : 3,
        timestamp: Date.now(),
        subsystem: 'query',
        operation: 'fetch',
        phase,
        context: { nullable: null },
        trace: { traceId: 'invalid', spanId: 'invalid' }
      })).not.toThrow()
    }
  })
})
