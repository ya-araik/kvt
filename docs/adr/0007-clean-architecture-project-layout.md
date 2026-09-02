# ADR 0007: Clean Architecture project layout

## Status

Accepted on 2026-08-22.

## Context

Clean Architecture defines the dependency rule, not mandatory directory names.
The KVT Todo templates previously mixed a flat `domain` directory with a
separate `application` directory. That made use cases less visible as part of
the renderer-independent business core and left no consistent home for domain
and UI error models.

## Decision

Official KVT templates, examples and generators use this layer-first layout:

```text
domain/model
domain/model/failure
domain/repository
domain/usecase
data/repository
presentation/model
presentation/viewmodel
presentation/view
app/di
app/navigation
```

Dependencies point inward:

- domain model has no framework or adapter dependency;
- domain repository ports depend only on domain model;
- domain use cases depend on model, repository ports and other use cases;
- data and presentation depend on domain, never on each other;
- app/DI and host entrypoints compose concrete adapters with inner ports.

Expected business failures are domain values and live in
`domain/model/failure`. UI error state and message keys live in
`presentation/model`. Data-source exceptions are mapped to domain failures and
never cross the repository port. Unexpected framework defects use `KvtError`.

Renderer-neutral `Result`, `UseCaseContext` and Flow contracts are permitted in
repository/use-case layers. Domain entities remain plain TypeScript.

## Consequences

- `src/application` is not used by official KVT projects;
- generators choose the canonical layer automatically;
- a use-case generator also creates its failure model under
  `domain/model/failure`;
- `check:boundaries` rejects reverse imports and misplaced error declarations;
- the composition root is the only place that imports a repository contract
  and its concrete implementation together.

## References

- Robert C. Martin, “The Clean Architecture”:
  https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
- Android Developers, “Domain layer”:
  https://developer.android.com/topic/architecture/domain-layer
