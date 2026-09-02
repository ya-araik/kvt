# Modules, plugins и features

Три сущности описывают разные уровни composition.

| Сущность | Содержит                              | Когда устанавливается           |
| -------- | ------------------------------------- | ------------------------------- |
| Module   | providers + requirements + includes   | до bootstrap или внутри feature |
| Plugin   | modules + start/shutdown hooks        | bootstrap                       |
| Feature  | async module loader + отдельный scope | по требованию                   |

Выбирайте сущность по поведению, а не по размеру кода:

- если нужно только добавить providers и проверить зависимости — это module;
- если при запуске и остановке приложения нужно выполнить работу — это plugin;
- если код и его scoped dependencies должны появляться только на время сценария
  или route — это feature.

Сам по себе module не создаёт scope и не означает lazy loading. Он только
описывает часть composition graph.

## Module

```ts
export const usersModule = defineModule({
  id: "users",
  version: "1.2.0",
  requires: [{ id: "network", version: "^1.0.0" }],
  providers: [bind(UsersRepository).to(HttpUsersRepository).scoped()],
});
```

### Зачем модулю `id`

`id` — стабильный уникальный идентификатор модуля внутри одного runtime:

```ts
id: "users";
```

KVT использует его не для DI lookup отдельных классов, а для управления
composition graph целиком:

- обнаруживает повторное подключение и конфликтующие definitions;
- связывает `requires` с нужным модулем;
- показывает понятное имя в ошибках, diagnostics и DevTools;
- дедуплицирует concurrent feature loading;
- отличает один lazy feature от другого при retry и unload.

`id` должен описывать назначение модуля и не зависеть от имени файла или
конкретной реализации. Переименование `users.module.ts` не требует менять
`id: 'users'`. Два разных constructor с одинаковым именем не конфликтуют в DI,
но два разных module definitions с одним `id` считаются конфликтом.

### Зачем модулю `version`

`version` — версия публичного контракта модуля:

```ts
version: "1.2.0";
```

Она позволяет проверить совместимость composition graph **до** создания
singleton, подключения к сети или запуска plugin lifecycle. Это версия именно
модуля, а не состояние данных и не обязательно версия всего приложения.

Другой модуль может объявить требование:

```ts
requires: [{ id: "network", version: "^1.0.0" }];
```

Требование `^1.0.0` принимает совместимые версии `1.x`, например `1.0.0` и
`1.8.2`, но отклоняет `2.0.0`. Если `network` отсутствует или его версия не
подходит, `bootstrapKvt()` завершится понятной ошибкой до частичного запуска
приложения.

Поддерживаются exact-версия, `^`, `~` и `*`:

| Requirement | Принимает                    | Не принимает | Когда использовать             |
| ----------- | ---------------------------- | ------------ | ------------------------------ |
| `1.2.3`     | только `1.2.3`               | любую другую | требуется точный контракт      |
| `^1.2.0`    | совместимые `1.x` от `1.2.0` | `2.0.0`      | обычная зависимость            |
| `~1.2.0`    | совместимые `1.2.x`          | `1.3.0`      | нужен фиксированный minor      |
| `*`         | любую версию                 | —            | версия намеренно не ограничена |

### Когда менять версию

Применяйте semantic versioning к контракту модуля:

- `1.0.0 → 1.0.1` — внутреннее исправление без изменения доступного
  поведения или регистраций;
- `1.0.0 → 1.1.0` — добавлена обратно совместимая возможность;
- `1.0.0 → 2.0.0` — удалён или несовместимо изменён provider, requirement,
  lifecycle либо другой публичный контракт.

Версию не нужно менять после каждого редактирования файла. Для небольшого
локального приложения достаточно начать с `1.0.0` и повышать её, когда модуль
становится зависимостью других модулей или меняет их ожидания.

Коротко: `id` отвечает на вопрос «какой это модуль?», а `version` — «совместим
ли его контракт с остальной системой?».

Definition frozen. Изменение исходного массива providers после `defineModule()`
не меняет module.

KVT проверяет наличие requirements и совместимость до создания resources.

### Includes

```ts
defineModule({
  id: "application",
  version: "1.0.0",
  includes: [networkModule, usersModule],
});
```

Includes позволяют собрать composition tree без мутации registries.

## Plugin

Plugin нужен, когда кроме providers требуется lifecycle hook:

```ts
const analyticsPlugin = definePlugin({
  id: "analytics",
  version: "1.0.0",
  modules: [analyticsModule],
  async start({ scope, emitDiagnostic }) {
    const analytics = await scope.resolveAsync(analyticsToken);
    await analytics.connect();
    emitDiagnostic({
      subsystem: "plugin",
      operation: "connect",
      phase: "success",
    });
  },
  async shutdown(context) {
    await flushAnalytics(context.signal);
  },
});
```

Plugin code считается trusted local/npm code. KVT не загружает executable code
по URL и не создаёт security sandbox.

Plugins стартуют после graph validation, а останавливаются в обратном
dependency order.

## Lazy feature

```ts
const usersFeature = {
  id: "users-screen",
  version: "1.0.0",
  async load({ signal }) {
    const loaded = await import("./users.module.js");
    if (signal.aborted) throw signal.reason;
    return loaded.usersModule;
  },
  retry: { attempts: 3, delayMs: 200 },
} satisfies FeatureDefinition;
```

```ts
const handle = await runtime.loadFeature(usersFeature, signal);
try {
  const repository = handle.scope.resolve(usersRepository);
} finally {
  await handle.release();
}
```

Feature получает отдельный registry и child scope. Root registry после
bootstrap не изменяется.

## Concurrent load

Если две navigation одновременно загружают один `id@version` с одним loader:

- реальный loader выполняется один раз;
- каждый caller получает свой handle/reference;
- feature unload начинается после release последней reference.

Ошибка loader не кешируется навсегда: следующий вызов может retry.

## Cancellation

Loader получает `AbortSignal`. Если navigation отменена:

- caller перестаёт ждать;
- если других waiters нет, общий load abortируется;
- результат после runtime shutdown не устанавливается;
- частично созданный feature scope очищается.

## Conflicts

Framework отклоняет:

- одинаковый feature ID с другой version;
- одинаковый `id@version` с другим loader function identity;
- module с несовместимым requirement;
- установку providers после root registry freeze.

## Router integration

`@kvt/router-react` управляет feature references по active route matches. Loader
готовит feature до обращения к services, а scope закрывается после выхода
последнего nested match. Подробнее: [Router](/application/router).

## Development invalidation

```ts
await runtime.invalidateFeature("users-screen");
const handle = await runtime.reloadFeature(usersFeature);
```

API предназначен для development/HMR. В production invalidation запрещён.

## Жизненный цикл feature по шагам

Для route-based feature полный путь выглядит так:

1. Router находит active route с feature metadata.
2. Runtime вызывает `loadFeature()` и передаёт loader cancellation signal.
3. Loader импортирует module, после чего KVT проверяет его requirements.
4. Для module создаются отдельные registry и child scope.
5. Route получает handle и разрешает scoped services через `handle.scope`.
6. При выходе из route router освобождает reference.
7. После освобождения последней reference KVT закрывает scope и его resources.

Nested routes могут одновременно держать несколько references на одну feature.
Поэтому unload нельзя привязывать к `unmount` случайного React-компонента:
владельцем reference должен оставаться router adapter или другой host, который
видит весь lifecycle сценария.

## Практический выбор

| Задача                                             | Подходящий механизм                        |
| -------------------------------------------------- | ------------------------------------------ |
| Общие repositories и use cases приложения          | module на bootstrap                        |
| Analytics connection с `connect/flush`             | plugin                                     |
| Тяжёлый reports-раздел, открываемый по route       | feature + router metadata                  |
| Небольшой lazy React component без новых providers | обычный `React.lazy` / router lazy         |
| Загрузка недоверенного executable code по URL      | не поддерживается: нужен отдельный sandbox |
