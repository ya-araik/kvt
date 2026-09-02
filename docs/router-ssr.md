# Router and SSR

KVT accepts normal React Router route objects:

```tsx
export const routes = [
  { path: '/', Component: TodoPage },
  { path: '/about', Component: AboutPage }
]

const router = createKvtBrowserRouter({ runtime, routes })
```

Every matched route gets a ViewModel owner automatically. No scope/owner flags
are part of normal application routes.

## Route identity

- nested layouts and leaf routes have separate owners;
- path parameter changes create a new owner;
- query/search changes and revalidation preserve the owner;
- a cancelled navigation leaves no owner or scope;
- the old match remains alive until the replacement commits;
- router disposal closes all owners and feature handles.

## Optional feature metadata

`withKvtRoute()` remains for lazy DI modules, diagnostics and unload policy:

```ts
withKvtRoute(
  { path: '/reports', lazy: () => import('./reports-route.js') },
  { featureModule: reportsFeature, diagnostics: true }
)
```

Loaders/actions keep upstream `Response`, redirect, error and revalidation
semantics. Feature preparation receives the navigation AbortSignal.

## SSR sequence

For every request:

```ts
const runtime = await bootstrapKvt({ modules: [todoModule] })
const handler = createKvtStaticHandler({ runtime, routes })

try {
  const context = await handler.query(request)
  if (context instanceof Response) return context
  const router = createKvtStaticRouter(handler.dataRoutes, context)
  return renderToString(
    <KvtProvider runtime={runtime} hydration={hydration} shutdownOnPageHide={false}>
      <StaticRouterProvider router={router} context={context} />
    </KvtProvider>
  )
} finally {
  await disposeKvtRouter(handler)
  await runtime.shutdown({ reason: request.signal.aborted ? 'request-aborted' : 'request-complete' })
}
```

The server never shares a runtime/repository/ViewModel owner between requests.
ViewModel constructors produce deterministic initial state; server data comes
from loaders/query prefetch. Browser `onStart()` begins only after hydration
commit.

## Hydration and security

- serialize only explicitly registered state keys;
- escape HTML/script separators;
- do not serialize service objects, credentials or arbitrary domain errors;
- pass a CSP nonce to the theme pre-hydration script;
- close runtime/router in `finally`, including aborts and redirects;
- treat snapshot mismatch as a data/deployment defect with a safe key-only
  diagnostic.
