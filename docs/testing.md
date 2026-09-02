# Testing

`TestRuntimeBuilder` composes modules, plugins and explicit overrides.
`FlowTurbine` awaits items/completion, `VirtualScheduler` controls time and
`assertRuntimeReleased` fails when scopes/resources survive shutdown.

`verifyPluginContract` checks startup and idempotent shutdown. Query tests use a
scope-owned client with infinite stale/cache time. React tests use
`renderKvt()` under Strict Mode and `renderKvtRouter()` with a memory router.

Tests and examples import public entrypoints only. Release fixtures install npm
tarballs in clean directories so workspace links cannot hide missing files or
dependencies.

## Runtime and DI

```ts
const runtime = await new TestRuntimeBuilder()
  .module(appModule)
  .override(bind(NetworkRepository).to(FakeNetworkRepository).singleton())
  .build()

try {
  expect(runtime.resolve(repository)).toBe(fakeRepository)
} finally {
  await runtime.shutdown({ reason: 'test' })
  assertRuntimeReleased(runtime)
}
```

Prefer contract-compatible fakes over changing private registry state. Test both
successful shutdown and construction/start/cleanup failures. For plugins,
`verifyPluginContract()` checks repeatable ownership behavior against public
runtime APIs.

## Flow

`collectFlow()` returns a Turbine-like queue with item, completion, error and
cancellation assertions. Use `VirtualScheduler` for delay/debounce/throttle,
retry and while-subscribed timers; do not make wall-clock sleeps part of unit
tests. Property tests are appropriate for buffer capacity, replay suffixes,
operator ordering and state-machine transitions.

## React

`renderKvt()` requires a caller-created runtime and renders under Strict Mode by
default. Exercise effect replay, a suspended render, a rejected selector and a
real owner unmount. `renderKvtRouter()` owns a memory router handle but does not
silently own the root runtime.

## SSR/router

Use the static test helper with a new runtime per request. Assert Response and
redirect passthrough, navigation abort cleanup, nested feature reference counts
and final runtime inspection. Never reuse a fixture runtime across concurrent
SSR requests.

## Query

`createTestQueryClient(runtime)` uses deterministic test defaults. Await a
QueryFlow state instead of polling React output. Cover cancellation, retry,
optimistic rollback, cache-version rejection and observer cleanup.

## Leak assertions

After shutdown, runtime inspection must report no children or owned resources.
Longer soaks should run with exposed GC and compare retained heap after warmup;
one heap delta alone is not proof, so also assert exact owner/subscriber counts.

## Package contracts

Before release, pack packages, install them into empty fixtures and run Node ESM
imports, TypeScript declarations, SPA/SSR builds and package quality tools.
Workspace tests cannot detect a missing `files`, `exports` or dependency entry.
