# DevTools и OpenTelemetry

Все observability adapters получают redacted `DiagnosticEvent`. Они наблюдают
framework, но не меняют operation result.

Observability отвечает на вопросы «что происходило с lifecycle?» и «где
потеряно время?». Это не аудит product data и не способ читать StateFlow
пользователя. Framework намеренно экспортирует metadata операций, а не payload.

## С чего начать

| Среда                | Минимальная настройка                              |
| -------------------- | -------------------------------------------------- |
| Локальная разработка | bounded buffer + DevTools overlay                  |
| Unit tests           | in-memory sink с assertions на нужные events       |
| Browser production   | sampled OTel sink и error reporter                 |
| Node/SSR             | request trace + OTLP exporter, настроенный host-ом |

Diagnostic sink показывает нормальный ход операций. Error reporter отдельно
получает ошибки detached listeners/cleanup, которые некому вернуть как result.

## Diagnostic buffer

```ts
const events = new DiagnosticEventBuffer(2_000);

const runtime = await bootstrapKvt({
  modules,
  diagnostics: events,
});
```

Buffer bounded: при переполнении удаляются старые events. Snapshot identity
стабильна между изменениями и подходит `useSyncExternalStore`.

Размер выбирайте по времени диагностики, а не «чем больше, тем лучше». Для
overlay обычно достаточно последних нескольких тысяч событий; production trace
следует экспортировать и sample-ить, а не бесконечно хранить в browser memory.

## DevTools overlay

Подключайте только development dynamic import:

```ts
if (import.meta.env.DEV) {
  const { KvtDevtoolsOverlay } = await import("@kvt/devtools-react");
  // отрендерить overlay рядом с App
}
```

Overlay показывает:

- runtime/root scope state;
- scope tree и resource counts;
- modules/plugins/features;
- ViewModel state и lease counts;
- redacted timeline;
- optional retry feature/invalidate query actions.

Он не показывает service values или query data.

## Export diagnostics

```ts
const serialized = serializeDevtoolsExport(events.export());
const imported = parseDevtoolsExport(serialized);
```

Export versioned и повторно redacted. Serialization XSS-safe для встраивания.

## OpenTelemetry

```ts
import { KvtOtelDiagnosticSink } from "@kvt/otel";

const diagnostics = new KvtOtelDiagnosticSink({
  instrumentationName: "my-app",
  instrumentationVersion: "1.0.0",
  includeMetrics: true,
});
```

Adapter использует только `@opentelemetry/api`. Exporter/SDK настраивает
application:

- browser app может выбрать web exporter;
- Node service — OTLP SDK;
- test — no-op provider.

KVT не устанавливает global OTel provider.

## Trace propagation

`UseCaseContext.trace` и `DiagnosticEvent.trace` переносят trace/span IDs без
зависимости domain layer от SDK.

Host создаёт trace на входной границе — HTTP request, navigation или background
job — и передаёт context use case. Repository может продолжить trace в сетевой
adapter, при этом domain types не импортируют OpenTelemetry API.

## Metrics

OTel sink может увеличивать `kvt.diagnostic.events` с attributes subsystem,
operation и phase. Не добавляйте high-cardinality user/entity IDs в context.

## Production rules

- DevTools overlay только explicit dynamic import;
- bounded buffers;
- никакого query/state payload;
- reporter/sink failures не должны ломать feature;
- secret redaction проверяется тестом;
- sampling/export policy принадлежит application.

## Как расследовать lifecycle проблему

1. Найдите failure или неожиданное state event по operation.
2. По trace/context восстановите связанный runtime, scope и feature.
3. Сравните start/success/failure и проверьте, есть ли terminal cleanup.
4. Посмотрите resource count после route/request exit.
5. Только после этого добавляйте более подробный безопасный context в точке,
   которой не хватает.

Не добавляйте entity ID как metric label: это создаёт high cardinality. Для
поиска конкретного запроса используйте sampled trace/correlation ID, а metrics
оставляйте агрегированными по subsystem, operation и phase.
