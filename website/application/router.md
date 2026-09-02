# Router и automatic owners

`@kvt/router-react` сохраняет полный React Router API и автоматически добавляет
ViewModel ownership.

Adapter нужен, когда lifetime ViewModel или lazy DI feature совпадает с route
match. Если приложение использует только React components и не создаёт
route-scoped resources, обычного React Router достаточно.

## Обычные routes

```tsx
const routes = [
  { path: "/", Component: TodoPage },
  { path: "/about", Component: AboutPage },
];

const router = createKvtBrowserRouter({ runtime, routes });
```

Не нужно указывать scope/owner metadata. Router создаёт owner для каждого
активного layout/leaf match и закрывает после ухода.

Для маршрута `/teams/:teamId/users/:userId` ownership tree соответствует
активным matches:

```text
root runtime
└─ teams layout owner
   └─ team :teamId owner
      └─ user :userId owner
```

Layout ViewModel живёт при переходах между дочерними users, а leaf ViewModel
закрывается при смене `userId`. Это позволяет описывать lifetime структурой
routes вместо ручных JSX providers.

## Identity и corner cases

- revalidation не пересоздаёт owner;
- изменение search params сохраняет owner;
- изменение path params создаёт новый owner;
- старый route живёт до commit нового;
- failed loader сохраняет старый committed match;
- cancelled navigation не оставляет scope/owner;
- back navigation после unmount создаёт новый owner;
- `disposeKvtRouter()` закрывает всё.

Path params входят в identity, потому что обычно выбирают другую domain entity.
Search params owner не пересоздают: сортировку и filter обрабатывайте intent-ом
существующей ViewModel или через loader/revalidation. Если конкретный search
param действительно задаёт новый lifecycle, выделите его в path или создайте
явную локальную owner boundary.

## Lazy DI feature

Для feature module, diagnostics и unload policy используйте `withKvtRoute`:

```ts
withKvtRoute(
  {
    path: "/reports",
    loader: loadReports,
    lazy: () => import("./reports-route.js"),
  },
  {
    featureModule: reportsFeature,
    diagnostics: true,
    unload: "on-route-exit",
  },
);
```

Feature готова до loader/action/component access. Navigation AbortSignal
отменяет waiter; параллельный waiter той же feature продолжает load. Failure не
кешируется навсегда.

Порядок navigation с feature:

1. React Router начинает navigation и создаёт signal.
2. KVT загружает и валидирует feature module.
3. Создаются feature scope и route owner.
4. Loader/action и component получают доступ к готовым dependencies.
5. Только успешный committed match становится текущим.
6. После route exit освобождается reference; последняя reference закрывает
   feature scope.

## Upstream semantics

Returned/thrown `Response`, redirect, loader/action errors, middleware,
handles, revalidation, pending UI и blocking остаются semantics React Router.
KVT оборачивает только preparation, diagnostics и ownership.

## Feature scope

`useKvtRouteScope()` доступен только route с feature metadata. Обычно ViewModel
получает services через DI, поэтому resolve в component не нужен. Никогда не
сохраняйте route scope в root singleton.

## Memory/static

```ts
createKvtMemoryRouter({ runtime, routes, initialEntries: ["/"] });
createKvtStaticHandler({ runtime, routes });
createKvtStaticRouter(dataRoutes, context);
```

Все adapters получают те же prepared route objects и automatic owners.

## Dispose

```ts
await disposeKvtRouter(router);
```

Нужно при test teardown, HMR/micro-frontend unload и для static handler после
request. Полный runtime shutdown остаётся последней страховкой ownership tree.

Не вызывайте dispose после каждого navigation: router владеет всем деревом
matches, а не одной страницей. В browser SPA его lifecycle обычно совпадает с
mount/unmount всего приложения.
