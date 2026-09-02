# SSR и hydration

SSR в KVT строится вокруг request isolation и explicit state serialization.

Здесь есть три независимых lifecycle: server request, HTML/stream response и
client runtime после hydration. Server resources не передаются клиенту — между
ними проходит только явно сериализованный JSON contract.

## Один request — один runtime

```ts
export async function handle(request: Request) {
  const runtime = await bootstrapKvt({ modules });
  let handler: object | undefined;

  try {
    handler = createKvtStaticHandler({ runtime, routes });
    return await renderRequest(runtime, handler, request);
  } finally {
    if (handler) await disposeKvtRouter(handler);
    await runtime.shutdown({ reason: "ssr-request-complete" });
  }
}
```

Глобальный runtime на server запрещён: users могут разделить scoped instances и
state.

Если bootstrap modules дороги, кешируйте immutable definitions или compiled
configuration, но не сам runtime, scope, query client либо ViewModel. Всё, что
содержит request state или cleanup, создаётся заново на request.

## Hydration state создаётся явно

```ts
const hydration = createHydrationState([
  {
    key: "users.list",
    flow: usersViewModel.state,
    serialize: serializeUsersState,
  },
]);
```

Unkeyed StateFlow автоматически в HTML не попадает.

## Безопасная сериализация

```ts
const json = serializeHydrationState(hydration);
```

Serializer экранирует `<`, `>`, `&`, U+2028 и U+2029, чтобы JSON нельзя было
превратить в закрывающий `</script>`.

Разрешены только deterministic JSON values:

- finite numbers;
- strings/booleans/null;
- dense arrays;
- plain objects без cycles и symbol keys.

Class instances, Map, Set, functions и `undefined` нужно преобразовать явно.

## Client

```tsx
const hydration = parseHydrationState(serializedFromServer);

root.render(
  <KvtProvider runtime={runtime} hydration={hydration}>
    <App />
  </KvtProvider>,
);
```

```tsx
const users = useStateFlow(viewModel.state, {
  stateKey: "users.list",
  deserialize: deserializeUsersState,
});
```

Server/client initial snapshots обязаны совпасть. Mismatch означает data или
deployment bug и сообщает key без state value.

## Что нельзя сериализовать

- DI tokens и service objects;
- credentials/cookies;
- private query cache целиком;
- AbortSignal;
- arbitrary ViewModel;
- state другого request.

Hydration — whitelist, не snapshot heap.

Перед добавлением key проверьте:

- нужен ли snapshot для первого client render;
- не содержит ли он данные, которые нельзя помещать в HTML;
- одинаковы ли serializer и deserializer на обеих сторонах;
- стабилен ли key между версиями server/client bundle.

Query cache и screen StateFlow гидратируются разными механизмами. Не копируйте
весь query cache в `createHydrationState()` и не используйте screen-state key
как query key: у них разные правила freshness и invalidation.

## Streaming

Runtime и router должны жить до stream completion/abort. Нельзя закрывать их
сразу после получения stream handle.

Правильный owner — request processing task, который знает, когда stream реально
завершён.

При disconnect request signal должен пройти в router loaders, use cases и
renderer. Затем host дожидается закрытия stream, вызывает router dispose и
последним шагом shutdown runtime. Это предотвращает I/O после ухода клиента.

## Theme без flash

`KvtThemeBootstrapScript` запускается до CSS/React hydration, читает preference
и выставляет scheme/motion attributes. Передавайте CSP nonce.

Theme script не заменяет hydration application state и не должен содержать
user data.

## SSR checklist

- один runtime на request;
- один query client на соответствующий request scope;
- shared route manifest для server/client;
- explicit hydration keys;
- XSS-safe serializer;
- CSP nonce;
- router dispose и runtime shutdown в `finally`;
- aborted connection отменяет loaders/rendering.

В production также убедитесь, что client и server используют совместимый route
manifest и build version. Hydration mismatch после rolling deploy часто
означает, что HTML от новой версии загрузил старый client bundle или наоборот.
