# DI, modules and plugins

KVT uses constructor identity instead of decorators or class names. The public
registration grammar has two roots: `bind()` for classes and `provide()` for
values/factories.

## Class bindings

```ts
abstract class TodoRepository {
  abstract observe(): StateFlow<readonly Todo[]>
}

class MemoryTodoRepository extends TodoRepository {}

const todoModule = defineModule({
  id: 'todo',
  version: '1.0.0',
  providers: [
    bind(TodoRepository).to(MemoryTodoRepository).singleton(),
    bind(AddTodoUseCase).inject(TodoRepository),
    bind(TodoListViewModel).inject(AddTodoUseCase).viewModel()
  ]
})
```

`inject()` is the only constructor metadata. TypeScript checks its arity,
ordering and assignability against the target constructor. Two classes with the
same name remain different identifiers; minification does not change identity.

## Factory and value providers

```ts
const AppConfig = createToken<AppConfig>('app.config')

const providers = [
  provide(AppConfig).value(config),
  provide(ApiClient)
    .inject(AppConfig, HttpTransport)
    .using((config, transport) => new ApiClient(config.apiUrl, transport))
    .singleton(),
  provide(Database)
    .inject(AppConfig)
    .usingAsync((config) => Database.connect(config.databaseUrl))
    .singleton()
]
```

Use tokens only for data/interfaces without a runtime class, qualifiers and
multi-bindings. A value provider is borrowed and is not shut down by KVT.
Factory/class results are owned by their scope.

## Lifetimes

- default `bind()`/factory: transient, a new instance for every resolve;
- `.singleton()`: one instance at the registry owner;
- `.scoped()`: one instance per requesting scope;
- `.viewModel()`: one instance per `(owner, class, instance key)`;
- `.eager()`: create a cached provider during bootstrap;
- `.override()`: explicit child/test replacement.

`viewModel()` cannot be combined with another lifetime. Eager transient and
sync resolution of an async provider are errors. `toExisting()` is an alias and
never creates a second instance.

## Dependencies

```ts
provide(Api)
  .inject(optional(Tracer), lazy(AuthSession), interceptors)
  .using((tracer, getAuth, allInterceptors) =>
    new Api(tracer, getAuth, allInterceptors)
  )
```

`optional()` resolves to `undefined`, `lazy()` resolves to a function and a
multi-token resolves to a frozen array. Missing ordinary dependencies, cycles
and duplicate single providers fail graph validation before startup.

## Requesting scope

A root singleton resolves dependencies in root. Scoped and transient providers
declared by a parent resolve dependencies against the child making the request,
so explicit child overrides affect the expected graph without contaminating
global singletons.

## Modules and plugins

```ts
const usersModule = defineModule({
  id: 'users',
  version: '1.2.0',
  requires: [{ id: 'network', version: '^1.0.0' }],
  providers
})
```

Module definitions are frozen. IDs, versions, requirements, includes and the DI
graph are validated before eager initialization.

Trusted local/npm plugins add modules and lifecycle hooks:

```ts
const analyticsPlugin = definePlugin({
  id: 'analytics',
  version: '1.0.0',
  modules: [analyticsModule],
  async start({ scope }) {
    await scope.resolveAsync(Analytics).connect()
  },
  shutdown(context) {
    return disconnect(context.signal)
  }
})
```

Startup follows dependency order; shutdown reverses it. Partial startup rolls
back created resources. Remote code loading is outside KVT's trust model.

## Lazy features

```ts
const usersFeature = {
  id: 'users',
  version: '1.0.0',
  load: async ({ signal }) => {
    const loaded = await import('./users.module.js')
    signal.throwIfAborted()
    return loaded.usersModule
  }
} satisfies FeatureDefinition
```

Concurrent loads deduplicate; cancellations do not install a late module;
failures can retry; the final handle release awaits feature cleanup.
