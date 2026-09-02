# Переход с unpublished prototype

Эта страница нужна только разработчикам, которые тестировали ранний локальный
prototype. Публичной совместимости с ним нет.

Если проект создавался через актуальный `npm create kvt`, эту главу можно
пропустить. Не используйте таблицу как список deprecated API публичного 1.x:
слева перечислены только unpublished prototype helpers.

| Prototype                                | KVT 1.0                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `provideSingleton(token, deps, factory)` | `provide(token).inject(...deps).using(factory).singleton()` |
| `provideScoped` / `provideTransient`     | `.scoped()` / transient по умолчанию                        |
| `provideValue(token, value)`             | `provide(token).value(value)`                               |
| `provideAlias(token, target)`            | `bind(token).toExisting(target)`                            |
| `createViewModelKey` + `defineViewModel` | class binding с `.viewModel()`                              |
| `KvtViewModelScope viewModel={...}`      | automatic route owner или локальный `KvtViewModelOwner`     |
| route `scope` / `viewModelOwner` flags   | обычный `RouteObject`                                       |

Порядок перехода:

1. Заменить repository interfaces на abstract classes там, где нужен runtime
   identifier.
2. Перенести constructor dependencies в `.inject()`.
3. Зарегистрировать ViewModel в module через `.viewModel()`.
4. Заменить hook key на `useViewModel(MyViewModel)`.
5. Удалить per-page owner JSX и route lifecycle flags.
6. Перенести подписки/операции в `viewModelScope`.
7. Запустить `kvt doctor`, typecheck и Strict Mode tests.

Compatibility shim намеренно отсутствует: смешение двух ownership-моделей
создавало бы неочевидный lifecycle.

## Как понять, что миграция закончена

- `kvt doctor` не находит legacy names и ручные route flags;
- все ViewModel создаются owner API и зарегистрированы через `.viewModel()`;
- subscriptions/operations принадлежат `viewModelScope` или другому явному owner;
- Strict Mode test не даёт двойного start и late state update;
- router/runtime teardown освобождает resources;
- imports идут только через public package entrypoints.

После этого удалите временные adapters целиком. Оставленный wrapper со старым
именем продолжает распространять прежнюю ownership model по новому коду.
