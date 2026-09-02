# Contributing to KVT

## Local setup

```bash
npm ci
npm run check
```

Для быстрой проверки examples отдельно используйте:

```bash
npm run lint -w @kvt/example-core
npm run lint -w @kvt/example
npm run lint -w @kvt/example-ssr
npm run format:check -w @kvt/example-core
npm run format:check -w @kvt/example
npm run format:check -w @kvt/example-ssr
```

`@kvt/eslint-plugin` проверяет не только синтаксис, но и направление
зависимостей Clean Architecture. Prettier запускается отдельно: ESLint отвечает
за корректность и архитектуру, Prettier — только за единый формат.

Use Node.js 20.19 or newer. Changes to a public API must include tests and documentation.
`npm ci` runs the root `prepare` script and builds workspace package
declarations, so editors can resolve `@kvt/*` imports immediately. If you run
`npm run clean` separately, run `npm run build:packages` before continuing in
the examples.

## Pull requests

1. Keep each pull request focused on one behavior.
2. Add a changelog entry for user-visible changes.
3. Preserve package boundaries: `core` cannot depend on React or browser APIs; `react` may depend on `core`; `theme` is independent of `core`.
4. Run `npm run check` before requesting review.
5. Describe compatibility or migration impact when changing exported types.
6. Run `npm run test:coverage` for behavior changes and mutation tests for a
   critical state machine.

## Versioning

KVT uses Semantic Versioning. The `1.0` public API is tracked by API Extractor;
incompatible changes require a major version and a migration guide.
