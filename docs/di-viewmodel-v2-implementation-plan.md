# DI and ViewModel v2 implementation progress

This document is the execution log for the consumer-first DI, ViewModel and
router redesign. The Todo templates are the public-contract source of truth.
An iteration may be marked complete only when its listed gate is green.

## Fixed decisions

- Public registration has two roots only: `bind()` and `provide()`.
- An unqualified binding is transient. `singleton()`, `scoped()` and
  `viewModel()` are explicit, mutually exclusive lifecycle modifiers.
- Concrete and abstract classes are valid runtime identifiers. Tokens remain
  for values, qualifiers, interfaces with no runtime value and multi-bindings.
- Constructor dependencies are explicit through `inject()` and are checked
  against the implementation constructor tuple by TypeScript.
- Unregistered classes are never constructed implicitly.
- A ViewModel is a DI binding with owner-managed lifecycle, not a React
  definition. Its constructor is pure; `onStart()` runs after owner commit.
- Browser and memory routers create route owners automatically. Static/SSR
  runtimes remain request-owned and never share instances between requests.
- React may prepare a pure ViewModel during render, but only a committed owner
  may start it. Tentative, never-committed entries are reclaimed safely.
- Expected business failures use typed `Result` values. Unexpected framework
  and infrastructure failures retain stable `KvtError` codes and causes.
- `@kvt/core` remains renderer-neutral. React/router packages only adapt owner
  commit and teardown signals.
- The unpublished prototype API receives no compatibility shim.

## Removed prototype surface

- `provideSingleton`, `provideScoped`, `provideTransient` and async variants;
- `provideValue` and `provideAlias`;
- `ViewModelKey`, `createViewModelKey`, `ViewModelDefinition` and
  `defineViewModel`;
- per-screen `KvtViewModelScope viewModel={...}` definitions;
- normal-route `scope: 'route'` and `viewModelOwner: true` metadata.

## Iteration status

| Iteration | State | Gate |
| --- | --- | --- |
| 0. ADR/progress contract | complete | Decisions recorded here |
| 1. Golden Todo templates | complete | Generated core/SPA/SSR typecheck and unit/SSR smoke |
| 2. Class identifiers | complete | Core DI tests and negative type fixtures green |
| 3. `bind`/`provide` DSL | complete | Immutable/type-safe builder tests green |
| 4. DI engine migration | complete | Full core lifecycle suite green |
| 5. ViewModel DI lifecycle | complete | Owner/instance-key/failure tests green |
| 6. `viewModelScope` | complete | Collection/launch/task cancellation and reverse cleanup green |
| 7. React lifecycle | complete | Strict/Suspense/aborted render tests green |
| 8. Automatic route owners | complete | Plain browser/memory/static routes and owner cleanup green |
| 9. SSR/hydration | complete | Request isolation, safe serialization and 1,000-request soak green |
| 10. CLI/generators | complete | Generators and expanded legacy/incompatible-chain doctor green |
| 11. Green Todo tarballs | complete | Core/SPA/SSR clean tarball installs, tests and builds green |
| 12. Performance/stability | complete | Strict coverage, mutation, memory, size and benchmark gates green |
| 13. Examples | complete | All examples share the public Todo architecture |
| 14. Documentation | complete | Web docs, TypeDoc, snippets, links, search and `/kvt/` build green |

## Package boundaries

```text
@kvt/flow ───────────────┐
                         ├── @kvt/core ── @kvt/react
                         │       │             │
                         │       └─────────────┴── @kvt/router-react
@kvt/theme-core ─────────┴── @kvt/theme-react / @kvt/theme-tailwind
```

Core never imports React, React Router, browser globals or template code.

## Progress log

### 2026-08-22 — Iteration 0

- Recorded the v2 public grammar, lifecycle ownership rules and removed API.
- Chose real on-disk templates over generated source strings.
- Chose abstract repository contracts in Todo templates to demonstrate
  class-key binding without unnecessary tokens.
- Kept the renderer-less core template headless; SPA and SSR templates own the
  ViewModel/navigation presentation layer.

Next: author all three golden Todo templates before changing framework
internals.

### 2026-08-22 — Iterations 1–5 and React contract

- Added real layered templates under `packages/create-kvt/templates`:
  `shared-todo`, `core`, `spa` and an SSR overlay.
- Moved project creation out of string literals and out of `@kvt/cli`.
  `create-kvt` now copies deterministic layers, substitutes project/version/
  package-manager placeholders and refuses non-empty targets.
- Implemented constructor identity in registry lookup and diagnostics. Equal
  class names do not collide and unregistered classes remain errors.
- Added immutable `bind`/`provide` builders with transient defaults, typed
  constructor injection, async factories, aliases, values, explicit override,
  eager cached providers and mutually exclusive ViewModel lifetime.
- Removed every legacy helper from the public core implementation and migrated
  framework tests rather than adding a compatibility adapter.
- Added compile-time negative fixtures for dependency order/arity, incomplete
  abstract bindings and invalid lifetime chains.
- ViewModels are now instantiated only through `ViewModelOwner`; ordinary
  `resolve()` returns `KVT_VIEW_MODEL_OWNER_REQUIRED`. Owners key entries by
  constructor identity and optional instance key.
- React `useViewModel(MyViewModel)` acquires a tentative lease, commits start in
  a layout effect and reclaims abandoned renders. The optional explicit
  boundary is now `KvtViewModelOwner` and carries no provider definitions.
- Browser/memory route objects receive owners automatically. Path params enter
  owner identity; search params do not. KVT route metadata is limited to lazy
  feature, diagnostics and unload policy.
- Added an SSR Todo request renderer with one runtime per request, safe empty
  hydration state, theme pre-hydration script, CSP nonce and `finally` cleanup.
- Current green evidence: all package builds; 62 core, 18 React and 12 router
  tests; all workspace package tests; generated core/SPA typecheck and tests;
  generated SSR typecheck and request-isolation smoke.

New corner cases retained for the next iterations:

- exercise every `viewModelScope` operation under cancellation and failure;
- assert automatic owner disposal for static/SSR aborted requests;
- install generated projects from packed tarballs instead of workspace links;
- replace temporary Counter examples with the same Todo architecture;
- regenerate API reports only after the public contract is final.

### 2026-08-22 — Iterations 6–10

- Added renderer-neutral `ViewModelScope` ownership for Flow collections,
  launched work, policy-driven tasks and low-level resources. Shutdown aborts
  all work, ignores late cancelled results and performs reverse cleanup.
- Completed owner-managed class ViewModels. Ordinary DI resolution of a
  `.viewModel()` binding is rejected with `KVT_VIEW_MODEL_OWNER_REQUIRED`;
  `(owner, class, instanceKey)` is the only instance cache key.
- Route components, elements, layouts and lazy components now receive an
  automatic owner. Path parameters participate in owner identity while search
  parameters and revalidation preserve the existing owner.
- Static handlers use the same prepared route manifest. Request runtimes and
  routers are closed in `finally`; ViewModels never start from speculative SSR
  render work.
- Migrated every generator to `bind`/`provide`, abstract repository contracts,
  typed use-case failures and ordinary route objects. `kvt doctor` now reports
  removed provider helpers, ViewModel definitions, manual route ownership,
  unnecessary class tokens and incompatible lifecycle chains.

Corner cases resolved:

- Strict Mode setup/cleanup/setup retains one committed ViewModel;
- an aborted render cannot leave an uncommitted ViewModel or child scope;
- failed factories close their child scope;
- failed `onStart()` rolls back only resources from that attempt;
- multiple consumers share one owner entry without making a hook its owner;
- feature scope unload waits for route-owned ViewModel cleanup.

### 2026-08-22 — Iterations 11–13

- Removed `expected-red`: `create-kvt` is packed first, then core, SPA and SSR
  projects are generated into clean temporary directories with no KVT
  workspace symlinks.
- Each generated project passes TypeScript and tests. SPA and SSR pass client
  production builds; SSR also passes its server build and request isolation
  tests. The generated SPA Playwright smoke runs from packed artifacts in the
  browser CI job.
- Rollup and Webpack consume only public packed entrypoints. Direct Node ESM
  imports, source maps with `sourcesContent`, declarations, `publint` and
  AreTheTypesWrong all pass for every public package.
- Replaced Counter examples with the same Todo domain/repository/use-case/
  ViewModel/module/routes structure used by the templates.
- Browser E2E now verifies validation, add/toggle/remove, singleton repository
  state across route owner replacement and semantic Tailwind theme switching
  in Chromium, Firefox and WebKit.

Quality evidence:

- strict coverage: 95.94% statements, 91.76% branches, 94.53% functions and
  97.67% lines;
- mutation score: 85.59% with an enforced 85% break threshold;
- memory soak: 10,000 ViewModel owner cycles, 10,000 starts/stops/disposals,
  zero root children/resources/subscribers and 0.04 MiB retained heap;
- SSR soak: 1,000 isolated request runtimes rendered and shut down;
- benchmarks: 89,393,465 StateFlow writes/s, 31,394 transient resolutions/s
  and 332,696 runtime cycles/s, all above committed gates;
- public gzip sizes remain below every package budget (`@kvt/core` 10.17 KiB,
  `@kvt/flow` 5.96 KiB, `@kvt/react` 3.03 KiB,
  `@kvt/router-react` 2.23 KiB).
- both renderer peer fixtures build, typecheck and test: React 18.3 with React
  Router 7, and React 19 with React Router 8.

### 2026-08-22 — Iteration 14

- Rebuilt the documentation around the Todo application: domain, abstract
  repository, typed failures, use cases, ViewModel, module, plain routes,
  React UI, lifecycle and testing.
- Rewrote DI, ViewModel, React, router/SSR, CLI, operations, recipes, glossary
  and troubleshooting pages for the v2 API.
- Added an explicit prototype migration page; removed all legacy API from
  current guides and examples.
- Added a documentation contract gate that syntax-checks TypeScript/TSX code
  fences, validates internal links and enforces the golden Todo source shape.
- Regenerated API Extractor reports and TypeDoc from public entrypoints. The
  VitePress website builds with the public base `/kvt/`.
- Added the real `ya-araik/kvt` repository, GitHub Pages homepage and issue
  tracker metadata to every publishable package manifest.

Final retained rule: any future API change starts in the real Todo templates,
then updates framework contracts, tests, examples and documentation in that
order. No unresolved v2 corner case is deferred to a later iteration.

### 2026-08-22 — Unit Result ergonomics

- Added `ok(): Ok<void>` alongside `ok(value)` so commands returning
  `Result<void, E>` no longer expose `ok(undefined)` in application code.
- Updated Todo templates, all examples, the use-case generator, public API
  report and Result documentation.
- Verified type inference, core/CLI/template/example tests, clean packed
  core/SPA/SSR consumers and the VitePress build.

### 2026-08-22 — Clean Architecture project layout

- Verified the project convention against Robert C. Martin's Dependency Rule
  and the Android/Kotlin domain-layer guidance. Clean Architecture does not
  prescribe directory names, so ADR 0007 records KVT's explicit convention.
- Reorganized the shared Todo sources, core/SPA/SSR templates and all examples
  into `domain/model`, `domain/repository`, `domain/usecase`,
  `data/repository`, `presentation/model`, `presentation/viewmodel`,
  `presentation/view`, `app/di` and `app/navigation`.
- Kept business/domain failures in `domain/model/failure` and UI error state in
  `presentation/model`. Data-source exceptions must be mapped before crossing
  a repository port; unexpected framework defects remain `KvtError`.
- Moved UUID generation out of the use case and into the in-memory data adapter
  so the domain use-case layer does not reference a host global.
- Updated `kvt generate` to select canonical layer directories. Use-case
  generation now atomically creates a companion domain failure model and rolls
  back files if generation fails partway.
- Extended `check:boundaries` to reject reverse layer imports, framework globals
  in domain, renderer imports in domain/data, flat obsolete layer files and
  misplaced business/UI error declarations.
- Added a complete VitePress Clean Architecture guide, updated Todo/CLI guides,
  and added source-contract assertions for domain and presentation errors.

Quality gate:

- lint passed with zero warnings;
- CLI, create-kvt, core example, SPA example and SSR example typechecks/tests
  passed;
- full monorepo package/examples build passed;
- clean packed core, SPA and SSR projects installed, tested and built without
  workspace symlinks;
- Rollup/Webpack packed consumer smoke passed;
- boundary and documentation contract checks passed;
- TypeDoc and VitePress production build passed.
- Added a root `prepare` build for workspace declarations. Fresh contributors
  no longer see transient `Cannot find module '@kvt/flow'` diagnostics in
  examples before their first manual framework build; after an explicit
  `clean`, `build:packages` restores the package export targets.

### 2026-08-22 — Application linting and formatting

- Added publishable `@kvt/eslint-plugin` with ESLint 9 flat-config support.
- Added rules for Clean Architecture dependency direction, canonical domain/UI
  error locations, renderer/host boundaries and removed KVT prototype APIs.
- Added ESLint, React Hooks/Refresh checks and Prettier scripts/configuration to
  all core, SPA and SSR examples and `create-kvt` templates.
- Kept formatting separate from correctness: ESLint owns code and architecture
  rules, while Prettier owns deterministic source formatting.
- Extended packed consumer gates so generated projects run lint and
  `prettier --check` using the packed plugin, not its workspace source.
- Added plugin rule tests, template source-contract tests and a dedicated
  VitePress operations guide.

### 2026-08-22 — Scope-bound use-case execution

- Added `NoInputUseCase<O>` so cancellable operations without an input receive
  `UseCaseContext` directly instead of declaring a placeholder `void` value.
- Added typed `ViewModelScope.run(useCase)` and `run(useCase, input)` overloads.
  The scope supplies its AbortSignal and suppresses a result after owner
  cancellation through the existing launch contract.
- Simplified stream-producing use cases to zero-argument `execute()` methods:
  their producer/subscription lifetime belongs to `viewModelScope.collect()`.
- Migrated Todo templates and all examples away from manual context plumbing.
