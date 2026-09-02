# React integration

`@kvt/react` связывает runtime и Flow с React concurrent rendering. Он не
переносит application logic в hooks.

Adapter решает две задачи: даёт React consistent snapshot внешнего state и
связывает committed UI boundary с lifecycle ViewModel. Он не заменяет React
Router, component state или обычные presentational props.

## KvtProvider

```tsx
<KvtProvider runtime={runtime} hydration={hydrationState}>
  <App />
</KvtProvider>
```

Требования:

- runtime уже `running`;
- identity runtime не меняется без remount;
- provider не создаёт внешние resources во время render;
- normal unmount не означает root shutdown;
- browser page exit обрабатывается автоматически.

Создавайте runtime до `root.render()` и передавайте его одному верхнему
provider. Если приложение встроено как micro-frontend, владельцем runtime
становится mount/unmount API этого micro-frontend, а не произвольный component.

## useStateFlow

```tsx
const state = useStateFlow(viewModel.state);
```

Внутри используется `useSyncExternalStore`. Это важно для:

- consistent snapshots;
- React Strict Mode;
- concurrent rendering;
- server snapshot при hydration;
- отсутствие tearing.

### Selector

```tsx
const userName = useStateFlow(viewModel.state, {
  selector: (state) => state.user.name,
  equality: Object.is,
});
```

Component обновится только при изменении selection. Selector и equality должны
иметь стабильную identity: вынесите их за component или заверните в `useCallback`.

### Hydration key

```tsx
const state = useStateFlow(viewModel.state, {
  stateKey: "users.list",
  deserialize: deserializeUsersState,
});
```

Key нужен только для state, явно сериализованного сервером. Mismatch выдаёт
ошибку с key, но не логирует value.

## useSharedFlow

```tsx
useSharedFlow(viewModel.events, (event) => {
  if (event.type === "saved") showToast("Saved");
});
```

Subscription создаётся после commit. Handler обновляется commit-safe, поэтому
event не попадёт callback из suspended/abandoned render.

## useViewModel

```tsx
const viewModel = useViewModel(UsersViewModel);
```

Hook получает lease у ближайшего owner и создаёт instance через DI binding.
Если класс не зарегистрирован через `.viewModel()`, вызов fail-fast.

Типичный component остаётся небольшим:

```tsx
function UsersPage() {
  const viewModel = useViewModel(UsersViewModel);
  const state = useStateFlow(viewModel.state);

  if (state.status === "loading") return <UsersSkeleton />;

  return (
    <UsersList users={state.users} onRetry={() => void viewModel.retry()} />
  );
}
```

Component выбирает разметку и передаёт intent. Он не создаёт repository, не
собирает `AbortController` и не дублирует lifecycle cleanup.

## Strict Mode

В development React делает setup → cleanup → setup для проверки effects.
Owner adapter задерживает destructive cleanup через microtask и повторно
захватывает ту же route boundary, поэтому live ViewModel не стартует дважды.

Настоящий unmount после отсутствия active owner закрывает model.

## Error и Suspense boundaries

```tsx
<KvtErrorBoundary
  fallback={(error, reset) => <Failure error={error} retry={reset} />}
>
  <KvtSuspenseBoundary fallback={<Loading />}>
    <Feature />
  </KvtSuspenseBoundary>
</KvtErrorBoundary>
```

Boundary отвечает за UI presentation ошибки. Она не закрывает root runtime.

## Transition helpers

Transition-aware helpers отмечают React presentation update как non-urgent, но
не меняют ordering Flow emissions. Business state сначала остаётся
детерминированным, renderer сам решает priority.

## Где должна жить логика

| Код                           | Правильное место              |
| ----------------------------- | ----------------------------- |
| JSX, accessibility, DOM event | React component               |
| Screen state и intents        | ViewModel                     |
| Business rule                 | UseCase/domain                |
| HTTP/cache/storage            | Repository/infrastructure     |
| Lifetime wiring               | Module/scope/owner            |
| Theme preference UI           | component через `useKvtTheme` |

## Антипаттерны

- `bootstrapKvt()` внутри component;
- query fetch в `useEffect`, если это application operation;
- mutable object внутри StateFlow;
- создание ViewModel в `useMemo` без owner;
- shutdown root runtime в effect cleanup;
- подписка на SharedFlow во время render.

Обычные `useState`, `useReducer` и `useEffect` при этом не запрещены. Оставляйте
их для локального DOM/UI поведения, которое не является application operation:
focus, размер панели, открытое меню, draft до submit. Граница проходит не по
наличию async-кода, а по ownership и необходимости пережить смену renderer.
