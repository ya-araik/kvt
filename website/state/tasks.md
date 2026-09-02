# TaskController и AsyncState

`TaskController` управляет повторными async operations и публикует их состояние
как StateFlow.

Он нужен не для любой Promise, а когда одна и та же UI operation запускается
повторно и приложение должно явно решить, что делать с пересечением запусков.
Однократный bootstrap обычно проще выполнить напрямую, а server-state cache с
deduplication и stale policy лучше описывает [Query](/application/query).

## AsyncState

```ts
type AsyncState<T, E> =
  | { status: "idle" }
  | { status: "running"; previous?: T }
  | { status: "success"; data: T }
  | { status: "failure"; error: E; previous?: T }
  | { status: "cancelled"; previous?: T };
```

`previous` позволяет UI сохранить старые данные во время refresh или показать
ошибку без исчезновения списка.

## Создание

```ts
const search = new TaskController(
  async (query: string, { signal, generation }) => {
    return repository.search(query, signal);
  },
  {
    policy: "latest",
    mapError: toSearchError,
  },
);
```

```ts
const result = await search.run("kvt");
const state = search.state;
```

Каждый run получает новый generation и AbortSignal.

## Policies

Policy — часть поведения feature, поэтому выбирайте её до написания UI:

| Сценарий                      | Policy     | Что увидит повторный запуск             |
| ----------------------------- | ---------- | --------------------------------------- |
| Поиск по меняющейся строке    | `latest`   | старый результат будет проигнорирован   |
| Синхронизация локальных edits | `enqueue`  | edits сохранят порядок                  |
| Загрузка независимых файлов   | `parallel` | работа ограничится заданной concurrency |
| Создание заказа по submit     | `ignore`   | double click не создаст второй run      |

### latest

Новый run отменяет предыдущий. Поздний result старой generation не меняет
state. Подходит для поиска, фильтра, переключения entity.

### enqueue

Requests выполняются последовательно. Подходит для операций, ordering которых
важен и которые нельзя безопасно объединить.

### parallel

```ts
new TaskController(upload, {
  policy: "parallel",
  concurrency: 3,
});
```

Одновременно выполняется не больше заданного числа operations.

### ignore

Пока task активен, новый `run()` возвращает `undefined`. Подходит для submit
button, где double click не должен создать вторую mutation.

## Cancellation

```ts
task.cancel("screen-closed");
```

Active operations получают aborted signal, queued requests снимаются. Поздний
resolve aborted operation игнорируется.

Cancellation не гарантирует rollback внешнего side effect. Repository/API
должен использовать idempotency или отдельный compensation contract.

## Error mapping

`mapError` преобразует unknown infrastructure exception в typed presentation
error. Если сам mapper падает, его error становится failure.

## Использование в ViewModel

```ts
class UsersViewModel extends ViewModel {
  readonly load = new TaskController(
    (_: void, { signal }) => this.repository.list(signal),
    { policy: "latest", mapError: toUsersError },
  );

  constructor(private readonly repository: UsersRepository) {
    super();
    this.own({ dispose: () => this.load.cancel("view-model-stopped") });
  }

  protected override onStart() {
    void this.load.run();
  }
}
```

UI читает `useStateFlow(viewModel.load.state)` и exhaustively отображает
discriminated union.

Если операция уже выражена use case, ViewModel остаётся местом выбора policy:

```ts
class SearchViewModel extends ViewModel {
  readonly search = this.viewModelScope.task(
    "latest",
    (query: string, context) => this.searchUsers.execute({ query }, context),
  );

  constructor(private readonly searchUsers: SearchUsersUseCase) {
    super();
  }
}
```

Use case описывает одну попытку поиска, а task — отношения между несколькими
попытками одного экрана. Не переносите `latest` или `ignore` в repository:
другому consumer может понадобиться другая policy.

## Presentation pattern

```tsx
const state = useStateFlow(viewModel.load.state);

if (state.status === "idle") return null;
if (state.status === "running" && !state.previous) return <Skeleton />;
if (state.status === "failure" && !state.previous)
  return <ErrorView error={state.error} />;

const data = state.status === "success" ? state.data : state.previous;
return <UsersList users={data ?? []} refreshing={state.status === "running"} />;
```

Так refresh не вызывает ненужный full-screen flicker.

## Task или Flow

- Task запускается intent-ом и имеет `AsyncState` конкретной операции.
- Cold Flow создаёт последовательность значений и завершается сам.
- StateFlow постоянно отвечает на вопрос о текущем состоянии.
- Query добавляет cache key, deduplication, stale time и invalidation.

Если приходится вручную собирать из Flow флаги `loading/error/previous` и
отменять предыдущую попытку, это сильный сигнал использовать `TaskController`.
