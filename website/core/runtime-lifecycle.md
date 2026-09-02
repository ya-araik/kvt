# Runtime и lifecycle

`KvtRuntime` — корневой владелец запущенного приложения. Он создаётся до UI и
закрывается host-окружением: browser provider, SSR request handler, test harness
или desktop host.

Runtime нужен не для хранения «глобального state», а для ограничения жизни
всего application graph. Через него host получает одну точку bootstrap,
resolution, inspection и гарантированного shutdown.

## Когда создавать runtime

| Host                  |                          Сколько runtime | Кто закрывает                       |
| --------------------- | ---------------------------------------: | ----------------------------------- |
| Browser SPA           |             один на загруженный document | `KvtProvider` на реальном page exit |
| SSR server            |                     один на HTTP request | request handler в `finally`         |
| Unit/integration test |                     один на test/fixture | сам test в `finally`                |
| Micro-frontend        | один на независимую application boundary | host при unload                     |
| Node worker/process   |         один на worker/process lifecycle | signal handler или main task        |

Нельзя создавать новый runtime на каждый React render или делить один SSR
runtime между пользователями. В первом случае появятся дубли ресурсов, во
втором — утечка request-local state.

## Состояния

```ts
type RuntimeState =
  "created" | "starting" | "running" | "shutting-down" | "stopped" | "failed";
```

```text
created → starting → running → shutting-down → stopped
              │                              │
              └──── bootstrap failure ───────┴→ failed
```

Состояние доступно как `runtime.state` и как `runtime.stateFlow`.

## Bootstrap

```ts
const runtime = await bootstrapKvt({
  modules: [appModule],
  plugins: [queryPlugin],
  diagnostics,
  errorReporter,
});
```

Последовательность:

1. Собираются modules, включая modules из plugins.
2. Проверяются ID, versions и requirements.
3. Строится provider registry.
4. До создания resources обнаруживаются missing bindings, duplicates и cycles.
5. Создаётся root scope.
6. Инициализируются eager providers.
7. Plugins запускаются в dependency order.
8. Runtime становится `running`.

Если шаг 6 или 7 падает, runtime делает rollback уже созданных resources.

До шага 6 bootstrap занимается только definitions и validation. Поэтому
missing binding или dependency cycle не должны успеть открыть socket или
подключение к database. Side effects начинаются только после успешной проверки
graph.

## Resolve

```ts
const api = runtime.resolve(apiToken);
const database = await runtime.resolveAsync(databaseToken);
```

`resolve()` используется только для sync graph. Если на dependency path есть
async provider, framework выдаёт `KVT_DI_ASYNC_RESOLVE_REQUIRED`.

Resolve разрешён только в состоянии `running`.

## Shutdown

```ts
await runtime.shutdown({
  reason: "application-stop",
  timeoutMs: 10_000,
});
```

Инварианты shutdown:

- идемпотентен;
- все callers получают один Promise;
- новые resolve/feature/scope operations запрещены;
- child scopes закрываются раньше parents;
- resources закрываются в обратном порядке создания;
- падение одного cleanup не пропускает остальные;
- ошибки возвращаются одним `AggregateError`;
- timeout передаёт cleanup общий aborted `ShutdownContext.signal`.

Shutdown не «откатывает приложение назад» и не возвращает runtime в `created`.
Это terminal transition: после него нужно создать новый runtime. Идемпотентность
означает, что несколько host callbacks могут безопасно вызвать shutdown и
получат один итоговый Promise.

### Как писать host cleanup

```ts
const runtime = await bootstrapKvt({ modules });

try {
  await runHost(runtime);
} finally {
  await runtime.shutdown({ reason: "host-complete", timeoutMs: 10_000 });
}
```

`await` принципиален: без него процесс или test может завершиться раньше
flush/close операций. Если shutdown вернул `AggregateError`, runtime уже
остановлен; error нужно report, а не пытаться продолжить resolve.

## Disposable и Shutdownable

```ts
interface Disposable {
  dispose(): void;
}

interface Shutdownable {
  shutdown(context: ShutdownContext): void | Promise<void>;
}
```

`Disposable` подходит для мгновенной операции: снять listener, отменить timer.
`Shutdownable` — для соединения, worker, очереди или другого async cleanup.

Factory-created object автоматически принадлежит scope, если реализует один из
этих contracts. Внешний ресурс можно зарегистрировать явно:

```ts
scope.own(socket, "notifications-socket");
```

## Browser lifecycle

```tsx
<KvtProvider runtime={runtime}>
  <App />
</KvtProvider>
```

По умолчанию provider:

- вызывает shutdown на non-persisted `pagehide`;
- не вызывает shutdown при React unmount;
- сохраняет runtime при bfcache;
- не реагирует на SPA URL navigation.

Для host, который сам управляет процессом:

```tsx
<KvtProvider runtime={runtime} shutdownOnPageHide={false}>
  <App />
</KvtProvider>
```

Тогда host обязан вызвать awaited shutdown самостоятельно.

## SSR lifecycle

Один HTTP request — один runtime:

```ts
export async function render(request: Request) {
  const runtime = await bootstrapKvt({ modules });
  try {
    return await renderApplication(runtime, request);
  } finally {
    await runtime.shutdown({ reason: "request-complete" });
  }
}
```

Runtime нельзя хранить глобально на SSR server: иначе state и scoped services
могут пересечь границы запросов пользователей.

## Inspection

`runtime.inspect()` возвращает frozen metadata:

- state;
- module/plugin IDs и versions;
- loaded features и reference counts;
- дерево scopes;
- ViewModel owner metadata.

Значения services и пользовательские данные inspection не раскрывает.

## Типичные решения

- Нужен общий API client — зарегистрируйте root singleton, runtime закроет его.
- Нужен request-local cache — создавайте request runtime или child scope.
- Нужен screen state — используйте route ViewModel owner, не root runtime.
- Нужен повторный запуск приложения после logout — сначала полностью закройте
  старый runtime, затем bootstrap новый application graph.

Следующая глава: [Dependency Injection](/core/dependency-injection).
