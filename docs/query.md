# Query

`@kvt/query` wraps Query Core behind KVT definitions. Repositories and
ViewModels observe `QueryFlow`, execute mutations, invalidate/prefetch and own
optimistic rollback. React hooks are intentionally absent.

Query state reports pending/success/error, fetching, paused, stale, previous
data, timestamps and failure count. Typed keys, cancellation, retry, cache/GC,
infinite queries, focus/online state and versioned persistence/SSR hydration are
available through KVT contracts.

Observers start with their first subscriber and are destroyed after their last.
Owning a query client in a DI scope guarantees cancellation and cache cleanup at
scope shutdown.

## Create a renderer-independent client

Install `@tanstack/query-core` as the package's peer and create the client in a
module/plugin or repository scope:

```ts
const usersKey = (teamId: string) => createQueryKey('users', teamId)

const usersQuery = (teamId: string): QueryDefinition<readonly User[], DomainError> => ({
  key: usersKey(teamId),
  query: ({ signal }) => api.loadUsers(teamId, signal),
  mapError: toDomainError,
  staleTimeMs: 30_000
})

const flow = client.observe(usersQuery(teamId))
```

ViewModels expose the returned StateFlow; React only renders it.

## Query state

Consumers can distinguish initial pending from background fetching, paused
network work and stale cached success. A refresh retains `previousData`,
timestamps and failure count. Do not erase useful content merely because a
background refetch started.

## Cancellation and ownership

The query function receives an AbortSignal. Request deduplication shares work
for equal keys. Removing the last observer releases the observer, while cache
retention follows cache/GC configuration. Shutting down the owning scope aborts
active work and clears its owned client.

## Mutations and optimistic rollback

```ts
const rename = client.mutation({
  mutate: (input, { signal }) => api.rename(input, signal),
  onMutate: (input) => optimisticRename(client, input),
  onError: (_error, _input, rollback) => rollback?.(),
  onSuccess: () => client.invalidate({ key: usersKey(teamId) })
})
```

Return immutable rollback context from `onMutate`. An aborted/failed mutation
cannot assume the server reverted a side effect; APIs should support idempotency
or reconciliation.

## Infinite and dependent queries

Infinite definitions own page parameters and next/previous-page functions.
Dependent queries use explicit enabled/dependency conditions rather than being
started from React effects. Pagination state remains repository/ViewModel logic.

## Persistence and SSR

Persistence adapters store an explicit versioned cache. Reject or migrate an
unknown version; never hydrate blindly. Dehydration omits errors/functions and
must not include private data unless the application explicitly classifies it
as safe for that response. Hydrate the request-local client before rendering
and shut it down with its runtime scope.

## Focus and online managers

Adapters may connect host focus/network signals. Keep browser globals out of
universal module initialization and detach listeners on client shutdown. Tests
can drive the managers explicitly without a DOM.
