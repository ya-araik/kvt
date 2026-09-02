# Publishing 1.0

Publication is blocked until the `@kvt` npm organization is controlled by the
maintainer and every release gate is green. Package metadata already points to
the public [repository](https://github.com/ya-araik/kvt),
[documentation](https://ya-araik.github.io/kvt/) and
[issue tracker](https://github.com/ya-araik/kvt/issues).

Use npm Trusted Publishing with OIDC and provenance. Do not store registry
tokens in the repository. Publish in dependency order: Flow and neutral
protocols first, then Core/theme core, then adapters, testing and CLI. Run a
clean SPA and SSR install from npm after publication before creating `v1.0.0`.

Copyright in every MIT license remains `Araik Gukasyan`.

## Required external setup

1. Reserve/control the npm `@kvt` organization and grant package publication.
2. Configure npm Trusted Publisher for `ya-araik/kvt`, `release.yml` and the `npm`
   GitHub environment.
3. Protect the release environment and `main`; require all CI checks.
4. Keep `id-token: write` limited to the release job.

The release verifier rejects missing or placeholder metadata. Do not invent a
URL merely to make the check green.

## Local release rehearsal

```bash
npm ci --ignore-scripts
npm run check
npm run test:e2e
npm run check:licenses
npm audit --omit=dev --audit-level=high
npm run sbom
node scripts/verify-release-version.mjs 1.0.0
```

Inspect frozen API reports and packed file lists. Run the workflow from a clean
commit. Packages publish in dependency order with `--provenance --access public`.
After registry availability, the workflow creates clean SPA/SSR projects,
installs exact `1.0.0` versions and runs their tests/builds.

## Failure policy

- Never overwrite an npm version; fix forward with a new version after 1.0.
- A partially published package set is an incident: stop, record which versions
  exist and do not create the release tag until the exact-version smoke works.
- A failed provenance or clean-install smoke blocks the tag/release.
- The SBOM is generated from production dependencies and attached as an artifact.

## Package order

1. `@kvt/eslint-plugin`, `@kvt/flow`, neutral protocols and theme core.
2. `@kvt/core` and renderer-independent query.
3. React/router/theme/OTel/DevTools adapters.
4. Testing packages.
5. `@kvt/cli` and `create-kvt`; clean release smokes also run the generated
   projects' lint and Prettier checks.
