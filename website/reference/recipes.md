# Архитектурные рецепты

Эта страница — набор готовых решений для повторяющихся integration-задач. Перед
копированием определите owner и lifetime: одинаковый фрагмент регистрации может
быть корректным в root runtime и ошибочным в request/feature scope.

| Нужно                                      | Рецепт                |
| ------------------------------------------ | --------------------- |
| Собрать вертикальный feature               | полный graph          |
| Создать dependency с runtime config        | custom factory        |
| Выдать один instance под двумя identifiers | existing alias        |
| Зарегистрировать interface/config          | token                 |
| Несколько ViewModel одного типа            | keyed ViewModel       |
| Lifecycle не совпадает с route             | local owner           |
| Подменить infrastructure в test            | test override         |
| Показать domain failure в UI               | typed failure mapping |

## Полный users feature graph

Поток dependency идёт внутрь: UI знает ViewModel, ViewModel — use case, use case
— repository contract, а module подставляет infrastructure implementation.
Ни React component, ни domain code не импортируют `HttpUsersRepository`.

### Domain contract

```ts
export abstract class UsersRepository {
  abstract list(
    signal: AbortSignal,
  ): Promise<Result<readonly User[], UsersFailure>>;
}
```

### Infrastructure и use case

```ts
export class HttpUsersRepository extends UsersRepository {
  constructor(private readonly api: ApiClient) {
    super();
  }
  list(signal: AbortSignal) {
    return this.api.getUsers(signal);
  }
}

export class LoadUsersUseCase implements NoInputUseCase<
  Result<readonly User[], UsersFailure>
> {
  constructor(private readonly repository: UsersRepository) {}
  execute(context: UseCaseContext) {
    return this.repository.list(context.signal);
  }
}
```

### Module

```ts
export const usersModule = defineModule({
  id: "users",
  version: "1.0.0",
  providers: [
    bind(UsersRepository).to(HttpUsersRepository).scoped(),
    bind(LoadUsersUseCase).inject(UsersRepository),
    bind(UsersViewModel).inject(LoadUsersUseCase).viewModel(),
  ],
});
```

### Route и UI

```tsx
const routes = [{ path: "/users", Component: UsersPage }];

function UsersPage() {
  const viewModel = useViewModel(UsersViewModel);
  const state = useStateFlow(viewModel.state);
  return <UsersScreen state={state} retry={() => viewModel.retry()} />;
}
```

На route commit automatic owner запускает ViewModel. При route exit он отменяет
операции и закрывает scoped graph; component не пишет отдельный cleanup.

## Custom factory

Используйте factory, если constructor вызвать недостаточно: нужно собрать
options, вызвать стороннюю функцию или вернуть объект без подходящего class
constructor. Dependencies всё равно перечисляются через `.inject()`.

```ts
provide(ApiClient)
  .inject(AppConfig, HttpTransport)
  .using(
    (config, transport) =>
      new ApiClient({
        baseUrl: config.apiUrl,
        transport,
      }),
  )
  .singleton();
```

## Existing instance alias

```ts
bind(DefaultLogger).toExisting(StructuredLogger);
```

Оба identifiers возвращают одну ссылку, cleanup выполняется один раз.

Alias отличается от второго factory/singleton registration: второй provider
создал бы независимый instance и отдельный lifecycle.

## Config token

```ts
export const AppConfig = createToken<AppConfig>("app.config");

provide(AppConfig).value(Object.freeze({ apiUrl: "/api" }));
```

Token оправдан: interface/config не имеет runtime constructor.

Для class с подходящим runtime identity отдельный token обычно только усложняет
graph. Token нужен для interface, primitive/config или нескольких реализаций
одного контракта.

## Keyed ViewModel

```tsx
function DocumentTab({ id }: { id: string }) {
  const viewModel = useViewModel(DocumentViewModel, { key: id });
  return <Editor state={useStateFlow(viewModel.state)} />;
}
```

Один owner может держать несколько instances одного класса без новых tokens.

Key должен быть стабильной identity domain/presentation объекта. Не используйте
random key на render: это будет создавать новую ViewModel и терять state.

## Local owner вне router

```tsx
<KvtViewModelOwner id={`panel:${panelId}`}>
  <IndependentPanel />
</KvtViewModelOwner>
```

Используйте только когда lifetime действительно задаёт локальная UI boundary.
Обычный route уже имеет owner.

## Test override

```ts
const runtime = await new TestRuntimeBuilder()
  .module(usersModule)
  .override(bind(UsersRepository).to(FakeUsersRepository).singleton())
  .build();
```

Production registry не мутируется; replacement явно marked override.

Подменяйте boundary dependency (обычно repository/clock/transport), а не каждый
внутренний use case. Так test продолжает проверять реальный application graph.

## Typed failure → UI

```ts
type SaveFailure = { code: "validation"; field: "title" } | { code: "offline" };

const messageKey =
  failure.code === "validation" ? "editor.error.title" : "common.error.offline";
```

Domain не возвращает готовый локализованный текст.

Mapping находится в presentation layer: один и тот же `SaveFailure` может иметь
разный текст и UI action в web, CLI и native renderer.
