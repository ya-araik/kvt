# Типичные ошибки

Сначала определите, на каком этапе возникла проблема: graph validation,
resolve, owner start, active operation или cleanup. Затем смотрите стабильный
`KvtError.code`, `path` и diagnostics timeline. Исправление только видимого
симптома — например, увеличение shutdown timeout — часто маскирует неверный
owner.

Рекомендуемый порядок проверки:

1. Запустите `kvt doctor`, typecheck и relevant test.
2. Найдите первый failure event, а не последний каскадный exception.
3. Проверьте identity runtime/module/token и текущий scope.
4. Проверьте owner ресурса и момент его закрытия.
5. Воспроизведите cancellation/Strict Mode, если проблема исчезает в happy path.

## `KvtProvider requires a running runtime`

Provider получил runtime до окончания `await bootstrapKvt()` либо после
shutdown. Создавайте root только после успешного bootstrap.

## `runtime identity changed without remounting`

В prop передан другой runtime тому же Provider. Runtime — application identity,
его нельзя переключать как обычный state. Remount whole host boundary.

## `No provider registered for ...`

Class/token отсутствует в modules текущего scope. Проверьте:

- импортирован ли тот же class/token identity;
- включён ли module;
- не закончился ли feature scope;
- requirement и provider definition;
- `KvtError.path`.

Если ошибка появляется только в lazy route, provider, вероятно, зарегистрирован
в feature scope, но resolve начался из root или уже закрытого route owner.

## `requires resolveAsync()`

Sync resolve дошёл до explicit async provider. Используйте `resolveAsync()` или
сделайте dependency sync, если она реально не требует async startup.

## `Circular dependency`

Path показывает cycle. Lazy может технически отложить resolve, но чаще правильнее:

- выделить interface;
- перенести coordination в use case;
- использовать event;
- разделить service на две ответственности.

## `KVT_VIEW_MODEL_OWNER_REQUIRED`

ViewModel пытаются получить обычным `resolve()`. Зарегистрируйте класс через
`.viewModel()` и используйте `useViewModel(MyViewModel)` либо owner API.

## ViewModel не найдена

Проверьте, что module содержит `bind(MyViewModel).inject(...).viewModel()`, а UI
находится под KVT route owner или explicit `KvtViewModelOwner`.

## ViewModel запускается дважды

Проверьте, что instance не создаётся вручную в component и один owner boundary
не меняет class/key/owner identity во время render.

Strict Mode сам по себе не должен давать второй настоящий start.

Добавьте diagnostics по owner ID и lease count. Два разных owner IDs означают
нестабильную route/local boundary; один ID с двумя starts — нарушение lifecycle,
которое нужно свести к минимальному Strict Mode test.

## StateFlow не обновил React

Чаще всего snapshot мутирован на месте:

```ts
state.value.items.push(item); // ошибка
state.set(state.value); // Object.is считает value прежним
```

Создайте новый object/array.

## Слишком много React renders

- Используйте `selector` в `useStateFlow`.
- Стабилизируйте selector/equality identity.
- Не публикуйте новый snapshot, если semantics не изменились.
- Разделите слишком большой presentation state на осмысленные slices.

## SharedFlow потерял событие

При `replay: 0` событие до subscription намеренно теряется. Если новый consumer
обязан узнать информацию, это, вероятно, StateFlow. Либо настройте replay.

Для business-команды, которую нельзя потерять, нужен direct call/persistent
queue, а не увеличение replay UI event stream.

## `tryEmit()` вернул false

Subscriber buffer заполнен при policy `suspend` или `error`. Используйте awaited
`emit()`, увеличьте bounded capacity или выберите осмысленную drop policy.

## Старый async result перезаписал новый

Используйте `TaskController({ policy: 'latest' })` либо самостоятельно сравнивайте
generation. Abort alone недостаточен: Promise может resolve поздно.

## Theme не меняется

Проверьте:

- `KvtThemeProvider target` является ancestor UI;
- импортирован `@kvt/theme-tailwind/theme.css`;
- Tailwind plugin подключён;
- используется `bg-kvt-*`, а не hardcoded color;
- custom theme object не пересоздаётся бесконечно.

## Theme мигает при SSR

Добавьте pre-hydration script до CSS/React и передайте CSP nonce. Server initial
preference должен совпадать с client defaults/cookie policy.

## Feature остаётся после route exit

Проверьте nested active matches и unreleased manual handles. Для host teardown
вызовите `disposeKvtRouter()`. `runtime.inspect()` показывает reference count.

## Shutdown завис

- Resource игнорирует `ShutdownContext.signal`.
- Cleanup ждёт operation, которая сама ждёт owner.
- Network API не имеет timeout.
- Resource создаётся после начала shutdown.

Runtime aborts по timeout и возвращает AggregateError; исправьте resource
contract, а не увеличивайте timeout бесконечно.

## Hydration mismatch

Server и client создали разные initial snapshot для одного key. Проверьте:

- одинаковый route manifest/data;
- deterministic serializer;
- request-local runtime;
- отсутствие Date/random в initial state;
- hydrate до первого client snapshot.

## Package работает в workspace, но не после install

Запустите `npm run check:packages`. Он pack-ит artifacts и устанавливает их без
workspace symlinks, выявляя missing exports/files/dependencies.

## Если ответа здесь нет

Соберите минимальный reproduction с public imports, версией пакетов, error code
и redacted diagnostics export. Не прикладывайте service values, query payload,
cookies или hydration state пользователя.
