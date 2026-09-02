# Testing

KVT testing APIs повторяют ownership production-кода. Test, который не закрывает
runtime/subscription, считается незавершённым.

Главная цель — проверить не только returned value, но и lifecycle: кто запускает
работу, что происходит при cancellation и какие resources остаются после
сценария. Поэтому production abstractions не заменяются скрытым global test
container.

## Какой уровень выбрать

| Что проверяем               | Инструмент                                  |
| --------------------------- | ------------------------------------------- |
| Чистое domain правило       | обычный unit test без runtime               |
| Use case + fake repository  | прямой constructor или `TestRuntimeBuilder` |
| Emission ordering/time      | `FlowTurbine` + `VirtualScheduler`          |
| ViewModel state и cleanup   | test owner/runtime                          |
| React binding и Strict Mode | `renderKvt`                                 |
| Navigation, loaders, owners | router harness                              |
| Реальный user journey       | browser E2E                                 |

Не поднимайте runtime для функции, которой DI и lifecycle не нужны. Но если
production bug связан с ownership, test тоже должен воспроизвести owner boundary.

## TestRuntimeBuilder

```ts
const runtime = await new TestRuntimeBuilder()
  .module(usersModule)
  .override(bind(UsersRepository).to(FakeUsersRepository).singleton())
  .build();

try {
  const useCase = runtime.resolve(LoadUsersUseCase);
  // assertions
} finally {
  await runtime.shutdown({ reason: "test-complete" });
  assertRuntimeReleased(runtime);
}
```

Override автоматически получает explicit `override: true`; running registry не
мутируется.

Создавайте новый runtime на test либо в `beforeEach`. Общий mutable runtime на
suite связывает порядок тестов через singleton state и скрывает утечки.

## FlowTurbine

```ts
const turbine = collectFlow(source);

expect(await turbine.awaitItem()).toEqual(first);
expect(await turbine.awaitItem()).toEqual(second);
await turbine.awaitComplete();
```

Доступны `awaitError`, `expectNoEvents`, `cancel` и
`cancelAndIgnoreRemainingEvents`.

## Virtual time

```ts
const scheduler = new VirtualScheduler();
const output = debounce(source, 300, scheduler);

scheduler.advanceBy(300);
```

Не используйте реальные `setTimeout` в operator tests.

## React harness

```tsx
const result = renderKvt(<UsersScreen />, {
  runtime,
  strict: true,
});
```

Strict Mode включён по умолчанию. Harness передаёт runtime, optional hydration и
не скрывает teardown runtime, которым владеет test.

## Router harness

```tsx
const result = renderKvtRouter({
  runtime,
  routes,
  initialEntries: ["/users"],
});

await result.disposeRouter();
```

Static helper возвращает либо real `Response`, либо static router/context — это
позволяет тестировать redirect и loader errors без browser.

## Query test client

```ts
const client = createTestQueryClient(runtime);
```

Default stale/cache time бесконечен, чтобы wall clock не делал test flaky.

## Plugin contract

```ts
await verifyPluginContract(thirdPartyPlugin);
```

Проверяется bootstrap, повторный idempotent shutdown и отсутствие retained root
resources.

## Что тестировать у ViewModel

- initial state до start;
- transition `created → running`;
- cancellation старой generation;
- state после success/failure;
- resources освобождены после stop;
- late async result не меняет stopped model;
- несколько consumers используют один owner instance.

Удобно разделять test на три фазы: создать owner и активировать model, выполнить
intent, затем закрыть owner и проверить отсутствие late updates. Assertion
после teardown часто обнаруживает ошибки, которых не видно по финальному state.

## Quality layers repository

- unit/integration tests;
- strict coverage thresholds;
- property tests state machines/buffers;
- mutation testing critical code;
- React Strict Mode tests;
- browser E2E Chromium/Firefox/WebKit;
- 10 000-cycle memory soak;
- 1 000-request SSR soak;
- packed tarball consumer tests.

Тесты должны импортировать public package entrypoints, а не `src/internal`.
