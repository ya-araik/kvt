# Getting started

Create the complete Todo SPA:

```bash
npm create kvt@latest my-todo -- spa
cd my-todo
npm install
npm run dev
```

Use `core` for a renderer-neutral Node application and `ssr` for request-local
React rendering.

## Application layers

The generated project follows one direction of dependencies:

```text
React -> TodoListViewModel -> use cases -> TodoRepository
                                              ^
                                      MemoryTodoRepository
```

`TodoRepository` is an abstract class, so it exists at runtime and is also a DI
identifier. No token is needed:

```text
src/
├── domain/
│   ├── model/          entities, values and domain failures
│   ├── repository/     use-case ports
│   └── usecase/        application-specific business rules
├── data/repository/    port implementations
├── presentation/
│   ├── model/          UI state
│   ├── viewmodel/      state holders
│   └── view/           renderer views
├── app/di/             composition root
├── app/navigation/     routes
└── main.tsx            host entry point
```

This is a project convention, not a claimed universal folder specification.
The invariant is Clean Architecture's dependency rule: domain never imports
data, presentation or app; data and presentation depend on domain ports; only
the composition root knows both contracts and implementations.

```ts
export abstract class TodoRepository {
  abstract readonly todos: StateFlow<readonly Todo[]>
  abstract add(title: string, signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>>
}
```

## Module

```ts
export const todoModule = defineModule({
  id: 'todo',
  version: '1.0.0',
  providers: [
    bind(TodoRepository).to(MemoryTodoRepository).singleton(),
    bind(ObserveTodosUseCase).inject(TodoRepository),
    bind(AddTodoUseCase).inject(TodoRepository),
    bind(ToggleTodoUseCase).inject(TodoRepository),
    bind(RemoveTodoUseCase).inject(TodoRepository),
    bind(TodoListViewModel)
      .inject(
        ObserveTodosUseCase,
        AddTodoUseCase,
        ToggleTodoUseCase,
        RemoveTodoUseCase
      )
      .viewModel()
  ]
})
```

Unqualified use cases are transient. The repository is singleton so navigating
to `/about` and back does not lose its in-memory tasks. ViewModel lifetime is
owned by the active route.

## ViewModel

```ts
export class TodoListViewModel extends ViewModel {
  readonly #state = new MutableStateFlow(initialTodoState)
  readonly state = this.#state.asStateFlow()

  constructor(
    private readonly observeTodos: ObserveTodosUseCase,
    private readonly addTodoUseCase: AddTodoUseCase
  ) { super() }

  protected override onStart(): void {
    this.viewModelScope.collect(
      this.observeTodos.execute(),
      (todos) => this.#state.update((state) => ({ ...state, todos }))
    )
  }

  async addTodo(title: string): Promise<void> {
    const result = await this.viewModelScope.run(this.addTodoUseCase, { title })
    if (result === undefined) return
    // Map Result into presentation state.
  }
}
```

The constructor is pure. The framework calls `onStart()` after the route owner
commits. A stream-producing use case needs no placeholder input or explicit
signal because collection owns cancellation. `viewModelScope.run()` supplies
the context for asynchronous input/no-input use cases and returns `undefined`
if the model stops before completion.

## React and routes

```tsx
function TodoPage() {
  const viewModel = useViewModel(TodoListViewModel)
  const state = useStateFlow(viewModel.state)
  return <TodoScreen state={state} viewModel={viewModel} />
}

export const routes = [
  { path: '/', Component: TodoPage },
  { path: '/about', Component: AboutPage }
]
```

No ViewModel token, definition array, screen provider or manual route scope is
needed. Path parameter changes create a new route owner; search-parameter
changes and revalidation keep the existing one.

## Bootstrap

```tsx
const runtime = await bootstrapKvt({ modules: [todoModule] })
const router = createKvtBrowserRouter({ runtime, routes })

createRoot(document.getElementById('root')!).render(
  <KvtProvider runtime={runtime}>
    <RouterProvider router={router} />
  </KvtProvider>
)
```

`KvtProvider` owns browser page-exit wiring. Node/SSR/test hosts still use an
awaited `runtime.shutdown()` in their own `finally` or signal handler.

## Expected failures

```ts
export type AddTodoFailure =
  | { code: 'empty-title' }
  | { code: 'title-too-long'; maxLength: number }
  | { code: 'storage-unavailable' }
```

Use cases return `Result`. The ViewModel maps a failure code to a UI message
key. Unexpected defects use `KvtError` and an error boundary.

## Verify

```bash
npx kvt doctor
npm run typecheck
npm test
npm run build
```
