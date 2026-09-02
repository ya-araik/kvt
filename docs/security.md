# Security model

KVT is an application framework, not an isolation boundary. Modules and plugins
are trusted local/npm code with the same authority as the host process. Remote
code loading, URL plugins and an execution sandbox are intentionally absent.

## Trust boundaries

- The host controls modules, plugins, serializers, storage and diagnostic sinks.
- Browser/SSR request data is untrusted input and must be validated by the
  application before reaching domain operations.
- DI controls construction and lifetime, not authorization.
- DevTools is developer UI, not an access-control mechanism.

## Secrets and serialization

Only explicit keyed hydration entries are serialized. Never register tokens,
cookies, credentials, private query caches or complete DI state. Hydration and
DevTools JSON escape HTML-significant characters to prevent closing an inline
script element. Supply a CSP nonce to theme/bootstrap scripts and maintain a
strict application CSP.

Diagnostics redact suspicious fields and never inspect service values by
default. Custom context still requires application review; use stable IDs and
counts rather than names, emails or payloads.

## Lifecycle safety

Timeout sends an AbortSignal to cleanup but cannot forcibly undo external work.
Providers, queries and plugins must implement idempotent cleanup and reconcile
partial side effects. Do not treat cancellation or an upstream `404` alone as
proof that an external resource no longer exists.

## Supply chain

- ESM package exports are closed and tarball contents are checked.
- CI runs production dependency audit, license review, CodeQL, SBOM generation,
  package quality checks and clean tarball consumers.
- npm publication uses OIDC Trusted Publishing and provenance; no long-lived npm
  token belongs in repository secrets.
- Dependabot reviews npm and GitHub Actions dependencies.

## Reporting

Follow [SECURITY.md](../SECURITY.md) for private vulnerability reporting. Do not
open a public issue containing an unpatched exploit or secret.
