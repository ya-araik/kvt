# Lint и форматирование

Todo templates и все examples поставляются с двумя независимыми проверками:

- ESLint проверяет JavaScript/TypeScript, React Hooks и архитектурные правила KVT;
- Prettier отвечает только за одинаковое форматирование исходников.

```bash
npm run lint
npm run format:check
npm run format
```

`format:check` ничего не изменяет и подходит для CI. `format` перезаписывает
файлы в каноническом стиле.

Рекомендуемый локальный цикл: formatter во время редактирования, затем lint и
typecheck перед commit. В CI запускайте `format:check`, потому что проверка не
должна незаметно менять checkout.

## Framework-specific правила

Пакет `@kvt/eslint-plugin` предоставляет flat config `recommended`:

```js
import kvt from "@kvt/eslint-plugin";

export default [
  // JavaScript, TypeScript и React configs приложения,
  ...kvt.configs.recommended,
];
```

Он включает три правила.

### `kvt/architecture-boundaries`

Правило реализует Dependency Rule для принятой структуры KVT:

```text
domain/model <- domain/repository <- domain/usecase
                         ^
                         |
                  data/repository

presentation -> domain/usecase
app -> presentation + data + domain
```

Например, ViewModel не может импортировать `data/repository` или напрямую
обращаться к `domain/repository`: пользовательское действие должно проходить
через use case. Domain не импортирует React и host-specific browser APIs.

Правило проверяет направление imports, но не может определить смысл класса.
Файл с именем `use-case`, который внутри рендерит JSX или вызывает `fetch`, всё
равно остаётся архитектурной ошибкой — lint дополняет code review, а не заменяет
его.

### `kvt/error-model-location`

- business failures объявляются в `domain/model/failure`;
- UI failures объявляются в `presentation/model`;
- repository и use case используют эти модели, но не объявляют их рядом с
  реализацией операции.

Это сохраняет направление зависимостей и не смешивает тексты интерфейса с
бизнес-правилами.

### `kvt/no-legacy-api`

Правило запрещает удалённые prototype provider/ViewModel helpers и ручную
настройку route ownership. Полный список старых имён находится в
[руководстве по переходу](/reference/prototype-migration). Route owner создаётся
router adapter автоматически.

## Граница browser API

Recommended config дополнительно запрещает в `src/domain` прямые обращения к:

- `window` и `document`;
- `localStorage` и `sessionStorage`;
- host-specific `crypto`.

Такой код переносится в data adapter за repository contract. Например,
генерация UUID в browser относится к реализации repository, а не к use case.

## Конфигурация Prettier

Templates используют небольшой предсказуемый config:

```js
export default {
  semi: false,
  singleQuote: true,
  trailingComma: "none",
  printWidth: 100,
};
```

`eslint-config-prettier` отключает конфликтующие stylistic rules ESLint.
Prettier не исправляет архитектурные нарушения: после `npm run format` всё
равно должен проходить `npm run lint`.

## Release gate templates

KVT собирает `@kvt/eslint-plugin` как отдельный tarball, генерирует чистые
core/SPA/SSR проекты и запускает в каждом:

1. lint;
2. format check;
3. typecheck;
4. unit tests;
5. production build.

Поэтому конфигурация проверяется в том же виде, который получает разработчик
после `npm create kvt`.

## Что запускать после изменения

| Изменение                      | Минимальная проверка                 |
| ------------------------------ | ------------------------------------ |
| Только форматирование          | `format:check`                       |
| Imports/layers или React hooks | `lint` + `typecheck`                 |
| Public types/API               | `typecheck` + package quality checks |
| Generator/template             | release gate generated project       |
| Документация с code blocks     | docs contracts + `docs:build`        |

Для merge в framework используйте полный repository gate: локальный минимум не
заменяет проверки packages, memory и SSR soak.
