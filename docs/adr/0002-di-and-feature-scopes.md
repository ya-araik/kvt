# ADR-0002: Dependency injection and feature scopes

Status: accepted

DI uses immutable module and provider definitions. There is no reflection,
decorator metadata, implicit class construction or last-write-wins binding.
Duplicate, missing and circular bindings fail graph validation before startup.

A root singleton is created and resolved in the root scope. Scoped and
transient providers are instantiated in the requesting scope, so an explicit
child override participates in their dependency graph.

The root registry cannot change after bootstrap. A lazy feature receives a
child registry plus an owned feature scope. Concurrent loads share one promise;
failure and cancellation do not become permanent cache entries. Unload closes
the scope before discarding the registry.

