# Карта пакетов

KVT разделён на маленькие пакеты, чтобы core-приложение не загружало React,
Router, Tailwind или DevTools случайно.

Пакеты образуют слои, а не набор обязательных зависимостей:

```text
@kvt/flow
    ↑
@kvt/core
    ↑
    ├── @kvt/react ── @kvt/router-react
    ├── @kvt/query
    ├── @kvt/testing
    └── @kvt/otel

@kvt/theme-core ── @kvt/theme-react
        └────────── @kvt/theme-tailwind
```

Стрелка означает «внешний adapter зависит от внутреннего контракта». Обратный
импорт запрещён: например, core ничего не знает о React.

## Основной слой

| Пакет       | Что содержит                                                | Runtime dependencies |
| ----------- | ----------------------------------------------------------- | -------------------- |
| `@kvt/flow` | Flow, StateFlow, SharedFlow, schedulers, TaskController     | нет                  |
| `@kvt/core` | runtime, DI, modules, plugins, lifecycle, ViewModel, Result | `@kvt/flow`          |

Эти два пакета подходят для Node.js, browser, worker и тестов без React.

## React и routing

| Пакет                | Назначение                                                            |
| -------------------- | --------------------------------------------------------------------- |
| `@kvt/react`         | `KvtProvider`, Flow hooks, ViewModel owner boundaries, hydration      |
| `@kvt/router-react`  | React Router adapters, lazy feature scopes, route owners, SSR helpers |
| `@kvt/testing-react` | Strict Mode, hydration и memory-router harnesses                      |

React является peer dependency. Runtime не создаётся компонентом.

## Theme

| Пакет                 | Назначение                                                                |
| --------------------- | ------------------------------------------------------------------------- |
| `@kvt/theme-core`     | immutable tokens, schemes, validation, serialization, CSS variables       |
| `@kvt/theme-react`    | provider, target layers, preferences, storage, system sync, SSR bootstrap |
| `@kvt/theme-tailwind` | mapping `--kvt-*` в Tailwind CSS 4 utilities                              |

`theme-core` не читает DOM при import. Tailwind mapping является opt-in CSS
export и не стилизует `html`/`body`.

## Data и infrastructure

| Пакет                    | Назначение                                                            |
| ------------------------ | --------------------------------------------------------------------- |
| `@kvt/query`             | OOP facade над TanStack Query Core, QueryFlow, mutations, persistence |
| `@kvt/otel`              | mapping diagnostics в OpenTelemetry API                               |
| `@kvt/devtools-protocol` | versioned redacted event buffer                                       |
| `@kvt/devtools-react`    | optional in-app inspector overlay                                     |

Query не экспортирует React hooks и не заставляет ViewModel знать TanStack types.

## Development

| Пакет                | Назначение                                                     |
| -------------------- | -------------------------------------------------------------- |
| `@kvt/testing`       | TestRuntimeBuilder, FlowTurbine, query helper, leak assertions |
| `@kvt/eslint-plugin` | Flat-config правила архитектуры и KVT lifecycle для приложений |
| `@kvt/cli`           | `kvt doctor`, generators                                       |
| `create-kvt`         | templates `core`, `spa`, `ssr`                                 |

## Что устанавливать

Начинайте с минимального набора. Новый пакет добавляется тогда, когда
приложению действительно нужна соответствующая граница.

### Domain или Node library

```bash
npm install @kvt/core @kvt/flow
```

### React SPA

```bash
npm install @kvt/core @kvt/flow @kvt/react react react-dom
```

### React Router feature modules

```bash
npm install @kvt/router-react react-router
```

### Theme + Tailwind

```bash
npm install @kvt/theme-core @kvt/theme-react @kvt/theme-tailwind
npm install -D tailwindcss @tailwindcss/vite
```

### Server state

```bash
npm install @kvt/query @tanstack/query-core
```

## Как выбрать пакет

| Потребность                   | Пакет                 | Не требуется                     |
| ----------------------------- | --------------------- | -------------------------------- |
| Только DI, lifecycle и Result | `@kvt/core`           | React/theme/query                |
| Reactive state без renderer   | `@kvt/flow`           | `@kvt/react`                     |
| Подписать React на StateFlow  | `@kvt/react`          | Router, если routing отсутствует |
| Route owners и lazy features  | `@kvt/router-react`   | Ручные route scopes              |
| Cache удалённых данных        | `@kvt/query`          | React Query hooks                |
| Semantic design tokens        | `@kvt/theme-core`     | DOM                              |
| Применить тему к DOM          | `@kvt/theme-react`    | Tailwind                         |
| Получить `kvt-*` utilities    | `@kvt/theme-tailwind` | Component kit                    |

`@kvt/core` переэкспортирует Flow primitives для удобства, но отдельная
зависимость `@kvt/flow` полезна библиотеке, которая не использует runtime/DI.

## Запрещённые направления

- `@kvt/core` не импортирует React, Router, Query, Tailwind или OTel.
- `@kvt/flow` не импортирует ничего из остальных KVT packages.
- domain module не импортирует UI feature.
- React component не создаёт root runtime или QueryClient.
- public code не использует deep imports вроде `@kvt/core/dist/...`.

Эти границы проверяются CI, а не только описаны в документации.
