# ADR-0001: Runtime and resource ownership

Status: accepted

The application bootstraps one root runtime before any renderer uses it. The
runtime owns the root scope and plugin lifecycle. Each child scope owns its
children and the scoped/transient resources created for it.

Shutdown is asynchronous, idempotent and monotonic. The first call moves the
runtime to `shutting-down` and creates the canonical shutdown promise. All later
calls return that same promise. New work is rejected after this transition.

Children close before parents. Resources close in reverse successful creation
order. Cleanup continues after errors and reports an `AggregateError`. Timeout
aborts the shared `ShutdownContext.signal`; it does not silently mark unfinished
resources as cleaned. Partial bootstrap uses the same shutdown machinery.

