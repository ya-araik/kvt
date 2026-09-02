# CLI и generators

KVT предоставляет два binary:

- `create-kvt` — новый проект;
- `kvt` из `@kvt/cli` — doctor и generators.

Generators создают канонический каркас, а `doctor` проверяет уже существующий
проект на несовместимые версии и типовые ошибки интеграции. CLI не требуется во
время выполнения приложения и может оставаться development dependency.

## Создание проекта

```bash
npm create kvt@1.0.0 -- my-app --template spa
```

Templates:

- `core` — TypeScript library без React;
- `spa` — React SPA;
- `ssr` — request-local runtime и server render.

Release tests собирают templates из packed tarballs, а не workspace symlinks.

## Doctor

```bash
npx kvt doctor
npx kvt doctor ./path/to/project
```

Проверяет:

- Node version;
- ESM package;
- alignment versions `@kvt/*`;
- TypeScript/React compatibility;
- NodeNext config для published libraries;
- forbidden legacy decorators;
- legacy provider/ViewModel/route APIs;
- ViewModel без `.viewModel()` binding;
- redundant token вокруг concrete class;
- несовместимые provider modifier chains;
- наличие runtime shutdown/browser provider boundary;
- SSR theme bootstrap;
- installed package exports/duplicates.

Warning требует review, failure возвращает non-zero exit code.

Запускайте doctor после обновления KVT packages, изменения TypeScript/React
версии и перед сложной миграцией. В CI полезно запускать его после install:
тогда version skew обнаружится до build, а не как странная runtime ошибка.

## Generators

```bash
npx kvt generate module users
npx kvt generate view-model users
npx kvt generate repository users
```

Supported kinds:

- `module`;
- `plugin`;
- `binding`;
- `provider` (explicit token/value factory);
- `view-model`;
- `use-case`;
- `repository`;
- `feature`;
- `route`;
- `theme-scheme`;
- `query-definition`;
- `test`.

Optional third argument задаёт directory.

```bash
npx kvt generate feature reports ./src/features
```

## Safety

Generator:

- нормализует name в kebab-case;
- создаёт файл в каноническом Clean Architecture layer;
- никогда молча не перезаписывает существующий file;
- генерирует `.js` specifiers для ESM там, где нужны imports;
- использует только public KVT APIs.

| Kind                           | Directory                    |
| ------------------------------ | ---------------------------- |
| `use-case`                     | `src/domain/usecase`         |
| `repository`                   | `src/domain/repository`      |
| `view-model`                   | `src/presentation/viewmodel` |
| `query-definition`             | `src/data/query`             |
| `route`                        | `src/app/navigation`         |
| `module`, `binding`, `feature` | `src/app/di`                 |

Generators не создают обратные зависимости между слоями. Правила структуры
описаны в [Clean Architecture](/guide/clean-architecture).

## Что generator не решает

Generated file — starting point, а не готовая domain architecture. Разработчик
всё равно определяет:

- owner/lifetime;
- repository contract;
- error model;
- cancellation policy;
- module requirements;
- security boundaries.

После генерации module/feature сразу определите owner и lifetime providers, а
после генерации use case — input, typed failures и cancellation contract.
Сгенерированный код специально не угадывает product decisions.

## Типичный workflow

```bash
npm create kvt@1.0.0 -- billing-app --template spa
cd billing-app
npx kvt doctor
npx kvt generate repository invoices
npx kvt generate use-case load-invoices
npx kvt generate view-model invoices
```

Затем свяжите registrations в module и запустите lint/typecheck: generator
создаёт файлы в правильных слоях, но не может автоматически выбрать ваши
domain dependencies.
