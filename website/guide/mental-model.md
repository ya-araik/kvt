# Ментальная модель

В KVT достаточно различать registration, runtime, scope/owner, Flow и adapter.

Эти понятия отвечают на разные вопросы:

| Понятие      | Вопрос                                                   |
| ------------ | -------------------------------------------------------- |
| Registration | Как создать dependency, если она понадобится?            |
| Runtime      | Какое приложение сейчас запущено?                        |
| Scope/owner  | Как долго живёт instance или работа?                     |
| Flow         | Как значения переходят от producer к consumer?           |
| Adapter      | Как внешний host переводит свои события в KVT lifecycle? |

Главная причина lifecycle-ошибок — смешение этих вопросов. Например, DI binding
объясняет способ создания repository, но сам по себе не определяет route, на
котором repository должен закрыться. Это решает lifetime и requesting scope.

## Registration — рецепт

```ts
bind(TodoRepository).to(MemoryTodoRepository).singleton();
bind(AddTodoUseCase).inject(TodoRepository);
bind(TodoListViewModel).inject(AddTodoUseCase).viewModel();
```

Регистрация immutable и ещё ничего не создаёт. Класс является identifier по
ссылочной identity, не по имени. `createToken()` нужен только когда runtime
класса нет: config value, qualifier, interface или multi-binding.

## Runtime — живое приложение

```ts
const runtime = await bootstrapKvt({ modules: [todoModule] });
```

Bootstrap проверяет модули и DI graph, создаёт root scope, запускает eager
providers/plugins и только затем возвращает `running` runtime. Shutdown
идемпотентен, закрывает детей раньше родителей и агрегирует cleanup errors.

## Scope и owner — время жизни

Scope кеширует `singleton/scoped` providers и закрывает owned resources.
ViewModelOwner хранит ViewModel instances. KVT Router создаёт owner
автоматически на каждый route match.

```text
runtime
└── root scope
    ├── singleton TodoRepository
    └── route owner: /
        └── TodoListViewModel
            ├── transient use cases
            └── viewModelScope subscriptions/tasks
```

Hook только получает lease. Удаление одного компонента не уничтожает модель;
закрытие route owner уничтожает.

### Scope и owner — не одно и то же

Scope отвечает за DI cache и owned resources. Owner отвечает за сущность более
высокого уровня, например набор ViewModel одного route, и использует child scope
для их dependencies. Обычно application-код работает с готовым owner, а не
создаёт scope вручную.

Практический вопрос выбора: если ресурс нужен всем routes, его владелец — root
runtime; если только одной feature — feature scope; если это presentation state
конкретного route — ViewModel owner.

## Flow — данные

- `StateFlow` хранит текущее значение;
- `SharedFlow` передаёт события и управляет replay/backpressure;
- cold `Flow` запускает producer для каждого collector.

Flow не выбирает владельца автоматически. В ViewModel используйте
`viewModelScope.collect/run/launch/task`; вне неё закрывайте Subscription или
передавайте AbortSignal.

## Adapter — мост

`@kvt/react`, `@kvt/router-react`, `@kvt/theme-react` и `@kvt/otel` переводят
renderer/host events в core lifecycle. Core не импортирует React, Router, DOM,
Tailwind или telemetry SDK.

## Где живёт business logic

```text
UI intent -> ViewModel -> UseCase -> Repository contract
                                      ^
                              infrastructure binding
```

React отображает immutable state и отправляет intent. Validation failure —
typed `Result`; неожиданный дефект — `KvtError`/error boundary.

## Один сценарий через все пять понятий

```text
Registration: bind(TodoRepository).singleton()
      ↓ bootstrap
Runtime: создаёт root scope и registry
      ↓ navigation /todos
Owner: создаёт TodoListViewModel и её child scope
      ↓ onStart
Flow: repository StateFlow доставляет список
      ↓ adapter
React: useStateFlow перерисовывает TodoPage
```

При уходе с `/todos` Router закрывает owner. ViewModel отменяет collection, но
root singleton repository остаётся, потому что принадлежит runtime. При
shutdown приложения закрывается и repository. Именно такое различие между
доступом и владением нужно уметь объяснить для каждого долгоживущего объекта.

## Проверка понимания

Перед добавлением нового сервиса ответьте на четыре вопроса:

1. Кто создаёт instance?
2. Кто считается его единственным владельцем?
3. Какой signal отменяет его незавершённую работу?
4. Как test докажет, что после shutdown ничего не осталось?

Если ответ требует «глобальная переменная» или «cleanup какого-то component»,
скорее всего граница lifecycle выбрана неверно.
