# `@kvt/react`

React renderer adapter with a required external runtime, concurrent-safe Flow
subscriptions, explicit ViewModel owner boundaries, error/Suspense boundaries
and keyed SSR hydration. It does not create the root runtime or tie its lifetime
to a React unmount. In browsers, `KvtProvider` forwards a non-bfcache `pagehide`
to `runtime.shutdown()` by default; non-browser hosts still close the runtime
explicitly.
