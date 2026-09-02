# Architecture and ownership

KVT follows one rule: every resource has one explicit owner. The runtime owns
the root scope and plugins. Feature handles own feature scopes. ViewModel
owners own models and their child scopes. Query clients and subscriptions can
be registered with a scope.

Shutdown moves monotonically from `running` to `shutting-down`, then `stopped`
or `failed`. Children stop before parents; resources stop in reverse successful
creation order. Cleanup errors are aggregated without skipping later cleanup.

Package dependencies point from optional adapters toward renderer-independent
contracts. Core and Flow do not load React, Router, Query, OpenTelemetry,
Tailwind or DevTools UI code. Universal modules do not read browser globals at
module import time.

The authoritative dependency graph, invariants and ADRs are recorded in
[the 1.0 implementation ledger](v1-implementation-plan.md).

## Layer direction

Clean Architecture does not prescribe filesystem names; it prescribes the
dependency rule. KVT projects use `domain/model`, `domain/repository` and
`domain/usecase` for entities/domain failures, outbound ports and
application-specific business rules. Data and presentation are sibling outer
adapters. The `app` directory is the composition/driver layer, not a second
home for use cases.

Domain repository/use-case code may depend on renderer-neutral `@kvt/flow` and
small contracts from `@kvt/core`; domain models remain plain TypeScript.
Infrastructure implements repository ports and is wired only by `app/di`.
React screens consume ViewModels and dispatch intent; they do not own query
clients, repositories or application lifetime.

```text
React screen -> ViewModel -> use case -> repository interface
                                    <- infrastructure implementation

host -> runtime -> root scope -> feature scope -> ViewModel owner
```

Optional packages point inward. The inverse direction is forbidden: core has no
knowledge of React, routers, query engines, Tailwind, telemetry SDKs or the
DevTools overlay.

The Todo templates and examples additionally enforce:

```text
domain/model <- domain/repository <- domain/usecase <- presentation
       ^                 ^                             
       +----------- data/repository

app/di and main.tsx compose all of the above
```

`scripts/check-boundaries.mjs` rejects reverse imports and the obsolete
`src/application` layout.

## Ownership table

| Resource | Canonical owner | Closed when |
| --- | --- | --- |
| Root providers/plugins | `KvtRuntime` | Host awaits `runtime.shutdown()` |
| Feature providers | feature handle/scope | Last handle releases or runtime stops |
| Route feature | router match manager | Last active match exits/router disposes |
| ViewModel | `ViewModelOwner` | Owner boundary closes |
| Flow subscription | caller or owning scope | Subscription cancels/scope closes |
| Query observer/cache | query client and optional scope | Last observer/client scope closes |
| Theme target layer | provider/application handle | Layer cleanup/unmount |

Borrowed values passed with `provide(Config).value(config)` remain caller-owned.
Factory and class bindings create owned instances. Avoid returning the same
external object from two factories; that creates ambiguous cleanup ownership.

## Runtime state machine

```text
created -> starting -> running -> shutting-down -> stopped
              |                         |
              +-------- failure --------+-> failed
```

Transitions are monotonic. Once shutdown begins, new resolution, scope creation
and feature loading are rejected. `shutdown()` is idempotent and every caller
receives the same Promise. A failed cleanup still leaves the runtime terminal;
all remaining cleanups run and failures are returned as an `AggregateError`.

## Failure boundaries

- Bootstrap graph failures create no resources.
- Failure during eager provider/plugin startup rolls back every successfully
  created resource in reverse order.
- Scope cleanup never crosses upward into its parent.
- Diagnostics/reporting are observational: sink failure is swallowed.
- UI error boundaries render failures; they do not assume runtime ownership.
- Query and Flow cancellation is cooperative through `AbortSignal`.

## Dynamic features

The root registry is frozen after bootstrap. A dynamic feature loads an
immutable module into a child registry/scope. Concurrent callers share one load
but hold independent handles. Releasing the final handle waits for cleanup.
Failures are retryable and are not cached forever. Development HMR uses explicit
invalidate/reload; production invalidation is rejected.

## Concurrency rules

- Never mutate a published StateFlow snapshot.
- Use generation IDs for replaceable asynchronous work.
- Treat cancellation as an expected terminal path, not as proof that an
  external side effect was rolled back.
- Run asynchronous use cases from a ViewModel through `viewModelScope.run()`;
  stream-producing use cases leave cancellation to the owned collection.
- Keep cleanup idempotent even though framework ownership invokes it exactly
  once; hosts and external APIs may retry around failures.
- Register a resource with the narrowest scope that fully owns its useful life.
