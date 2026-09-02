# React and ViewModel ownership

A ViewModel is registered in DI and resolved by class:

```ts
bind(TodoListViewModel)
  .inject(ObserveTodosUseCase, AddTodoUseCase)
  .viewModel()
```

```tsx
function TodoPage() {
  const viewModel = useViewModel(TodoListViewModel)
  const state = useStateFlow(viewModel.state)
  return <TodoScreen state={state} viewModel={viewModel} />
}
```

The hook leases an instance from the nearest owner. It does not create a token,
start the model or decide when it dies.

## Lifecycle

1. During a speculative render KVT may construct a tentative ViewModel.
2. Its constructor only creates deterministic local state.
3. After React commit, the lease starts `onStart()` exactly once.
4. Multiple consumers in one owner get the same instance.
5. When the owner closes, KVT calls `onStop()`, cancels `viewModelScope` and
   closes its DI child scope.
6. A stopped instance is terminal and cannot restart.

Aborted renders are reclaimed without running business work. Strict Mode's
setup-cleanup-setup does not produce a second logical start.

## `viewModelScope`

```ts
protected override onStart(): void {
  this.viewModelScope.collect(this.observeTodos.execute(), (todos) => {
    this.#state.update((state) => ({ ...state, todos }))
  })
}
```

Available operations:

- `collect(flow, collector)` — owner-cancelled collection;
- `run(useCase)` / `run(useCase, input)` — context-bound use-case execution;
- `launch(operation)` — operation with the owner AbortSignal;
- `task(policy, operation)` — `latest`, `enqueue`, `parallel` or `ignore`;
- `own(resource)` — register an unusual Disposable/Shutdownable;
- `signal` — cooperative cancellation signal.

`ViewModel.own()` remains a low-level escape hatch. Normal application code
uses `viewModelScope`.

A use case that only returns a Flow/StateFlow exposes a natural zero-argument
`execute()` because cancellation belongs to collection. An asynchronous
operation with no input implements `NoInputUseCase<O>` and receives only
`UseCaseContext`; `viewModelScope.run(noInputUseCase)` supplies that context
without a placeholder `undefined`. Input operations use
`viewModelScope.run(useCase, input)`.

## Instance keys

```tsx
const document = useViewModel(DocumentViewModel, { key: documentId })
```

The owner keeps one instance for each `(class, key)`. Changing the key gets a
different instance without inventing a DI token.

## Owners

Browser, memory and static KVT routers automatically create an owner for each
active match. Path-parameter changes replace it; search changes and
revalidation do not. Use `KvtViewModelOwner` manually only for a local boundary
that is not represented by routing, such as an independent workspace panel.

## Failure behavior

Construction failures close the child scope. Failed `onStart()` rolls back
resources from that attempt and is reported to the nearest error boundary.
Shutdown continues after individual failures and returns an `AggregateError`.

## React provider

```tsx
const runtime = await bootstrapKvt({ modules: [todoModule] })
const router = createKvtBrowserRouter({ runtime, routes })

root.render(
  <KvtProvider runtime={runtime}>
    <RouterProvider router={router} />
  </KvtProvider>
)
```

The runtime identity is fixed. The provider never creates it. In browsers it
handles non-bfcache `pagehide` shutdown; SSR/tests/custom hosts own their awaited
shutdown explicitly.
