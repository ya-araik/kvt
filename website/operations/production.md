# Production checklist

Используйте страницу как release review, а не как замену automated checks.
Большинство пунктов нужно закрепить test/lint/build gate, а вручную проверять
только host-specific ownership, security policy и operational readiness.

## Перед первым production deploy

1. Нарисуйте ownership root runtime, routes/features и request scopes.
2. Проверьте cancellation на navigation, disconnect и shutdown.
3. Зафиксируйте hydration и diagnostics data policy.
4. Прогоните полный gate на packed artifacts.
5. Настройте monitoring и критерии rollback.

## Application lifecycle

- Runtime bootstrap выполняется до renderer.
- Browser использует default KvtProvider page-exit lifecycle или host явно
  отключает его и вызывает shutdown самостоятельно.
- SSR создаёт runtime на request.
- Router/micro-frontend handles закрываются при host unload.
- WebSocket, workers и subscriptions зарегистрированы у owner.

## DI

- Все dependencies зарегистрированы явно.
- Async providers разрешаются через `resolveAsync`.
- Root singleton не захватывает request/route object.
- Feature providers живут в feature scope.
- External borrowed values подключены через `provide(Config).value(config)`.

## State

- Published snapshots immutable.
- Events и state не смешаны.
- Async operation имеет cancellation/concurrency policy.
- SharedFlow buffer bounded и overflow policy осмыслена.
- Retry mutation требует idempotency/reconciliation.

## React

- Runtime/router не создаются в render.
- Route ViewModel получает automatic owner; нестандартная локальная граница
  имеет explicit `KvtViewModelOwner`.
- Strict Mode tests включены.
- Selectors имеют stable identity.
- SharedFlow handlers не подписываются вручную во время render.

## SSR и security

- Hydration — explicit whitelist.
- Serializer XSS-safe.
- CSP nonce передан theme bootstrap script.
- Secrets/query-private data не попадают в HTML или diagnostics.
- Request runtime/cache не глобальные.

## Theme и accessibility

- Semantic foreground/background pairs соблюдены.
- Custom schemes проходят contrast validation.
- `reduced`/`none` motion реально поддерживаются.
- Focus/hover/disabled states не зависят только от цвета.
- Theme target выбран явно.

## Checks repository

```bash
npm run lint
npm run typecheck
npm run test
npm run check:coverage
npm run build
npm run docs:build
npm run test:e2e
npm run check:packages
npm run check:package-quality
npm run check:bundle-size
npm run test:memory
npm run test:ssr-soak
```

Полный локальный gate:

```bash
npm run check
```

## Package publication

- Public exports закрывают internal paths.
- `npm pack` проверен без workspace symlinks.
- `publint` и AreTheTypesWrong проходят.
- Production audit не содержит high/critical vulnerabilities.
- SBOM/provenance сформированы.
- Все `@kvt/*` versions aligned.
- Trusted Publishing/OIDC настроен для npm scope.

## Monitoring после release

Наблюдайте:

- bootstrap/shutdown failures;
- retained scope/resource counts;
- feature load retry/failure;
- query failure/cancellation;
- Flow overflow/error reporter;
- hydration mismatch;
- theme storage failures.

Diagnostics context должен оставаться low-cardinality и redacted.

После deploy выполните один реальный сценарий bootstrap → navigation → feature
load → shutdown и убедитесь, что diagnostics содержит парные lifecycle events,
а resource counts возвращаются к baseline. Это быстрее обнаруживает неверный
host cleanup, чем ожидание пользовательских reports.
