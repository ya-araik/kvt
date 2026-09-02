---
layout: home

hero:
  name: KVT Framework
  text: Архитектура приложения без магии
  tagline: TypeScript runtime, явный lifecycle, DI, Kotlin-like Flow и React только как renderer.
  actions:
    - theme: brand
      text: Начать разбираться
      link: /guide/introduction
    - theme: alt
      text: Разобрать Todo example
      link: /guide/react-example

features:
  - title: Явное владение ресурсами
    details: У runtime, scope, ViewModel, подписки и query observer всегда есть конкретный владелец и понятный момент завершения.
  - title: React — только renderer
    details: Бизнес-логика, state, DI, repositories и use cases остаются обычным TypeScript и тестируются без React.
  - title: Kotlin-like Flow
    details: Cold Flow, StateFlow, SharedFlow, operators, cancellation, backpressure и виртуальное время без RxJS.
  - title: Промышленный lifecycle
    details: Асинхронный bootstrap, rollback частичного старта, idempotent shutdown и AggregateError при cleanup.
  - title: Полная web-цепочка
    details: React 18/19, React Router, SSR/hydration, semantic themes, Tailwind CSS 4 и query cache.
  - title: Инструменты разработки
    details: Testing SDK, diagnostics, OpenTelemetry adapter, DevTools overlay, CLI, generators и package quality gates.
---

## С чего начать

Начните с минимального [Todo App](/guide/getting-started), затем прочитайте
[ментальную модель](/guide/mental-model) и откройте
[полный Todo Showcase](/guide/react-example). Первый соответствует template
`create-kvt spa`, второй показывает HTTP/IndexedDB repositories, offline sync, plugins, lazy
feature и темы в production-shaped приложении.

::: tip Главное правило
Каждый долгоживущий ресурс имеет владельца. Владелец определяет, когда ресурс
создаётся, кто может им пользоваться и когда он обязан завершиться.
:::

## Выберите маршрут чтения

Документацию не обязательно читать подряд. Начните со сценария, который ближе
к вашей задаче:

| Задача                    | С чего начать                            | Что читать затем                                                   |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Собрать первое приложение | [Todo App](/guide/getting-started)       | [Todo example](/guide/react-example)                               |
| Понять архитектуру        | [Ментальная модель](/guide/mental-model) | [Clean Architecture](/guide/clean-architecture)                    |
| Настроить DI и lifecycle  | [Runtime](/core/runtime-lifecycle)       | [DI](/core/dependency-injection), [scopes](/core/scopes-ownership) |
| Организовать состояние    | [Flow overview](/state/flow-overview)    | [StateFlow](/state/state-flow), [tasks](/state/tasks)              |
| Подключить React и Router | [ViewModel](/application/view-model)     | [React](/application/react), [Router](/application/router)         |
| Подготовить production    | [Testing](/operations/testing)           | [Production checklist](/operations/production)                     |

Если термин встречается впервые, откройте [глоссарий](/reference/glossary).
Примеры в главах используют одну Todo-архитектуру, поэтому код можно
сопоставлять между разделами, а не изучать набор несвязанных snippets.
