# Todo Showcase: несколько источников данных без скрытой магии

Исходники: [`examples/react-app`](https://github.com/ya-araik/kvt/tree/main/examples/react-app).
Это полноценная SPA с JSON Server, IndexedDB, offline outbox, lazy KVT feature,
темами и browser E2E.

::: warning Showcase — не template
`create-kvt spa` остаётся маленьким in-memory Todo. Он нужен, чтобы сначала
понять domain → use case → ViewModel → React. Showcase показывает следующий
этап: явную координацию network и local data sources.
:::

## Запуск

```bash
npm install
npm run dev -w @kvt/example
```

Откройте `http://localhost:5173`. Vite проксирует `/api` на локальный JSON
Server. Runtime DB можно вернуть к seed:

```bash
npm run server:reset -w @kvt/example
```

Seed содержит 200 todos и 10 users. Публичный JSONPlaceholder используется
только как источник модели и seed; локальный `json-server@1.0.0-beta.15`
реально сохраняет CRUD.

## Showcase и template

|             | `create-kvt spa`    | `examples/react-app`                      |
| ----------- | ------------------- | ----------------------------------------- |
| Данные      | In-memory           | JSON Server + IndexedDB + outbox          |
| Архитектура | Один repository     | Отдельные network/local repositories      |
| Flow        | StateFlow ViewModel | Cold cache-first Flow + StateFlow screen  |
| Routes      | Todo и About        | Todos, lazy Insights, lazy Settings       |
| UI          | Минимальный         | Responsive CRUD, filters, states и темы   |
| Тесты       | Базовые             | Unit, integration, router и 3-browser E2E |

## Repository — один источник

Главное правило example: repository не агрегирует источники.

```text
HttpTodoRepository
  └─ JSON Server → TodoDto validation → mapper → domain port

IndexedDbLocalTodoRepository
  └─ IDB DTO pages/outbox ↔ mapper ↔ domain port

Observe/Add/Update/... UseCase
  └─ выбирает порядок domain repositories, не импортируя data
```

Контракты разделены явно:

| Domain port             | Domain contract                               |
| ----------------------- | --------------------------------------------- |
| `NetworkTodoRepository` | `TodoPage`, `Todo`, domain mutation inputs    |
| `LocalTodoRepository`   | cached `TodoPage`, `Todo` и pending mutations |
| `NetworkUserRepository` | получить `User[]`                             |
| `LocalUserRepository`   | сохранить и наблюдать domain users snapshot   |

Use cases зависят от ports из `domain/repository` и получают только domain
models. Data implementation внутри работает с DTO; `data/mapper` переводит DTO
в domain перед возвратом через port. Обратного dependency `domain → data` нет.

## Read path: cache, затем network

`ObserveTodosUseCase.execute(criteria)` возвращает cold Flow. При collection:

1. use case подписывается на `LocalTodoRepository.observe(criteria)`;
2. `local.load()` поднимает IndexedDB page;
3. local implementation мапит DTO page, Flow публикует stale domain state;
4. `network.list()` возвращает актуальный domain page;
5. use case вызывает `local.savePage()`;
6. Flow публикует fresh domain state.

```text
ViewModel
  └─ collect ObserveTodosUseCase
       ├─ LocalTodoRepository.load  → cached TodoFeedState
       └─ NetworkTodoRepository.list
            └─ LocalTodoRepository.savePage
                 └─ fresh TodoFeedState
```

Выбор источника находится в use case и читается сверху вниз. Ни HTTP
repository, ни IndexedDB repository не знают друг о друге.

## Write path и offline outbox

Mutation use case сначала применяет изменение к local repository, чтобы UI
сразу получил новый cache state.

```text
AddTodoUseCase
  1. validate input
  2. local.create(optimisticTodo)
  3a. online  → network.create → local.replaceId
  3b. offline → local.enqueue(createMutation)
  3c. server contract failure → local rollback → typed failure
  4. return Todo
```

Update, toggle и delete используют ту же понятную policy. Network failure — это
не ошибка пользователя: изменение остаётся локально и попадает в outbox.
Invalid DTO или HTTP 4xx/5xx не маскируется под offline — use case откатывает
optimistic state.

Когда browser сообщает `online`, plugin запускает
`SyncPendingTodosUseCase`. Он последовательно отправляет outbox в network
repository, обновляет local repository, удаляет завершённые операции и
refresh-ит активные feeds. При повторном network failure очередь остаётся в
IndexedDB.

## DTO boundary

HTTP adapter возвращает `unknown`. Repository обязан вызвать runtime parser:

```ts
const raw: unknown = await this.http.request(path, { signal });
const dto = parsePagedTodoDto(raw);
return ok(mapTodoPageDtoToDomain(dto, criteria.pageSize));
```

Use case получает domain model и координирует repositories без imports из
`data`:

```ts
const result = await this.network.list(criteria, signal);
if (result.ok) {
  await this.local.savePage(criteria, result.value);
}
```

Строковые ID, pagination envelope и все обязательные поля проверяются до
domain/presentation слоя.

## Почему здесь нет Query

`@kvt/query` остаётся частью framework и подробно описан в
[Query и server state](/application/query). Он подходит для renderer-neutral
server cache, freshness, deduplication и invalidation.

В Showcase product policy требует двух явных repositories и offline outbox.
Query здесь делал бы orchestration менее очевидной: cache, HTTP и optimistic
logic снова оказались бы за одним repository. Поэтому этот example показывает
альтернативу — Cold Flow и use-case aggregation. Это выбор конкретного
сценария, а не запрет на `@kvt/query`.

## Composition root

```text
browser-data plugin/module
  ├─ BrowserConnectivity
  ├─ ShowcaseDatabase
  ├─ LocalTodoRepository → IndexedDbLocalTodoRepository
  └─ LocalUserRepository → IndexedDbLocalUserRepository

infrastructure module
  └─ config + JsonServerHttpClient

todo module
  ├─ domain ports → concrete network repositories
  ├─ observe/mutation/sync use cases
  └─ route-owned TodoListViewModel
```

Plugin устанавливает `online/offline/focus/visibilitychange` listeners. На
`online` он запускает sync use case, на focus — sync и refresh. Shutdown
снимает listeners и abort-ит операции. Решение, как синхронизировать данные,
остаётся в use case; plugin только переводит browser event в application
operation.

## ViewModelScope

ViewModel не передаёт signal вручную:

```ts
const result = await this.viewModelScope.run(this.addTodoUseCase, input);
const refreshed = await this.viewModelScope.run(this.refreshTodosUseCase);
```

`RefreshTodosUseCase` реализует `NoInputUseCase`, поэтому не нужен фиктивный
`undefined`. Scope создаёт context, связывает signal с owner lifecycle и не
пропускает поздний result после shutdown.

Subscriptions также принадлежат owner:

```ts
this.viewModelScope.collect(this.observeTodos.execute(criteria), (feed) => {
  this.state.update((current) => ({
    ...current,
    todos: feed.page?.todos ?? [],
  }));
});
```

## StateFlow, SharedFlow и TaskController

- local repositories используют StateFlow как наблюдаемый локальный source;
- `ObserveTodosUseCase` использует cold Flow для последовательности cache → network;
- `TodoListViewModel.state` — StateFlow полного screen snapshot;
- CRUD toast — SharedFlow с `replay: 0`;
- search debounce — TaskController `latest`, который отменяет старый intent.

## Routes и code splitting

```text
/todos     route-owned Todo ViewModel
/insights  lazy React chunk + lazy KVT feature, unload on exit
/settings  plain React lazy route без отдельного DI feature
```

Insights получает собственный ViewModel и feature scope. Settings использует
обычный React lazy, потому что ему не нужны feature services. Production build
содержит отдельные `insights-route`, `insights-module` и `settings-route`
assets.

## UI, темы и diagnostics

Экран различает initial loading/error, empty, cached stale, background fetch,
offline queue и pending row mutation. Сервер выполняет search, filters и
pagination.

`lagoon`, `sunset` и `midnight` зарегистрированы через
`ThemeSchemeRegistry`, проходят contrast validation и используют semantic
tokens. Motion preference `system/full/reduced/none` и scheme сохраняются в
localStorage.

Dev-only overlay загружается динамически. `DiagnosticEventBuffer` ограничен
1000 событиями и показывает runtime, modules, scopes, plugins, ViewModels,
features и router lifecycle.

## Проверки

```bash
npm run lint -w @kvt/example
npm run format:check -w @kvt/example
npm run typecheck -w @kvt/example
npm test -w @kvt/example
npm run build -w @kvt/example
npm run test:e2e
```

Unit/integration тесты проверяют DTO/mappers, local IDB/outbox, cache-first
порядок, offline sync, DI override, plugin cleanup, ViewModel и theme contrast.
Router test проходит Strict Mode и lazy feature load/unload. Playwright
повторяет CRUD, offline recovery, theme persistence и chunk loading в Chromium,
Firefox и WebKit.

## Что намеренно не добавлено

- conflict resolution между несколькими устройствами;
- background sync после полного закрытия вкладки;
- SSR/hydration — IndexedDB example намеренно browser-only;
- OpenTelemetry — нет реального collector;
- manual scopes и multi-bindings — route/plugin owners уже решают задачу.
