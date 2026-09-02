# `@kvt/core`

Renderer-independent async runtime, deterministic lifecycle, explicit DI,
modules, trusted plugins, unloadable feature scopes, typed ViewModel ownership,
Result and UseCase contracts. `ViewModelScope.run()` supplies cancellation to
input and `NoInputUseCase` operations without application-level signal
plumbing. Flow primitives are re-exported from `@kvt/flow`.

```ts
const runtime = await bootstrapKvt({ modules: [appModule] })
try {
  runtime.resolve(serviceToken).run()
} finally {
  await runtime.shutdown({ reason: 'application-stop' })
}
```
