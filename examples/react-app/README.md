# KVT Todo Showcase

Полноценная browser SPA с локальным JSON Server, cache-first чтением,
IndexedDB, offline outbox, route ownership, lazy feature, semantic themes и
тестами. Интерфейс русскоязычный, identifiers и публичные контракты — на
английском.

Это не шаблон генератора. `npm create kvt@latest my-app -- spa` создаёт
небольшой in-memory Todo для первого знакомства. Showcase находится только в
`examples/react-app` и показывает архитектуру приложения с несколькими
источниками данных.

## Запуск

Из корня monorepo:

```bash
npm install
npm run dev -w @kvt/example
```

Одна команда запускает Vite и API. Дополнительные команды:

```bash
npm run dev:web -w @kvt/example
npm run dev:api -w @kvt/example
npm run server:reset -w @kvt/example
npm run server:sync-seed -w @kvt/example
```

Vite проксирует `/api` на JSON Server `127.0.0.1:4174`. Для production API
используйте `VITE_API_BASE_URL`.

## API и данные

`server/seed.json` содержит 200 todos и 10 users из
[JSONPlaceholder](https://github.com/typicode/jsonplaceholder/blob/master/templates/GUIDE.md).
При первом запуске seed копируется в gitignored `server/.data/db.json`.

За API отвечает точно зафиксированный `json-server@1.0.0-beta.15`. Он реально
сохраняет `POST`, `PATCH` и `DELETE`. CRUD, pagination и filters соответствуют
[JSON Server v1](https://github.com/typicode/json-server/blob/main/README.md).

```text
GET    /todos?_page=1&_per_page=20&_sort=-id
       &completed=true&userId=1&title:contains=release
GET    /users?_sort=name
POST   /todos
PATCH  /todos/:id
DELETE /todos/:id
```

Ответ fetch остаётся `unknown`, пока `parseTodoDto`, `parsePagedTodoDto` или
`parseUsersDto` не проверит его структуру. JSON Server v1 использует строковые
ID.

## Главное архитектурное правило

Один repository работает ровно с одним источником данных:

| Контракт                | Реализация                     | Единственная ответственность      |
| ----------------------- | ------------------------------ | --------------------------------- |
| `NetworkTodoRepository` | `HttpTodoRepository`           | JSON Server и проверенные DTO     |
| `LocalTodoRepository`   | `IndexedDbLocalTodoRepository` | IndexedDB pages и mutation outbox |
| `NetworkUserRepository` | `HttpUserRepository`           | `/users` и проверенные `UserDto`  |
| `LocalUserRepository`   | `IndexedDbLocalUserRepository` | Локальный snapshot списка users   |

Repository не выбирает источник и не делает fallback. Concrete data repository
валидирует DTO и мапит его в domain-модель, реализуя domain port. Агрегация
между repositories выполняется в use cases, где порядок операций виден прямо
в коде.

```text
HTTP/IDB → DTO → mapper → repository domain port ─┐
                                                 ├─ use case → ViewModel
HTTP/IDB → DTO → mapper → repository domain port ─┘
```

Domain repository contracts работают только с `Todo`, `TodoPage`, `User` и
domain input-моделями. `TodoDto`, `PagedTodoDto`, `UserDto` и request DTO не
выходят из concrete data implementations. Поэтому ни use cases, ни
presentation не импортируют `data/*`.

## Cache-first чтение

`ObserveTodosUseCase` возвращает cold `Flow<TodoFeedState>` и выполняет
последовательность:

1. подписывается на локальный repository;
2. читает страницу из IndexedDB и сразу публикует её как stale;
3. если сеть доступна, запрашивает network repository;
4. network implementation валидирует DTO и возвращает domain page;
5. use case сохраняет page в local repository и публикует актуальный state.

```text
ViewModel collect
  → ObserveTodosUseCase
      → local.load(query)    → emit cached domain page
      → network.list(query)  → local.savePage(dto)
                             → emit fresh domain page
```

Таким образом getter действительно сначала возвращает кэш, а затем серверные
данные. IndexedDB обновляет свой `StateFlow`, поэтому локальные mutations также
сразу доходят до уже открытого экрана.

## Online и offline mutations

CRUD use case сначала меняет local repository. После этого:

- online: вызывает network repository с domain input и заменяет локальную
  optimistic запись серверной;
- network unavailable: передаёт pending mutation в local repository; concrete
  implementation сохраняет её DTO в IndexedDB outbox;
- invalid/unexpected response: откатывает локальное изменение и возвращает
  typed failure.

При событии `online` browser-data plugin запускает
`SyncPendingTodosUseCase`. Use case читает outbox, последовательно выполняет
network mutations, обновляет local repository, удаляет завершённые операции и
refresh-ит активные todo flows. При shutdown plugin снимает browser listeners и
отменяет sync через lifecycle signal.

Это намеренно не спрятано в repository: именно use case определяет product
policy между двумя источниками данных.

## Структура

```text
src/
├── data/
│   ├── dto/             runtime-validated transport/storage models
│   ├── mapper/          DTO → domain mapping
│   ├── http/            fetch adapter
│   ├── local/           IndexedDB database lifecycle
│   └── repository/      HTTP/IDB implementations and DTO boundary
├── domain/
│   ├── model/           Todo, User, criteria, state and typed failures
│   ├── repository/      network/local domain ports
│   └── usecase/         cache-first, CRUD, refresh and outbox sync orchestration
├── presentation/
│   ├── model/           screen state and one-shot UI events
│   ├── viewmodel/       renderer-independent TodoListViewModel
│   └── view/            React screen
├── features/
│   ├── insights/        lazy React chunk + lazy KVT feature module
│   └── settings/        plain lazy React route
└── app/
    ├── di/              composition root, modules and plugin
    ├── navigation/      route ownership and code splitting
    ├── theme/           three semantic theme schemes
    └── devtools/        dev-only diagnostics overlay
```

## Почему showcase не использует `@kvt/query`

Framework по-прежнему содержит самостоятельный пакет `@kvt/query`. Он полезен,
когда нужен renderer-neutral server-state cache с query keys, freshness,
deduplication и invalidation.

В этом showcase есть два равноправных источника и явная offline policy. Если
спрятать Query, HTTP, IndexedDB и optimistic mutations в одном repository, код
перестаёт показывать, кто принимает решение. Поэтому здесь Query сознательно
не участвует в data path: cache-first и synchronization читаются в use cases.

## KVT в приложении

| Возможность                   | Где                                  | Зачем                                             |
| ----------------------------- | ------------------------------------ | ------------------------------------------------- |
| Runtime и DI                  | `main.tsx`, `app/di`                 | Composition root и заменяемые single-source ports |
| Modules/includes/requirements | app, infrastructure и todo modules   | Проверяемый граф зависимостей                     |
| Plugin lifecycle              | browser-data plugin                  | Online/focus listeners, sync trigger и cleanup    |
| `Result` и use cases          | `domain/usecase`                     | Validation и ожидаемые data failures              |
| `NoInputUseCase`              | refresh и outbox sync                | Запуск без фиктивного `undefined`                 |
| Cold Flow                     | observe use cases                    | Cache-first последовательность и cancellation     |
| StateFlow                     | local repositories и ViewModel state | Наблюдаемый cache и screen snapshot               |
| SharedFlow                    | `TodoListViewModel.events`           | Одноразовые toast events                          |
| TaskController `latest`       | search intent                        | Debounce 300 мс и отмена старого поиска           |
| Route owners                  | `/todos`, `/insights`                | Cleanup ViewModel вместе с route                  |
| Lazy feature                  | `/insights`                          | Поздняя загрузка UI и DI module                   |
| Theme schemes                 | `app/theme`                          | Три contrast-checked semantic themes              |
| Diagnostics                   | buffer и dev-only overlay            | Ограниченный lifecycle timeline                   |
| Testing SDK                   | integration/router tests             | Overrides, Strict Mode и resource release         |

`viewModelScope.run()` сам создаёт `UseCaseContext` и signal:

```ts
const result = await this.viewModelScope.run(this.addTodoUseCase, input)
const refreshed = await this.viewModelScope.run(this.refreshTodosUseCase)
```

У `NoInputUseCase` нет ни `undefined`, ни ручного `{ signal }`.

## Routes, темы и UI

| Route       | React chunk         | KVT scope                                        |
| ----------- | ------------------- | ------------------------------------------------ |
| `/todos`    | Initial application | Route-owned Todo ViewModel                       |
| `/insights` | Lazy                | Lazy feature module, unload on route exit        |
| `/settings` | Lazy                | Обычный React lazy route без отдельного DI scope |

Темы `lagoon`, `sunset` и `midnight` зарегистрированы через
`ThemeSchemeRegistry`. Scheme и motion mode `system/full/reduced/none`
сохраняются в localStorage. UI использует semantic tokens без условных dark
colors.

## Data policy

- максимальный возраст IndexedDB snapshot: семь дней;
- list retry: две повторные попытки только при network failure;
- offline CRUD разрешён и сразу виден локально;
- outbox синхронизируется при возвращении online;
- unexpected/invalid server response не считается offline и откатывается;
- focus запускает sync и refresh активных todo flows.

## Проверки

```bash
npm run lint -w @kvt/example
npm run format:check -w @kvt/example
npm run typecheck -w @kvt/example
npm test -w @kvt/example
npm run build -w @kvt/example
npm run test:e2e
```

Unit tests покрывают DTO validation/mapping, IndexedDB pages/outbox,
cache-first порядок, offline sync, ViewModel filters/events и theme contrast.
Integration tests проверяют DI overrides, plugin cleanup, Strict Mode и lazy
feature lifecycle. Playwright выполняет пользовательские сценарии в Chromium,
Firefox и WebKit на resettable DB.
