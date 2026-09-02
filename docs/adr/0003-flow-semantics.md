# ADR-0003: Flow semantics

Status: accepted

Cold Flow starts independently for each collector and may complete or fail.
StateFlow is hot, always has a value and never completes or fails. SharedFlow is
hot and exposes explicit replay, capacity and overflow policy.

Cancellation is cooperative and observable through `Subscription.done`.
Asynchronous collectors are supported. Listener failures are isolated and sent
to the configured error reporter.

Derived state is lazy and reference counted. It computes `value` synchronously,
subscribes to sources for its first observer and releases them after its last
observer, subject only to an explicit keep-alive policy.

