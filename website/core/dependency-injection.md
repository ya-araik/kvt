# Dependency Injection

Публичная регистрация начинается только с `bind()` или `provide()`.

DI в KVT решает две задачи: собирает object graph и передаёт ownership созданных
resources подходящему scope. Это не service locator для произвольного доступа
из любого файла. Обычно `runtime.resolve()` используется в composition/host
коде, а application classes получают dependencies через constructor.

## Когда dependency регистрировать

Регистрируйте объект, если framework должен управлять хотя бы одним из
аспектов: созданием, заменой implementation, кешированием lifetime или cleanup.

Не обязательно регистрировать:

- чистые функции без dependencies;
- immutable domain values, создаваемые обычным constructor;
- локальное состояние одного короткого метода;
- React props и значения, которые уже передаются явно.

Хороший DI graph содержит services и adapters, а не каждую переменную
приложения.

## `bind`: классы

```ts
bind(TodoRepository).to(MemoryTodoRepository).singleton();

bind(AddTodoUseCase).inject(TodoRepository);

bind(TodoListViewModel).inject(ObserveTodosUseCase, AddTodoUseCase).viewModel();
```

Concrete class можно self-bind: `bind(HttpTransport)`. Abstract class требует
`.to()`, `.toExisting()` или factory. Незарегистрированный класс никогда не
создаётся автоматически.

`inject()` — единственное место constructor metadata. TypeScript проверяет
порядок и тип каждого параметра. Decorators/reflection не используются.

## `provide`: factory и value

```ts
const AppConfig = createToken<AppConfig>("app.config");

provide(AppConfig).value(config);

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

provide(Database)
  .inject(AppConfig)
  .usingAsync((config) => Database.connect(config.databaseUrl))
  .singleton();
```

Async factory требует `resolveAsync()`. Если sync factory неожиданно вернул
Promise, KVT сообщает отдельную ошибку вместо скрытого async behavior.

### Что происходит при resolve

Для `bind(UsersViewModel).inject(LoadUsersUseCase).viewModel()` owner сначала
создаёт child scope ViewModel, затем resolve-ит `LoadUsersUseCase` и его
repository dependencies относительно этой ветки. Cached instance записывается
только после успешного создания. Если constructor/factory падает, частично
созданные owned resources очищаются.

## Class identifier или token

Используйте класс, если он существует в runtime:

```ts
runtime.resolve(AddTodoUseCase);
```

Используйте token для config/interfaces/qualifiers:

```ts
const ApiBaseUrl = createToken<string>("api.base-url");
const Interceptors = createMultiToken<Interceptor>("http.interceptors");
```

Identity класса/токена ссылочная. Два одинаковых description/name не
сталкиваются.

## Lifetimes

| Registration   | Значение                              |
| -------------- | ------------------------------------- |
| без modifier   | transient, новый instance на resolve  |
| `.singleton()` | один instance на registry owner       |
| `.scoped()`    | один instance на requesting scope     |
| `.viewModel()` | один instance на owner/class/key      |
| `.eager()`     | создать cached provider при bootstrap |

### Как выбрать lifetime

| Вопрос                                               | Lifetime                |
| ---------------------------------------------------- | ----------------------- |
| Объект дешёвый и не хранит состояние между resolve   | transient               |
| Один instance нужен всему runtime                    | singleton               |
| Один instance нужен каждой request/feature ветке     | scoped                  |
| Это presentation state с owner-controlled start/stop | viewModel               |
| Ресурс обязан успешно стартовать до UI               | cached lifetime + eager |

`singleton` не означает «лучше» или «быстрее по умолчанию». Он увеличивает
время жизни и риск захватить request/route dependency. Начинайте с transient и
расширяйте lifetime только когда это следует из semantics.

`viewModel()` несовместим с provider lifetime. `.eager()` несовместим с
transient. Повторный modifier — ошибка, а builder immutable: старая цепочка не
меняется.

## Alias

```ts
bind(DefaultLogger).toExisting(StructuredLogger);
```

Alias возвращает тот же instance и не создаёт вторую ownership запись.

## Optional, lazy, multi

```ts
provide(Api)
  .inject(optional(Tracer), lazy(AuthSession), Interceptors)
  .using(
    (tracer, getAuth, interceptors) =>
      new Api({ tracer, getAuth, interceptors }),
  );
```

- optional → `T | undefined`;
- lazy → `() => T | Promise<T>`;
- multi-token → `readonly T[]`.

## Overrides

```ts
new TestRuntimeBuilder()
  .module(todoModule)
  .override(bind(TodoRepository).to(FakeTodoRepository).singleton());
```

Override явный. Root registry после bootstrap immutable. Child override влияет
на scoped/transient graph, но уже созданный root singleton сохраняет root
dependencies.

## Validation

До старта KVT проверяет missing providers, duplicates, aliases, dependency
cycles, module requirements и несовместимые versions. Ошибка содержит stable
code и безопасный dependency path, но не значения сервисов.

## Практический порядок сборки graph

1. Используйте abstract class для runtime-visible port.
2. Зарегистрируйте concrete adapter через `.to()`.
3. Добавьте constructor dependencies через `.inject()`.
4. Выберите lifetime по владельцу, а не по привычке.
5. Соберите providers в module.
6. Запустите bootstrap: graph validation найдёт missing/duplicate/cycle до
   side effects.

Далее: [Scopes и ownership](/core/scopes-ownership).
