# ViewModel lifecycle

ViewModel хранит presentation state, принимает UI intents и зависит от use
cases. Она регистрируется как отдельный DI lifecycle:

```ts
bind(TodoListViewModel)
  .inject(ObserveTodosUseCase, AddTodoUseCase, ToggleTodoUseCase)
  .viewModel();
```

Обычный `scope.resolve(TodoListViewModel)` запрещён: для корректного lifecycle
нужен ViewModelOwner.

## Что относится к ViewModel

| В ViewModel                                       | В другом слое                            |
| ------------------------------------------------- | ---------------------------------------- |
| screen state и одноразовые UI events              | entity invariants в domain               |
| реакция на `retry`, `submit`, `filterChanged`     | HTTP/Storage детали в repository adapter |
| выбор task policy для экрана                      | route rendering в React Router           |
| преобразование domain result в presentation state | process-wide startup в plugin            |

ViewModel не обязана существовать для каждого компонента. Если компонент имеет
только локальное раскрытие меню или input draft без application logic, React
state остаётся более прямым решением.

## Чистый constructor

```ts
class TodoListViewModel extends ViewModel {
  readonly #state = new MutableStateFlow(initialState);
  readonly state = this.#state.asStateFlow();

  constructor(
    private readonly observeTodos: ObserveTodosUseCase,
    private readonly addTodoUseCase: AddTodoUseCase,
  ) {
    super();
  }
}
```

Constructor создаёт только deterministic state и сохраняет dependencies. Он не
делает запрос, не открывает socket и не подписывается: speculative render может
быть отменён до commit.

## Кто вызывает `onStart`

Owner вызывает `start()` после commit первой lease. Разработчик никогда не
вызывает его из component.

```ts
protected override onStart(): void {
  this.viewModelScope.collect(this.observeTodos.execute(), (todos) => {
    this.#state.update((state) => ({ ...state, todos }))
  })
}
```

Состояния: `created → starting → running`; при ошибке — `start-failed`.
Retry откатывает ресурсы неуспешной попытки. После `stopping → stopped` restart
запрещён.

Полный lifecycle задаёт owner:

1. render запрашивает tentative lease;
2. React commit активирует lease;
3. первая active lease запускает `onStart()`;
4. intents работают через `viewModelScope`;
5. закрытие owner запрещает новые операции;
6. `onStop()` и owned resources завершаются до закрытия DI scope.

За счёт tentative lease abandoned concurrent render не запускает network I/O.

## `viewModelScope`

```ts
this.viewModelScope.collect(flow, collector);
const result = await this.viewModelScope.run(useCase, input);
const refreshed = await this.viewModelScope.run(refreshUseCase);
await this.viewModelScope.launch((signal) => lowLevelOperation(signal));
const search = this.viewModelScope.task("latest", runSearch);
this.viewModelScope.own(customResource);
```

- общий `signal` отменяется при shutdown;
- `collect` отменяет Subscription;
- `run` типобезопасно вызывает input/no-input use case и передаёт ему context;
- `launch` игнорирует late result остановленной модели;
- `task` использует generation-safe concurrency policy;
- `own` предназначен для нестандартных Disposable/Shutdownable.

Low-level `this.own()` остаётся escape hatch, но в обычном коде не нужен.

### Use case без input

Операция, которой нужен cancellation context, но не нужен input, реализует
`NoInputUseCase`:

```ts
class RefreshUsersUseCase implements NoInputUseCase<
  Result<void, RefreshFailure>
> {
  constructor(private readonly repository: UsersRepository) {}

  execute(context: UseCaseContext) {
    return this.repository.refresh(context.signal);
  }
}

const result = await this.viewModelScope.run(this.refreshUsersUseCase);
```

Передавать `undefined` не требуется ни в `execute()`, ни в `run()`. Для use
case с input используется `run(useCase, input)`.

Use case, который синхронно возвращает `Flow`/`StateFlow`, обычно вообще не
нуждается в `UseCaseContext`: cancellation принадлежит collection.

```ts
class ObserveUsersUseCase {
  constructor(private readonly repository: UsersRepository) {}
  execute(): StateFlow<readonly User[]> {
    return this.repository.users;
  }
}

this.viewModelScope.collect(this.observeUsers.execute(), renderUsers);
```

## Owner и lease

```tsx
const viewModel = useViewModel(TodoListViewModel);
```

Hook находит ближайший owner, получает tentative lease и активирует её после
commit. Несколько consumers делят instance; unmount одного consumer не закрывает
его. Lifetime заканчивает owner, а не последний hook.

Для повторяемых instances:

```tsx
const editor = useViewModel(DocumentViewModel, { key: documentId });
```

## Automatic route owner

KVT Router автоматически создаёт owner на route match. Поэтому обычной странице
не нужен JSX provider. Path params входят в owner identity; search params и
revalidation — нет. Ручной `KvtViewModelOwner` нужен только локальной границе,
которой нет в навигации (например, автономной панели workspace).

## Shutdown

Owner вызывает `onStop(context)`, затем закрывает `viewModelScope` и DI child
scope. Ошибка одного cleanup не пропускает остальные; итог — `AggregateError`.
Failed factory/start также закрывает частично созданные ресурсы.

## State и events

`StateFlow` — восстанавливаемый immutable UI state. `SharedFlow` — одноразовые
events. Не используйте event для данных, которые новый renderer обязан увидеть.

## Практический intent

Метод ViewModel должен называться в терминах действия пользователя, а не
деталей UI widget:

```ts
async addTodo(title: string): Promise<void> {
  const result = await this.viewModelScope.run(this.addTodoUseCase, { title })
  if (result === undefined) return

  if (!result.ok) {
    this.#state.update((state) => ({
      ...state,
      addError: toMessage(result.error)
    }))
  }
}
```

React вызывает `viewModel.addTodo(title)`, но не знает о repository, signal и
mapping domain errors. Это сохраняет компонент declarative и позволяет
тестировать intent без renderer.
