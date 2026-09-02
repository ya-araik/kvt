# Todo Showcase E2E

Сценарии в `react-spa.spec.ts` проверяют полноценный
[`examples/react-app`](../examples/react-app/README.md), а не минимальный SPA
template.

Playwright поднимает два процесса:

- Vite на `127.0.0.1:4173`;
- локальный persistent JSON Server API на `127.0.0.1:4174`.

Перед запуском API файл `server/.data/db.json` сбрасывается из tracked
`server/seed.json`. Сценарии выполняются последовательно во всех трёх browser
projects, а созданная тестовая задача удаляется в конце CRUD-сценария.

Покрыты server search/filter/pagination, persistent CRUD, cache-first
IndexedDB fallback, offline outbox/synchronization, theme persistence и факт
поздней загрузки Insights chunk.

```bash
npm run test:e2e
```
