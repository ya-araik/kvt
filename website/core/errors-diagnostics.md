# Ошибки и diagnostics

KVT разделяет **операционную ошибку**, которую получает caller, и
**наблюдение**, которое уходит в diagnostics/error reporter.

Это три разных канала:

| Канал                        | Кто читает                          | Для чего                                       |
| ---------------------------- | ----------------------------------- | ---------------------------------------------- |
| `Result` / thrown `KvtError` | вызывающий код                      | выбрать следующую ветку выполнения             |
| `DiagnosticSink`             | DevTools, trace exporter, debug log | увидеть ход и длительность операций            |
| `ErrorReporter`              | monitoring host                     | не потерять ошибки фоновых callbacks и cleanup |

Одна проблема может пройти по нескольким каналам, но они не заменяют друг
друга. Например, failed feature load возвращает ошибку navigation caller и
одновременно оставляет redacted diagnostic event.

## KvtError

```ts
class KvtError extends Error {
  readonly code: string;
  readonly subsystem: KvtSubsystem;
  readonly operation: string;
  readonly context: Readonly<Record<string, string | number | boolean | null>>;
  readonly path: readonly string[];
  readonly retryable: boolean;
}
```

Стабильный `code` подходит для программной обработки и тестов. Message — для
человека и может становиться подробнее.

```ts
try {
  runtime.resolve(serviceToken);
} catch (error) {
  if (isKvtError(error) && error.code === "KVT_DI_PROVIDER_MISSING") {
    // показать configuration error
  }
}
```

## Safe context

Context автоматически redacted. Keys вроде `token`, `password`, `secret`,
`cookie`, `payload`, `body`, `data` и `value` не сохраняют исходное значение.

Objects и arrays превращаются в безопасное описание типа. Diagnostics не
предназначена для логирования query data или application state.

## DiagnosticSink

```ts
interface DiagnosticSink {
  emit(event: DiagnosticEvent): void;
}
```

Event содержит:

- protocol version;
- monotonic sequence;
- timestamp;
- subsystem и operation;
- phase (`start`, `success`, `failure`, `state`, `metric`);
- redacted primitive context;
- optional trace context.

```ts
const runtime = await bootstrapKvt({
  modules,
  diagnostics: {
    emit(event) {
      diagnosticBuffer.push(event);
    },
  },
});
```

Sink observational: если его `emit()` бросит exception, основная операция не
сломается.

## ErrorReporter

Некоторые ошибки нельзя вернуть caller напрямую: например listener StateFlow
упал во время fan-out или background browser shutdown завершился ошибкой. Для
этого используется reporter:

```ts
const runtime = await bootstrapKvt({
  errorReporter: {
    report({ error, subsystem, operation, context }) {
      monitoring.capture(error, { subsystem, operation, context });
    },
  },
});
```

Reporter также fail-soft.

## Как ошибка проходит через приложение

Рассмотрим неуспешную загрузку lazy feature:

1. Loader бросает исходную infrastructure error.
2. Runtime добавляет безопасный context и создаёт стабильный `KvtError`.
3. Navigation caller получает ошибку и решает, показать retry UI или redirect.
4. Diagnostic sink получает событие `failure` для timeline.
5. Если ошибка возникла уже в detached cleanup, её получает `ErrorReporter`,
   потому что активного caller больше нет.

Логируйте ошибку один раз на границе, где принято решение. Повторный
`console.error` в repository, use case, ViewModel и React boundary обычно
создаёт четыре одинаковые записи без дополнительного контекста.

## AggregateError на shutdown

Cleanup должен попытаться закрыть всё. Поэтому caller может получить:

```ts
try {
  await runtime.shutdown({ reason: "stop" });
} catch (error) {
  if (error instanceof AggregateError) {
    for (const cleanupError of error.errors) report(cleanupError);
  }
}
```

Это не означает, что runtime продолжает работать. Он уже в terminal state.

## Что логировать приложению

Разрешено:

- module/plugin ID и version;
- scope ID;
- operation name;
- retry count;
- duration;
- stable error code.

Нельзя по умолчанию:

- access tokens;
- HTTP bodies;
- query result;
- profile/user state;
- resolved service objects.

OpenTelemetry и DevTools используют тот же redacted protocol. Подробнее:
[Observability](/operations/observability).

## Что показывать пользователю

Не выводите `KvtError.message` напрямую как product copy. UI должен сопоставить
domain failure или стабильный error code с локализованным сообщением, а
технические `path`, `operation` и context оставить diagnostics. Для неизвестной
ошибки используйте общий fallback и correlation/trace ID, если host его
предоставляет.
