# Changelog

All notable KVT changes are documented here. The project follows Semantic
Versioning.

## 1.0.0 - unreleased

- ESM-only renderer-independent runtime with explicit async bootstrap/shutdown.
- Immutable DI graphs, requesting-scope resolution, modules, local plugins and
  unloadable feature scopes.
- Separate cold Flow, StateFlow and SharedFlow packages with backpressure,
  schedulers, operators and task state.
- Owner-bound ViewModels, React Strict Mode integration and keyed SSR hydration.
- Scope-bound use-case execution with `ViewModelScope.run()`, `NoInputUseCase`
  and parameterless stream-producing use cases.
- Thin React Router adapters, neutral scoped themes and a hook-free query facade.
- Testing SDK, OpenTelemetry mapping, versioned DevTools protocol and CLI.
