# Query и server state

`@kvt/query` скрывает TanStack Query Core за renderer-independent contracts.
Repositories и ViewModel работают с `QueryFlow`; React hooks отсутствуют.

## Зачем отдельный server state

Application state и server cache решают разные задачи. Query layer умеет:

- deduplicate одинаковые requests;
- stale/cache time;
- retry/backoff;
- background refresh;
- cancellation;
- optimistic updates;
- persistence и SSR hydration.

ViewModel не должна реализовывать этот cache вручную.

## Когда использовать Query

| Данные                                        | Подходящий владелец   |
| --------------------------------------------- | --------------------- |
| Кешируемый ответ API с freshness/invalidation | Query                 |
| Текущее presentation state экрана             | ViewModel `StateFlow` |
| Domain source of truth без cache policy       | repository            |
| Повторяемая UI operation с `latest/ignore`    | `TaskController`      |
| Одноразовый UI effect                         | `SharedFlow`          |

Query не заменяет repository: definition всё ещё должна вызывать abstraction
data layer, если вы хотите тестируемую clean architecture. Query отвечает за
server-state policy, repository — за доступ к данным и mapping transport.

## Query key

```ts
const usersKey = (teamId: string) => createQueryKey("users", teamId);
```

Key immutable и typed. Все параметры, влияющие на result, должны входить в key.

Не включайте в key случайные object identities или presentation-only state.
Одинаковый смысл запроса должен давать одинаковый key, иначе deduplication и
invalidation работать не будут.

## Definition

```ts
const usersQuery = (
  teamId: string,
): QueryDefinition<readonly User[], UsersError> => ({
  key: usersKey(teamId),
  query: ({ signal }) => api.loadUsers(teamId, signal),
  staleTimeMs: 30_000,
  cacheTimeMs: 5 * 60_000,
  retry: 2,
  mapError: toUsersError,
});
```

## Observe

```ts
const flow = queryClient.observe(usersQuery(teamId));
```

`QueryFlow` — StateFlow со state:

- `status`: pending/success/error;
- `data` и `previousData`;
- `error`;
- `fetching`, `paused`, `stale`;
- timestamps и failure count.

Observer запускается с первым subscriber и освобождается после последнего.

## ViewModel integration

```ts
class UsersViewModel extends ViewModel {
  readonly users: QueryFlow<readonly User[], UsersError>;

  constructor(client: KvtQueryClient, teamId: string) {
    super();
    this.users = client.observe(usersQuery(teamId));
  }
}
```

React читает `useStateFlow(viewModel.users)`. Fetch logic не находится в
component effect.

На практике ViewModel может сочетать server state с presentation state:

```ts
class UsersViewModel extends ViewModel {
  readonly users: QueryFlow<readonly User[], UsersError>;
  readonly #filter = new MutableStateFlow("");
  readonly filter = this.#filter.asStateFlow();

  constructor(client: KvtQueryClient, teamId: string) {
    super();
    this.users = client.observe(usersQuery(teamId));
  }

  filterChanged(value: string): void {
    this.#filter.set(value);
  }
}
```

Загруженные users имеют server freshness policy, а filter остаётся локальным
presentation state. Не каждое поле экрана следует переносить в query cache.

## Query plugin

```ts
const runtime = await bootstrapKvt({
  modules,
  plugins: [queryPlugin({ defaultStaleTimeMs: 30_000 })],
});

const client = runtime.resolve(kvtQueryClientToken);
```

Или создайте client вручную и передайте owning scope.

## Mutation

```ts
const rename = client.mutation({
  mutate: (input, { signal }) => api.rename(input, signal),
  onMutate: (input) => applyOptimisticRename(client, input),
  onError: (_error, _input, rollback) => rollback?.(),
  onSuccess: () => client.invalidate({ key: usersKey(teamId) }),
});
```

Optimistic context должен быть immutable и достаточным для rollback.

Abort не доказывает, что server mutation не произошла. Используйте idempotency
keys и reconciliation.

## Infinite query

Definition задаёт `initialPageParam`, `getNextPageParam` и optional previous
page. Flow предоставляет методы загрузки страниц, не требуя React hook.

Pagination state остаётся в repository/ViewModel layer.

## Dependent query

Используйте explicit `enabled`, пока dependency не готова. Не запускайте query
из React effect только потому, что появился ID.

## Focus/online

Host adapter может связать browser focus/network events с query managers.
Listeners должны сниматься при client shutdown. В тестах managers управляются
без DOM.

## Persistence

Persisted cache versioned. Unknown version нужно отклонить или мигрировать.
Не сохраняйте private server data только потому, что она уже находится в cache.

## Scope cleanup

Query client реализует lifecycle contract. Если он создан factory в scope,
shutdown aborts active work, уничтожает observers и очищает owned cache.

В browser приложении query client часто живёт вместе с root runtime. В SSR —
строго внутри request. Feature-local client оправдан только если cache не должен
разделяться с остальным приложением; иначе feature обычно использует root
client, а её observers закрываются вместе с feature/ViewModel scope.
