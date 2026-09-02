# KVT Framework

KVT is an ESM-only TypeScript application framework with explicit DI,
deterministic lifecycle, Kotlin-like Flow and renderer-neutral ViewModels.
React is an adapter: domain models, repositories, use cases and ViewModels stay
ordinary TypeScript.

## Create a Todo application

```bash
npm create kvt@latest my-todo -- spa
cd my-todo
npm install
npm run dev
```

Templates are available for `core`, `spa` and `ssr`. Every template is a real
Todo application and is release-tested from packed npm artifacts.

The repository also contains a separate
[full Todo Showcase](examples/react-app/README.md) with a local persistent API,
runtime-validated DTOs, separate network/local repositories, IndexedDB outbox,
cache-first use cases, lazy KVT
features, three semantic themes and browser E2E tests. It is intentionally not
the `create-kvt spa` template: use the template to start small and the showcase
to study a production-shaped integration.

## Public API at a glance

```ts
export const todoModule = defineModule({
  id: "todo",
  version: "1.0.0",
  providers: [
    bind(TodoRepository).to(MemoryTodoRepository).singleton(),
    bind(ObserveTodosUseCase).inject(TodoRepository),
    bind(AddTodoUseCase).inject(TodoRepository),
    bind(TodoListViewModel)
      .inject(ObserveTodosUseCase, AddTodoUseCase)
      .viewModel(),
  ],
});
```

```tsx
function TodoPage() {
  const viewModel = useViewModel(TodoListViewModel);
  const state = useStateFlow(viewModel.state);
  return <TodoScreen state={state} viewModel={viewModel} />;
}
```

Routes are ordinary React Router objects. KVT creates their ViewModel owners
automatically:

```tsx
export const routes = [
  { path: "/", Component: TodoPage },
  { path: "/about", Component: AboutPage },
];
```

The browser runtime is created once before React. `KvtProvider` handles real
page-exit shutdown by default; application code does not add its own
`pagehide` listener.

## Registration rules

- `bind(Class)` is transient by default.
- `.singleton()` and `.scoped()` opt into cached lifetimes.
- `.viewModel()` delegates creation/start/stop to the nearest owner.
- `viewModelScope.run(useCase, input)` supplies `UseCaseContext` automatically;
  `NoInputUseCase` requires no placeholder `undefined`.
- `provide(Key).using(...)` is for custom factories.
- `provide(Key).value(...)` is for configuration and borrowed values.
- Classes are DI identifiers. Use `createToken()` only when no runtime class
  exists, for qualifiers, configuration and multi-bindings.
- Expected business failures use `Result`, not thrown message strings.

## Packages

| Package                                                      | Purpose                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `@kvt/core`                                                  | Runtime, DI, lifecycle, modules, plugins, ViewModel, Result    |
| `@kvt/flow`                                                  | Flow, StateFlow, SharedFlow, schedulers and tasks              |
| `@kvt/react`                                                 | Provider, Flow hooks, automatic ViewModel ownership, hydration |
| `@kvt/router-react`                                          | Browser/memory/static React Router adapters                    |
| `@kvt/theme-core`, `@kvt/theme-react`, `@kvt/theme-tailwind` | Semantic themes and Tailwind CSS 4 mapping                     |
| `@kvt/query`                                                 | Renderer-neutral server-state cache and QueryFlow              |
| `@kvt/testing`, `@kvt/testing-react`                         | Runtime, Flow, Strict Mode and router harnesses                |
| `@kvt/eslint-plugin`                                         | Clean Architecture, KVT lifecycle and legacy API lint rules    |
| `@kvt/otel`, `@kvt/devtools-*`                               | Redacted diagnostics adapters                                  |
| `@kvt/cli`, `create-kvt`                                     | Doctor, generators and project templates                       |

## Requirements

- Node.js 20, 22 or 24;
- TypeScript 5.7+;
- React 18.3/19 and React Router 7/8 for React applications;
- evergreen Chrome/Edge/Firefox and Safari 17.4+.

## Quality gates

```bash
npm install
npm run check
npm run check:coverage
npm run test:mutation
npm run test:e2e
```

The release pipeline also installs generated projects from npm tarballs,
checks package declarations, bundle sizes, memory ownership and SSR isolation.

## Documentation

```bash
npm run docs:dev
```

The web documentation covers the complete Todo path, DI, ViewModel ownership,
Flow, Router/SSR, themes, query, testing and production operation. Start with
the minimal [generated Todo guide](website/guide/getting-started.md), then read
the [full Showcase walkthrough](website/guide/react-example.md). The public site
is configured for `https://ya-araik.github.io/kvt/`.

KVT is licensed under the [MIT License](LICENSE). Copyright © 2026 Araik
Gukasyan.
