# Security policy

## Supported versions

KVT 1.x receives security fixes on the latest released minor line. Older minors
may receive a coordinated patch only when the maintainer explicitly announces
extended support.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository host's private security-advisory feature and include:

- the affected package and version;
- a minimal reproduction;
- the expected impact;
- any known workaround.

Maintainers should acknowledge a report within seven days. A coordinated disclosure date is agreed after the issue is reproduced and scoped.

KVT plugins are trusted code. Reports that require intentionally installing and
executing a malicious local/npm plugin are generally outside the framework's
isolation guarantees unless the issue crosses a documented boundary such as
diagnostic redaction, hydration serialization or package publication.
