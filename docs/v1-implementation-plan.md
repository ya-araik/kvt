# KVT Framework 1.0 implementation ledger

This document is the source of truth for the 1.0 implementation. A later
iteration must not start while the current iteration has an open quality gate.

## Fixed product decisions

- The public version is `1.0.0`; the prototype API is not preserved.
- Packages use the `@kvt/*` scope and are ESM-only.
- Node.js 20, 22 and 24 are supported.
- React is an adapter. Runtime, DI, lifecycle, Flow, repositories, use cases,
  query/cache and modules are renderer-independent TypeScript.
- The root runtime is bootstrapped before React. Browser page-exit shutdown is
  wired by `KvtProvider`; SSR, tests and custom hosts shut it down explicitly.
- React 18.3 and 19, React Router 7 and 8, SPA and SSR are supported.
- Remote code loading, decorators, CommonJS, RxJS, React Native, Redux bridges,
  a browser DevTools extension and a UI component kit are out of scope.
- Framework source, examples and public documentation are product-neutral.

## Package dependency graph

The graph is deliberately one-way. Optional integrations are leaf packages.

```text
@kvt/flow
    ^
    |
@kvt/core <---------------------- @kvt/otel
    ^  ^                                ^
    |  +------ @kvt/query --------------+
    |
    +------ @kvt/react <----- @kvt/testing-react
    |             ^
    |             +--------- @kvt/router-react
    |             +--------- @kvt/devtools-react
    |
    +------ @kvt/testing

@kvt/theme-core <----- @kvt/theme-react
        ^                     ^
        +----- @kvt/theme-tailwind

@kvt/devtools-protocol <----- @kvt/devtools-react

@kvt/cli and create-kvt consume public package contracts only.
```

Forbidden dependency directions:

- `@kvt/core` and `@kvt/flow` must not import React, Router, TanStack Query,
  Tailwind, OpenTelemetry or DevTools UI packages.
- `@kvt/query` must not import React or expose TanStack public types.
- theme core must not import React, Tailwind or browser globals at import time.
- universal packages must not access `window` or `document` at import time.

## Runtime invariants

- Every owned resource has exactly one owner.
- Shutdown is idempotent and returns the same promise for every caller.
- Shutdown blocks new resolve, feature-load and scope-create operations.
- Child scopes close before parents; owned resources close in reverse creation
  order; one cleanup failure never prevents later cleanups.
- Partial bootstrap rolls back every resource that was successfully created.
- Root singleton dependencies resolve from the root scope. Scoped and transient
  provider dependencies resolve from the requesting child scope.
- The root registry is immutable after graph validation. Dynamic features own a
  separate registry and scope.
- StateFlow never completes or fails. Cold Flow may complete or fail. SharedFlow
  buffering behaviour is explicit.
- A ViewModel lifetime belongs to an owner boundary, never to one hook call.
- ViewModels execute application operations through `viewModelScope.run()`;
  no-input operations use `NoInputUseCase` and stream collection owns its own
  cancellation.
- SSR creates and closes one runtime per request. Only explicitly keyed state is
  serializable.
- Diagnostics expose metadata, never service instances, query data, tokens,
  arbitrary state or unredacted user data.

## Iteration progress

Status values: `not-started`, `in-progress`, `blocked`, `complete`.

| Iteration | Scope | Status | Quality gate |
| --- | --- | --- | --- |
| 0 | Architecture contracts and ADRs | complete | Contract, dependency and product-boundary checks pass |
| 1 | Packaging and monorepo foundation | complete | Packed packages and templates work without workspace links |
| 2 | Lifecycle, diagnostics and errors | complete | Failure paths clean up exactly once |
| 3 | DI, scopes, modules and plugins | complete | Nested overrides, rollback, retry and unload pass |
| 4 | Flow engine, Result and Task | complete | Derived flows release sources; buffer properties pass |
| 5 | ViewModel ownership | complete | Ownership tests and 10,000-cycle memory soak pass |
| 6 | React adapter and hydration | complete | React 18.3/19 Strict Mode and interrupted render pass |
| 7 | Router and SSR | complete | Router 7/8 and 1,000-request SSR soak pass |
| 8 | Neutral theme system | complete | Browser gate confirms scoped styling and no body mutation |
| 9 | Query facade | complete | Query lifetime is scope-owned and hook-free |
| 10 | OpenTelemetry and DevTools | complete | Redaction, protocol and optional-overlay gates pass |
| 11 | Testing SDK | complete | Tests and examples use public testing APIs |
| 12 | CLI and templates | complete | Core, SPA and SSR templates build from tarballs |
| 13 | Documentation and examples | complete | TypeDoc and task-oriented guides generate successfully |
| 14 | Stabilization and release | blocked | Local quality gates pass; external publication prerequisites remain open |

## ADR index

- [ADR-0001: runtime and resource ownership](adr/0001-runtime-ownership.md)
- [ADR-0002: dependency injection and feature scopes](adr/0002-di-and-feature-scopes.md)
- [ADR-0003: Flow semantics](adr/0003-flow-semantics.md)
- [ADR-0004: React and SSR boundary](adr/0004-react-and-ssr.md)
- [ADR-0005: neutral theme architecture](adr/0005-theme.md)
- [ADR-0006: query facade](adr/0006-query.md)

## Iteration log

### Iteration 0 — architecture contracts and ADRs — complete

Completed:

- Created this implementation ledger and six ADRs for runtime ownership, DI,
  Flow, React/SSR, theme and query.
- Fixed the acyclic package graph, resource ownership rules and forbidden
  dependency directions.
- Added repository-wide boundary checks for product-specific naming and imports.

Public contract changes:

- The prototype API is intentionally removed.
- `bootstrapKvt()` and awaited `runtime.shutdown()` are canonical.
- React is a consumer of a pre-existing runtime, never its creator. The React
  adapter may bridge browser host lifecycle events to that runtime without
  treating an ordinary component unmount as application shutdown.

Corner cases and decisions:

- Bundler-only extensionless imports are forbidden; every relative ESM import
  uses a NodeNext-compatible `.js` specifier.
- Universal packages may reference DOM types but cannot read browser globals at
  import time.

Verification:

- `check:boundaries` and `check:dependency-graph` pass across all packages.

### Iteration 1 — packaging foundation — complete

Completed:

- Created fifteen independently publishable packages and three examples.
- Added ESM-only exports, declaration/source maps with embedded sources,
  side-effect metadata and closed package entrypoints.
- Added API Extractor reports, TypeDoc generation, `publint`,
  AreTheTypesWrong, direct Node import and packed-template checks.

Public contract changes:

- Public imports are restricted to package root exports.
- Package engines require Node `^20.19`, `^22.12` or `>=24`.

Corner cases and decisions:

- Package smoke tests extract tarballs in a clean temporary tree so npm
  workspace symlinks cannot conceal undeclared dependencies or missing files.
- React 19-generated declarations must remain consumable with React 18 types;
  public component return types therefore avoid React-version-specific aliases.

Verification:

- Every packed package passes Node ESM import, declaration/source-map inspection,
  `publint` and AreTheTypesWrong.
- Core, SPA and SSR templates build using only packed artifacts.

### Iteration 2 — lifecycle, diagnostics and errors — complete

Completed:

- Implemented the runtime state machine, asynchronous bootstrap, idempotent
  shutdown, timeout cancellation and rollback after partial startup.
- Implemented reverse-order resource cleanup, child-before-parent scope closure,
  `AggregateError`, stable `KvtError` fields, redaction and fail-soft sinks.

Public contract changes:

- Long-lived resources implement `Shutdownable`; synchronous `Disposable` is
  reserved for immediate cleanup.
- Runtime inspection exposes frozen metadata only, not resolved service values.

Corner cases and decisions:

- An invalid shutdown timeout is rejected without poisoning the runtime's one
  canonical shutdown promise.
- Externally supplied `provideValue` instances are borrowed and are not shut
  down by the container.
- Reporter and diagnostic sink failures are observational and cannot interrupt
  application cleanup.

Verification:

- Bootstrap rollback, cleanup aggregation, use-after-shutdown and exactly-once
  ownership tests pass.

### Iteration 3 — DI, modules and plugins — complete

Completed:

- Implemented immutable explicit providers for singleton, scoped and transient
  lifetimes, including explicit async variants.
- Added aliases, optional/lazy dependencies, multi-bindings, overrides, eager
  initialization and graph validation with dependency paths.
- Added versioned modules/plugins, dependency ordering, feature load deduplication,
  cancellation, retry, unload and development-only invalidate/reload.

Public contract changes:

- No decorators, implicit class construction or mutable root registry exist.
- Dynamic modules are represented by owned feature scopes and handles.

Corner cases and decisions:

- Transient/scoped dependencies resolve in the requesting child scope so child
  overrides work; root singleton graphs remain rooted at root.
- A cancelled waiter does not necessarily cancel a shared feature load while
  another waiter remains.
- A conflicting loader or version for the same feature ID fails explicitly.

Verification:

- Missing, duplicate and circular providers; nested overrides; plugin ordering;
  concurrent feature loads; failure retry and unload all pass integration tests.

### Iteration 4 — Flow, Result and Task — complete

Completed:

- Implemented cold Flow, StateFlow, SharedFlow, cancellation-aware subscriptions,
  replay, capacity and all four overflow policies.
- Added creation, transformation, composition, flattening, time, retry and
  sharing operators plus immediate/microtask/timeout/frame/virtual schedulers.
- Added lazy derived state, transactions, `AsyncState`, generation-safe
  `TaskController`, expanded `Result` and context-aware use cases.

Public contract changes:

- `update()` always accepts a reducer; object-only `patch()` is separate.
- `StateFlow` cannot complete or fail; asynchronous terminal behavior belongs
  to cold Flow and Task state.

Corner cases and decisions:

- Emission uses a subscriber snapshot: new listeners do not receive an
  in-progress emission and removed listeners receive no later emissions.
- Listener exceptions are isolated and reported without stopping siblings.
- Replay delivery is asynchronous and ordered before later emissions for a new
  subscriber.

Verification:

- Operator/cancellation tests and fast-check replay/buffer properties pass.
- Memory soak reports zero retained derived subscribers after 10,000 cycles.

### Iteration 5 — ViewModel ownership — complete

Completed:

- Added branded typed keys, owner/store/lease semantics, child scopes and an
  explicit start/stop state machine.
- Added shared-consumer behavior, failed factory/start cleanup and metadata-only
  inspection of model states and lease counts.

Public contract changes:

- Constructors are pure; acquisition belongs in `start(signal)`.
- A stopped ViewModel cannot be restarted.

Corner cases and decisions:

- Strict Mode lease replay is delayed long enough to preserve the live owner,
  while a real owner unmount still closes it.
- A factory failure closes the child scope created for that definition.
- `onStop` failure cannot skip registered disposable cleanup.

Verification:

- The 10,000-cycle soak reports 10,000 starts/stops/disposals and zero retained
  root children/resources.

### Iteration 6 — React adapter and hydration — complete

Completed:

- Added required-runtime `KvtProvider`, `KvtViewModelScope`, StateFlow selector
  hooks, SharedFlow effect subscriptions, boundaries and transition helpers.
- Added explicit keyed hydration registry, safe JSON serialization and
  development diagnostics for mutable snapshots/mismatches.
- Enabled standard React Hooks lint rules without refs/purity exemptions.

Public contract changes:

- Provider runtime identity is immutable for one mounted provider.
- Only explicitly keyed and serialized state crosses the SSR boundary.

Corner cases and decisions:

- SharedFlow handlers are installed only after commit, so abandoned renders
  cannot receive events.
- ViewModel start that outlives owner unmount is aborted and cleaned.
- Server/client snapshot mismatches include the state key but not state values.

Verification:

- Strict Mode, Suspense, interrupted-render and hydration tests pass with React
  18.3 and 19.

### Iteration 7 — Router and SSR — complete

Completed:

- Added browser, memory and static adapters that create upstream routers outside
  React and preserve complete RouteObject/data-router behavior.
- Added cancellable route feature preparation, reference-counted nested matches,
  route DI scopes, lazy-route preservation, cleanup and explicit router disposal.
- Added router loader/action diagnostics without altering thrown/returned values.

Public contract changes:

- `withKvtRoute()` adds metadata without replacing React Router contracts.
- `disposeKvtRouter()` is the explicit host cleanup boundary.

Corner cases and decisions:

- A navigation AbortSignal only releases that caller; shared loads survive for
  other active matches.
- Rolling navigation retains the previous feature until the next match commits.
- A normal `404` from an upstream loader remains an upstream Response, not a
  framework feature-cleanup signal.

Verification:

- Router 7 and 8 consumer matrices pass.
- 1,000 isolated SSR request runtimes render and shut down successfully.

### Iteration 8 — neutral theme system — complete

Completed:

- Added immutable Compose-like schemes, exact runtime validation, migrations,
  custom registries, contrast checking and generated `--kvt-*` variables.
- Added scoped HTMLElement/ShadowRoot application, layered restore semantics,
  fail-soft persistence, system/cross-tab synchronization, SSR cookie helpers
  and nonce-aware pre-hydration bootstrap.
- Added opt-in Tailwind CSS 4 mappings in a separate package.

Public contract changes:

- Theme packages do not style `html`, `body` or global classes on import.
- The target is explicit and multiple providers can coexist.

Corner cases and decisions:

- A target's previous inline values are recaptured after its last owner releases
  it, so later external changes are not overwritten.
- A late async storage read cannot overwrite a user choice made after mount.
- Invalid persisted preferences fall back to provider defaults.

Verification:

- Standard schemes pass documented WCAG contrast pairs.
- Chromium, Firefox and WebKit confirm scoped theme updates without body mutation.

### Iteration 9 — query facade — complete

Completed:

- Added a renderer-independent facade over Query Core with branded keys,
  QueryFlow, mutations, pagination/infinite data, deduplication, cancellation,
  retry, invalidation, optimistic rollback, persistence and SSR hydration.
- Added scope-aware observer/client cleanup, focus/online integration and domain
  error mapping without exporting TanStack types.

Public contract changes:

- Query has no React package or hooks; repositories/ViewModels consume flows.
- Persisted state is explicitly versioned.

Corner cases and decisions:

- The last successful result remains as `previousData` during background fetch.
- Shutdown aborts active work before destroying observers/cache.
- Mutation mapping applies consistently to both thrown and reported errors.

Verification:

- Query integration tests cover deduplication, abort, hydration, previous data,
  optimistic rollback, infinite queries and plugin ownership.

### Iteration 10 — OpenTelemetry and DevTools — complete

Completed:

- Added an OpenTelemetry API-only diagnostic sink and a versioned redacted
  diagnostics protocol.
- Added bounded event export/import and an optional dynamically imported React
  overlay for runtime, plugin, feature, scope, owner and timeline metadata.

Public contract changes:

- Applications configure exporters; no SDK/exporter is bundled.
- DevTools actions are explicit callbacks; the overlay cannot access service or
  query values.

Corner cases and decisions:

- Event-buffer snapshots have stable identity between changes for correct
  `useSyncExternalStore` behavior.
- Imported diagnostic exports are normalized and re-redacted.

Verification:

- Protocol XSS/redaction, no-op OTel and overlay metadata tests pass.
- Bundle inspection confirms optional overlay code is absent from core consumers.

### Iteration 11 — testing SDK — complete

Completed:

- Added `TestRuntimeBuilder`, explicit overrides, `FlowTurbine`, virtual time,
  query client helpers, runtime leak assertions and plugin contract verification.
- Added Strict Mode, memory/static router and SSR React harnesses.

Corner cases and decisions:

- Test helpers own only resources they create; caller-owned runtimes remain
  caller-owned.
- Leak assertions inspect metadata and never retain resolved objects.

Verification:

- Testing packages and all templates import public entrypoints only.

### Iteration 12 — CLI and templates — complete

Completed:

- Added `create-kvt` templates for core TypeScript, React SPA and React SSR.
- Added generators for modules, plugins, tokens/providers, ViewModels, use cases,
  repositories, features, routes, schemes, queries and tests.
- Added `kvt doctor` checks for versions, ESM, duplicate core, peers, exports,
  decorators, runtime shutdown, module metadata, SSR/theme bootstrap and package
  alignment.

Corner cases and decisions:

- Generators refuse collisions instead of silently overwriting files.
- Generated SPA creates/disposes its router outside React; generated SSR owns one
  runtime per request and closes it in `finally`.

Verification:

- All templates build from packed artifacts outside the workspace.

### Iteration 13 — documentation and examples — complete

Completed:

- Added core, SPA and SSR examples plus task-oriented guides for architecture,
  lifecycle/DI, Flow, React/ViewModels, Router/SSR, theme, query, testing,
  observability, performance, security and publishing.
- Added TypeDoc generation from every public entrypoint and frozen API Extractor
  reports.
- Simplified the React SPA example after usability review: browser page-exit
  wiring now lives in `KvtProvider`, the feature owns a single ViewModel through
  the `viewModel` convenience prop, and no ViewModel registry array lives in
  `main.tsx`.
- Rebuilt the React example with Tailwind CSS 4 and the published
  `@kvt/theme-tailwind/theme.css` mapping. Semantic color, typography, spacing,
  shape, elevation and easing utilities now react to light/dark/system theme
  changes without conditional color classes or inline theme styles.
- Added a complete Russian documentation website with framework-style
  navigation, local full-text search, per-page outline, mobile layout,
  light/dark appearance, a line-by-line React example walkthrough and a linked
  generated API reference. The site covers runtime, DI, ownership, Flow,
  ViewModel, React, Router, SSR, Query, themes, Tailwind, testing, observability,
  CLI, production recipes and troubleshooting.
- Added a deterministic static-site build to the repository gate and a GitHub
  Pages workflow for the public repository.

Public contract changes:

- `KvtProvider` adds default browser `pagehide` forwarding, an opt-out for
  embedded/custom hosts and a configurable shutdown timeout.
- `KvtViewModelScope` accepts either one `viewModel` or a `viewModels` collection;
  passing both is a configuration error.
- `@kvt/theme-tailwind/theme.css` is an explicit public CSS export.

Corner cases and decisions:

- A persisted `pagehide` means the document entered the browser back/forward
  cache; its live runtime is preserved. Ordinary provider unmounts also leave
  the root runtime alive.
- ViewModel ownership remains visible at the feature/screen boundary because
  hiding that boundary would make its lifetime ambiguous. Only the repetitive
  array plumbing was removed from the common one-ViewModel case.
- Tailwind mappings remain opt-in and namespaced; importing them does not style
  `html` or `body` and does not move product design into the framework.

Verification:

- TypeDoc runs with warnings treated as errors while excluding external peer
  implementation members.
- The website produces 33 documentation pages plus 328 generated API pages;
  the TypeDoc entrypoint and local search index are present in the artifact.
- The root build and the `/kvt/` GitHub Pages base build both resolve internal
  navigation and assets correctly.
- HTTP preview smoke checks return `200` for the home page, React walkthrough,
  DI guide and generated API reference; desktop and mobile layouts were
  visually reviewed.
- Examples and the documentation site build during the normal repository gate.

### Iteration 14 — stabilization and release — blocked

Completed:

- Node 20/22/24, React 18.3/19, Router 7/8, Linux CI and macOS/Windows smoke
  workflows are defined.
- Browser E2E passes in Chromium, Firefox and WebKit.
- Package size budgets, dependency cycles, tarball integrity, source maps,
  explicit Vite/Rollup/Webpack consumers, performance regression, production
  vulnerability, license and SBOM gates exist.
- Release workflow uses OIDC Trusted Publishing, provenance, dependency-order
  publication and clean post-publish SPA/SSR smoke installs.

Measured verification on 2026-08-21:

- Unit/integration: 22 files, 208 tests in the unified coverage run; all pass.
- Browser E2E: 6 scenarios across three engines; all pass.
- Memory: 10,000 ViewModel cycles; `rootChildren=0`, `rootResources=0`,
  `subscribers=0`, retained heap delta about 0.02 MiB.
- SSR soak: 1,000 isolated request runtimes; all shut down.
- Gzip: core 8.78 KiB, Flow 5.96 KiB, React 3.36 KiB, router 1.95 KiB;
  all packages are below their budgets.
- Production dependency audit: zero known vulnerabilities.
- Actual unified source coverage: 95.84% statements, 92.41% branches,
  94.19% functions and 97.57% lines. Critical lifecycle/runtime, DI,
  StateFlow/SharedFlow/subscription and hydration branch thresholds are 100%.
- Mutation score: 85.86% against the enforced 85% breaking threshold across
  runtime/lifecycle, DI registry/scope, StateFlow/SharedFlow and hydration.
  Lifecycle and hydration score 100%, provider registry 95.63% and StateFlow
  92.00%.
- Full repository gate, packed consumer installs, API reports, package quality,
  license check, CycloneDX SBOM generation and production audit all pass.

Corner cases discovered during stabilization:

- A Flow subscribed with an already-aborted signal could close before cleanup
  registration and leave `done` unsettled. Cleanup is now registered before
  cancellation and covered by a regression test.
- `callbackFlow` could miss cancellation if the signal aborted between producer
  setup and abort-listener registration. It now checks the signal again after
  setup and has a deterministic regression test.
- Redundant defensive branches that contradicted established runtime/registry
  invariants were removed, leaving one canonical validation path instead of
  untestable duplicate states.
- Browser-only router tests explicitly select jsdom so package-local test runs
  use the same environment as the unified test suite.

Open external blocker; the `v1.0.0` tag and npm publication are forbidden until
it is closed:

1. Control of the npm `@kvt` organization and its Trusted Publisher mapping
   cannot be established from this local repository.

Resolved after the initial stabilization: every root/package manifest now uses
the real `ya-araik/kvt` repository, GitHub Pages documentation URL and GitHub
issue tracker. The release verifier no longer depends on placeholder metadata.

Technical debt affecting the next stabilization pass:

- API Extractor currently bundles TypeScript 5.9 while the newest matrix uses
  TypeScript 6; reports pass but emit an upstream-version advisory.
- DevTools exposes the required safe runtime graph/timeline, but richer router,
  Flow-buffer and query metadata should only be added with explicit bounded,
  redacted contracts.
