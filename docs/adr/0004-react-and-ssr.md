# ADR-0004: React and SSR boundary

Status: accepted

React renders framework state but does not own the root runtime. `KvtProvider`
requires an already running runtime. In browsers it forwards a real,
non-bfcache `pagehide` to that runtime by default, but an ordinary provider
unmount never means application shutdown. Custom browser hosts can opt out and
own shutdown explicitly. Changing runtime identity requires remounting the
provider.

External resources are acquired only after commit. StateFlow integration uses
`useSyncExternalStore`; ViewModels are leased from explicit owners. Strict Mode
effect replay must not destroy a resource still owned by a live boundary.

SSR creates one runtime per request. Only explicitly keyed StateFlow snapshots
with serializers enter hydration state. Serialization is XSS-safe and a server
snapshot mismatch identifies its state key without exposing its value.
