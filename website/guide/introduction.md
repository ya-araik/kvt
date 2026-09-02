# Что такое KVT

KVT — это TypeScript framework для архитектуры приложения. Он не заменяет React,
HTML или CSS. Он отвечает за те части, которые обычно разрастаются вокруг UI:

- создание и завершение приложения;
- dependency injection без decorators и скрытой рефлексии;
- время жизни сервисов и feature-модулей;
- состояние и события в стиле Kotlin Flow;
- ViewModel и границы их владения;
- server state, маршрутизацию, SSR, темы, диагностику и тестирование.

React в этой системе остаётся **renderer**: получает готовое состояние и
отправляет пользовательские intent в ViewModel.

## Зачем это нужно

В небольшом React-приложении допустимо создать API client, store и подписки в
компоненте. По мере роста возникают вопросы:

- Кто должен закрыть WebSocket?
- Один ли экземпляр repository нужен всему приложению или отдельный на экран?
- Что случится, если bootstrap упал после создания половины сервисов?
- Как отменить старый запрос, если пользователь быстро сменил фильтр?
- Почему Strict Mode дважды вызвал effect и разрушил ресурс?
- Почему тесту требуется монтировать всё React-приложение ради use case?

KVT делает ответы частью контрактов framework, а не договорённостями команды.

## Когда KVT полезен

KVT начинает окупаться, когда приложение содержит несколько ресурсов с разным
временем жизни: общий API client, route-specific state, подписку на события,
lazy feature или request-local SSR cache. Framework особенно полезен, если один
business layer должен работать в React, Node.js, SSR и тестах.

Признаки подходящей задачи:

- состояние экрана должно переживать remount компонентов, но исчезать при
  выходе с route;
- repository нужно заменить в тесте или feature scope;
- запросы и подписки обязаны отменяться вместе с владельцем;
- bootstrap состоит из нескольких шагов и требует rollback при ошибке;
- бизнес-правила не должны зависеть от React hooks.

Для маленького статического виджета без сервисов, асинхронного состояния и
lifecycle достаточно обычного React. KVT не требует переносить в DI каждую
чистую функцию или локальный `useState`.

## Главная идея

> Каждый долгоживущий ресурс имеет явного владельца.

Runtime владеет корневыми сервисами и plugins. Feature handle владеет feature
scope. ViewModel owner владеет ViewModel. Подпиской владеет тот код, который её
создал, либо scope, куда она была зарегистрирована.

Когда владелец заканчивает жизнь, он завершает дочерние ресурсы в обратном
порядке создания. Если один cleanup падает, остальные всё равно выполняются.

## Что KVT не делает

KVT намеренно не является:

- UI component kit;
- CSS framework;
- backend framework;
- заменой React Router;
- обёрткой над Redux;
- системой удалённых plugins;
- автоматическим сериализатором всего application state.

Framework соединяет application-слои, но не пытается скрыть их существование.

## Слои приложения

```text
UI (React)
    ↓ intent                 ↑ immutable state
ViewModel
    ↓
Use case
    ↓
Repository interface
    ↑
Infrastructure implementation (HTTP, IndexedDB, Query cache)
```

Направление зависимостей идёт внутрь: domain не знает о React, браузере или
конкретном HTTP client. Infrastructure подключается через DI module.
Полная карта каталогов и разрешённых импортов находится в разделе
[Clean Architecture в KVT-проекте](/guide/clean-architecture).

## Что происходит после клика

На примере добавления Todo полный путь выглядит так:

```text
button onClick
  → TodoListViewModel.addTodo()
  → viewModelScope.run(AddTodoUseCase, input)
  → TodoRepository.add(input, signal)
  → repository обновляет StateFlow
  → ViewModel получает новый snapshot
  → useStateFlow сообщает React об изменении
  → React перерисовывает список
```

Каждая стрелка имеет отдельную ответственность. Component переводит DOM event
в intent. ViewModel координирует presentation state. Use case проверяет
business rule. Repository скрывает способ хранения. Flow доставляет immutable
snapshot. Благодаря этому use case и repository тестируются без DOM.

## Что framework делает автоматически

KVT автоматически валидирует DI graph, создаёт cached providers по выбранному
lifetime, связывает работу ViewModel с owner и закрывает owned resources. Он не
угадывает business lifetime за разработчика: решение `singleton`, `scoped`,
route owner или local owner остаётся частью архитектуры приложения.

## С чего читать

1. [Todo App](/guide/getting-started) — полный consumer-first путь.
2. [Clean Architecture](/guide/clean-architecture) — слои, папки и направление зависимостей.
3. [Ментальная модель](/guide/mental-model) — пять сущностей, на которых держится KVT.
4. [Разбор Todo example](/guide/react-example) — что происходит от `main.tsx` до intent.
5. [Runtime и lifecycle](/core/runtime-lifecycle) — запуск и остановка приложения.
6. [ViewModel lifecycle](/application/view-model) — automatic owners и model scope.
7. [StateFlow](/state/state-flow) — как состояние доходит до React.

После этого остальные разделы можно читать по мере необходимости.

## Если вы знакомы с Android/Kotlin

| Kotlin/Android                      | KVT                                                  |
| ----------------------------------- | ---------------------------------------------------- |
| `CoroutineScope`                    | owner/scope + `AbortSignal`                          |
| `StateFlow`                         | `StateFlow`                                          |
| `SharedFlow`                        | `SharedFlow`                                         |
| `ViewModel` + `ViewModelStoreOwner` | `ViewModel` + `ViewModelOwner`                       |
| Hilt/Koin module                    | immutable KVT module                                 |
| `viewModelScope`                    | `ViewModelScope.collect/run/launch/task/own`         |
| lifecycle owner                     | runtime, feature, route или ViewModel owner boundary |

Семантика похожа, но реализация учитывает браузер, React concurrent rendering и
обычный JavaScript cancellation через `AbortSignal`.
