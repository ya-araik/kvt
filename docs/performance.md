# Performance

Core and Flow avoid optional integration imports and diagnostics work when no
sink exists. StateFlow equality suppresses unchanged writes; selector equality
suppresses irrelevant React notifications. Derived flows and query observers
are reference-counted.

Release gates measure gzip package size, 10,000 lifecycle cycles, retained
scopes/subscriptions and route/query soak. A benchmark regression above ten
percent requires an ADR. Applications should keep state immutable, avoid
unbounded SharedFlow buffers and release feature/router handles.

## Bundle budgets

Budgets exclude peer dependencies and are checked from public entrypoints:

| Package | gzip limit |
| --- | ---: |
| `@kvt/core` | 15 KiB |
| `@kvt/flow` | 30 KiB |
| `@kvt/react` | 10 KiB |
| `@kvt/router-react` | 12 KiB |
| theme/query/diagnostic adapters | 15 KiB each |

Optional integrations must remain leaf imports. A core-only consumer must not
pull React, Router, Query Core, Tailwind, OTel or the DevTools overlay.

## State and events

- Publish immutable StateFlow snapshots and use reducers to batch related state.
- Select narrow state in React when a large snapshot changes frequently.
- Give SharedFlow a finite buffer and deliberate overflow behavior.
- Use while-subscribed sharing for expensive sources and choose stop/replay
  expiration based on actual UX needs.
- Avoid sync listeners that perform large CPU work; schedule or move it behind
  an async application boundary.

## DI and features

Singletons reduce construction cost but enlarge lifetime. Prefer scoped
resources for route/request work. Avoid resolving transients in tight render
loops; resolve once in a ViewModel/repository owner. Release feature handles and
dispose routers when hosts stop.

## Query

Choose stale/cache times intentionally, use branded stable keys and allow equal
requests to deduplicate. Infinite data should cap/evict pages at the application
layer when a session can grow without bound. Observers are reference-counted;
do not retain QueryFlow objects in global UI registries.

## Measurement

Committed benchmarks cover StateFlow writes, transient DI resolution and full
runtime cycles. CI blocks a regression over 10% relative to the committed
baseline unless an ADR explains the tradeoff. Browser E2E and SSR/memory soak
complement microbenchmarks; none replaces profiling the consuming application.
