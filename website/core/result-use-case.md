# Result и UseCase

KVT предоставляет маленькие application contracts без привязки к React или DI.

## Result

```ts
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

Result подходит для ожидаемых domain failures: validation, access denied,
entity not found. Infrastructure exception можно преобразовать в domain error.

Если успешный результат не содержит данных, используйте `ok()`:

```ts
function removeTodo(id: string): Result<void, RemoveTodoFailure> {
  const removed = deleteTodo(id);
  return removed ? ok() : err({ code: "todo-not-found", id });
}
```

`ok()` имеет тип `Ok<void>`. Передавать `undefined` вручную не нужно. Для
результата со значением аргумент остаётся обязательным: `ok(todo)`.

```ts
const result = await fromPromise(repository.save(user), (error) =>
  mapSaveError(error),
);
```

## Operations

```ts
const name = map(userResult, (user) => user.name);
const saved = flatMap(validated, (user) => save(user));
const domain = mapError(response, toDomainError);

const message = match(result, {
  ok: (value) => `Saved ${value.id}`,
  err: (error) => error.message,
});
```

`tap()` выполняет side effect только для `Ok`. `combine()` собирает tuple, но
возвращает первую ошибку.

## Exceptions или Result

Используйте Result, если caller обязан обработать исход как часть normal flow.
Используйте exception для violated invariant, programming error или сбоя,
который текущий слой не способен осмысленно классифицировать.

Не превращайте cancellation в domain failure автоматически: aborted operation
может означать просто устаревший экран.

| Ситуация                               | Представление                  | Почему                              |
| -------------------------------------- | ------------------------------ | ----------------------------------- |
| Пользователь ввёл некорректный email   | `Result`                       | UI должен показать ожидаемую ошибку |
| Запрошенная сущность не найдена        | `Result`                       | это допустимый исход сценария       |
| Сессия истекла                         | `Result` или общий auth policy | caller может выбрать redirect/login |
| Нарушен внутренний invariant aggregate | exception                      | продолжать normal flow небезопасно  |
| В navigation отменён старый запрос     | abort/cancellation             | это не domain failure               |

Практическое правило: если для исхода есть осмысленная ветка в product flow,
опишите её типом. Если исправлять должен разработчик или infrastructure host,
оставьте exception и передайте его в observability на подходящей границе.

## UseCase

```ts
interface UseCase<I, O> {
  execute(input: I, context: UseCaseContext): O | Promise<O>;
}

interface NoInputUseCase<O> {
  execute(context: UseCaseContext): O | Promise<O>;
}

interface UseCaseContext {
  signal: AbortSignal;
  trace?: TraceContext;
}
```

Пример:

```ts
class LoadUsers implements UseCase<
  LoadUsersInput,
  Result<readonly User[], LoadUsersError>
> {
  constructor(private readonly repository: UsersRepository) {}

  async execute(input: LoadUsersInput, context: UseCaseContext) {
    return fromPromise(
      this.repository.list(input.filter, context.signal),
      mapUsersError,
    );
  }
}
```

UseCase:

- выражает одну application operation;
- принимает dependencies через constructor;
- не читает React context;
- не создаёт собственный root lifecycle;
- прокидывает cancellation и trace context вниз.

`NoInputUseCase` используется для cancellable-операции без входного значения.
Её `execute()` принимает только context, поэтому фиктивный `undefined` не
является частью контракта.

```ts
class RefreshUsers implements NoInputUseCase<Result<void, RefreshUsersError>> {
  constructor(private readonly repository: UsersRepository) {}

  execute(context: UseCaseContext) {
    return this.repository.refresh(context.signal);
  }
}
```

Если use case лишь синхронно возвращает `Flow`/`StateFlow`, context ему обычно
не нужен: cancellation выполняет collector. Такой API естественно объявляется
как `execute()` без параметров.

```ts
class ObserveUsers {
  constructor(private readonly repository: UsersRepository) {}

  execute(): StateFlow<readonly User[]> {
    return this.repository.users;
  }
}
```

Это отличие важно:

- **operation use case** сам ждёт I/O и должен получить `AbortSignal`;
- **stream use case** только возвращает stream, а временем подписки управляет
  collector;
- `NoInputUseCase` убирает только input, но не cancellation context операции.

## ViewModel + UseCase

ViewModel координирует UI state, а не повторяет business rules:

```ts
class UsersViewModel extends ViewModel {
  constructor(private readonly loadUsers: LoadUsers) {
    super();
  }

  async reload(filter: Filter): Promise<void> {
    const result = await this.viewModelScope.run(this.loadUsers, { filter });
    if (result === undefined) return;
    if (!result.ok) throw result.error;
    // опубликовать result.value в presentation state
  }
}
```

`viewModelScope.run()` автоматически формирует `UseCaseContext` из lifecycle
ViewModel. Вне ViewModel — например, в Node host или unit test — context по-
прежнему передаётся явно. Для `latest/enqueue/parallel/ignore` используйте
`viewModelScope.task()`: ViewModel отвечает за concurrency policy и
presentation state, а use case тестируется отдельно.

## Где формировать context

На UI-границе context обычно формирует `ViewModelScope`. На сервере его создаёт
request scope, а в background worker — owner конкретной job. Благодаря этому
use case не знает, кто его запустил, но всегда получает корректный lifecycle:

```ts
const controller = new AbortController();
const result = await loadUsers.execute(
  { filter },
  { signal: controller.signal, trace },
);
```

Не создавайте `new AbortController()` внутри каждого use case без связи с
owner: тогда закрытие route, request или worker не сможет отменить работу.
