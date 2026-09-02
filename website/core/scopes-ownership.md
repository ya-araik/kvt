# Scopes и ownership

Scope — контейнер с ограниченным временем жизни. Он одновременно:

- задаёт границу для scoped providers;
- хранит созданные owned resources;
- создаёт child scopes;
- гарантирует ordered cleanup.

Scope нужен, когда часть object graph должна жить меньше root runtime. Типичные
границы: HTTP request, lazy feature, background job или ViewModel. Для обычного
React route ручной scope не создаётся — Router и ViewModel owner делают это
автоматически.

## Сначала определите владельца

До выбора `.singleton()`/`.scoped()` сформулируйте полезный lifetime ресурса.
Например, WebSocket уведомлений может принадлежать всему runtime, transaction —
одному request scope, а draft editor — route ViewModel. Scope является
технической реализацией этой границы, но не заменяет само архитектурное решение.

## Дерево scopes

```ts
const requestScope = runtime.rootScope.createChild({ id: "request-42" });
const screenScope = requestScope.createChild({ id: "users-screen" });
```

```text
root
└── request-42
    └── users-screen
```

Закрытие `request-42` сначала закроет `users-screen`, затем собственные
resources request scope.

## Scoped provider

```ts
const session = createToken<Session>("session");

bind(Session).scoped();
```

Два resolve в одном scope возвращают один instance. Resolve из двух разных
child scopes возвращает разные instances.

```text
request A scope → Session A, UnitOfWork A
request B scope → Session B, UnitOfWork B
root scope      → общий Logger
```

Так request-local данные не пересекаются, хотя descriptor providers объявлен в
одном parent module.

## Singleton и child override

Root singleton создаётся и живёт в registry owner scope. Его dependencies также
root-level. Это не позволяет одному child override изменить уже общий singleton.

Scoped и transient provider разрешает dependencies относительно requesting
child scope, поэтому feature/test override работает внутри этой ветки.

## Внешний resource

```ts
const subscription = events.subscribe(handleEvent);
scope.own(subscription, "server-events");
```

`own()` возвращает тот же объект для удобного присваивания и не регистрирует
один identity дважды.

## ShutdownContext

```ts
interface ShutdownContext {
  signal: AbortSignal;
  reason: string;
  deadline: number | undefined;
}
```

Resource должен:

- завершать новую работу после abort;
- быть безопасным при частичном старте;
- не игнорировать deadline для долгого network cleanup;
- не предполагать, что соседний resource уже жив.

## Ownership не равен доступу

Component может **пользоваться** repository, но обычно не владеет им. Scope
может владеть repository, а несколько ViewModel — временно использовать его.

Не закрывайте dependency вручную, если её создал DI factory. Иначе scope позже
попытается закрыть уже уничтоженный объект.

Простой критерий: consumer вызывает методы ресурса, owner вызывает его
`dispose()`/`shutdown()`. Эти роли могут находиться в разных объектах.

## Канонические владельцы

| Resource           | Владелец               | Момент закрытия                   |
| ------------------ | ---------------------- | --------------------------------- |
| Root API/DB client | runtime root scope     | application shutdown              |
| Feature repository | feature scope          | последний feature handle released |
| Route state        | route feature/owner    | последний active match ушёл       |
| ViewModel          | ViewModel owner        | owner boundary закрылась          |
| Flow subscription  | caller/ViewModel/scope | cancel или owner shutdown         |
| Query observer     | query client/scope     | observer dispose/scope shutdown   |
| Theme layer        | ThemeProvider cleanup  | provider unmount                  |

## Inspection и leaks

```ts
const tree = runtime.rootScope.inspect();
```

Inspection показывает child count и owned resource labels, но не значения.
После корректного shutdown ожидаются нулевые `childCount` и
`ownedResourceCount`.

Testing SDK предоставляет leak assertions, чтобы это проверял CI.

## Антипаттерны

### Глобальный mutable singleton

Module-level `let currentApi` не принадлежит runtime и переживает тесты/SSR
requests. Зарегистрируйте сервис singleton provider.

### Один объект в двух factories

Оба scopes посчитают себя владельцами и дважды вызовут cleanup. Внешний общий
object передавайте через `provide(Config).value(config)`.

### Child scope без shutdown

Ручной `createChild()` требует явного `await child.shutdown(context)`. Для route
и ViewModel используйте готовые owners, которые делают это автоматически.

## Шаблон ручного scope

```ts
const scope = runtime.rootScope.createChild({ id: `job:${jobId}` });

try {
  const job = await scope.resolveAsync(JobRunner);
  await job.run();
} finally {
  await scope.shutdown({
    reason: "job-complete",
    signal: new AbortController().signal,
    deadline: undefined,
  });
}
```

Если у кода нет надёжного `finally`, ручной scope почти наверняка выбран
неудачно. Используйте host/feature/route abstraction, которая владеет cleanup.
