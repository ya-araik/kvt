# Глоссарий

Термины ниже описывают именно semantics KVT. Если два понятия звучат похоже,
проверяйте ownership: definition описывает, provider создаёт, scope ограничивает
lifetime, а owner гарантирует завершение.

Для первого чтения полезна глава [Mental model](/guide/mental-model); глоссарий
предназначен для быстрого возврата к точному значению термина.

## Adapter

Пакет-мост между renderer-independent contract и внешней технологией: React,
Router, DOM, Tailwind, OTel.

## Bootstrap

Асинхронный процесс validation graph, создания root scope, eager providers и
старта plugins до перехода runtime в `running`.

## Cold Flow

Flow, producer которого запускается заново для каждого collector и может
завершиться success/error.

## Composition root

Место, где application собирает modules/plugins и создаёт runtime. Обычно
`runtime.ts`, browser/server entrypoint.

## Definition

Immutable описание binding/provider/module/plugin/feature. Не является
живым resource.

## DI

Dependency Injection: dependency передаётся объекту извне по явному graph, а не
создаётся внутри business class.

## Eager provider

Provider, который создаётся во время bootstrap, а не при первом resolve.

## Feature handle

Reference на загруженную dynamic feature и её scope. Последний `release()`
инициирует unload.

## Generation

Monotonic ID async запуска. Позволяет позднему result определить, что он уже
устарел.

## Hydration

Согласование server-rendered snapshot с первым client render через явно
сериализованный state.

## Intent

Метод ViewModel, выражающий действие пользователя: `save()`, `selectUser()`,
`retry()`. UI не изменяет mutable state напрямую.

## Lease

Временное право consumer использовать resource у owner. Освобождение одного
lease не закрывает resource, пока owner/другие leases активны.

## Module

Versioned immutable набор providers, includes и requirements.

## Owner

Сущность, которая отвечает за создание и гарантированное завершение resource.

## Plugin

Trusted module bundle с lifecycle hooks `start/shutdown`.

## Provider

Recipe DI: class/token, lifetime, dependencies и factory/value/alias.

## QueryFlow

StateFlow, представляющий server query cache state без React hooks.

## Renderer

Слой представления. В web-варианте React читает state и создаёт DOM, но не
владеет application runtime.

## Requesting scope

Child scope, из которого начался resolve. Scoped/transient dependencies
разрешаются с учётом его overrides.

## Runtime

Живой корень запущенного KVT application: registry, scopes, plugins, features и
shutdown state machine.

## Scope

Иерархическая DI/resource lifetime boundary.

## SharedFlow

Hot broadcast событий с configurable replay, buffer и overflow policy, без
обязательного current value.

## Shutdown

Terminal lifecycle transition, закрывающий children и resources в определённом
порядке.

## StateFlow

Hot state container с обязательным текущим value и initial emission.

## Token

Typed runtime identity dependency. Description используется только для
диагностики.

## UseCase

Одна application operation с input/output и `UseCaseContext` cancellation/trace.
`NoInputUseCase` принимает только context, а `ViewModelScope.run()` передаёт
context автоматически и не требует фиктивного `undefined`.

## ViewModel

Renderer-independent presentation state + intents с owner-controlled lifecycle.

## ViewModel owner boundary

Явная граница, определяющая, какие consumers разделяют ViewModel и когда она
закрывается.
