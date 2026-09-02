# Observability and DevTools

Diagnostics are versioned events with subsystem, operation, phase and safe
scalar context. Keys suggesting secrets, credentials, tokens, payloads or data
are redacted. Sink failures never change the main operation.

`@kvt/otel` maps events to spans and metrics through OpenTelemetry API only;
applications configure SDKs and exporters. `DiagnosticEventBuffer` bounds and
exports redacted history. The React overlay shows graph metadata and timeline
without service values or query data. Import it dynamically in development.

## Event contract

Every event includes protocol version, sequence, timestamp, subsystem,
operation, phase and redacted context. Common subsystems cover runtime,
providers, scopes, modules/plugins, ViewModels, Flow, router, query and theme.
Event versions change only through an explicit protocol revision.

Context is allowlisted to safe scalar/metadata shapes. Keys that suggest tokens,
authorization, passwords, payload/data or user state are redacted recursively.
Do not place an object merely containing PII under a harmless-looking key; the
application remains responsible for classifying custom diagnostic context.

## Error reporting

Fatal bootstrap/shutdown errors are returned to the host. Subscriber and
observational failures go to `ErrorReporter`. A reporter/sink must be fast and
must never throw into framework behavior; KVT catches it defensively.

`KvtError` provides stable code, subsystem, operation, cause, safe context,
dependency/module/scope path and retryability. Branch on `code`/`retryable`, not
localized message text.

## OpenTelemetry

Instantiate `KvtOtelDiagnosticSink` after the application configures its OTel
provider. The adapter uses `@opentelemetry/api` only and maps lifecycle events to
spans/metrics. Exporter, sampling, resource attributes and transport are host
responsibilities. Propagate trace metadata through `UseCaseContext`; do not put
trace SDK objects into domain models.

## DevTools

```ts
if (import.meta.env.DEV) {
  const { KvtDevtoolsOverlay } = await import('@kvt/devtools-react')
  // Render behind an explicit developer-only switch.
}
```

The overlay displays runtime state, module/plugin graph, feature references,
scope/resource counts, ViewModel leases and redacted event timeline. Retry or
invalidate actions are explicit callbacks supplied by the application.

`DiagnosticEventBuffer` has a finite capacity. Exported JSON is versioned,
normalized and re-redacted on import/export. Never use the overlay as an
authorization boundary or enable it accidentally through a production static
import.
