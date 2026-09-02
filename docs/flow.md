# Flow semantics

Cold `Flow` starts for every collector and may complete or fail. `StateFlow`
always contains a value and never terminates. `SharedFlow` is an event stream
with explicit replay, extra capacity and `suspend`, `drop-oldest`,
`drop-latest` or `error` overflow.

Listeners may be synchronous or asynchronous. Cancellation is exposed through
`Subscription.done`. Listener failures are isolated and reported through the
Flow error reporter. Derived state subscribes lazily and releases sources after
its last subscriber.

Use `MutableStateFlow.update(reducer)` for every value type and
`MutableObjectStateFlow.patch()` only for objects. `batch()` publishes
consistent final snapshots. VirtualScheduler makes time operators and retries
deterministic in tests.

## Choose the correct stream

| Need | Type |
| --- | --- |
| Repeat work independently for every collector | `Flow<T>` |
| Expose current immutable UI/application state | `StateFlow<T>` |
| Broadcast events with an explicit replay/buffer policy | `SharedFlow<T>` |

Do not model one-time events as StateFlow flags that must be reset. Do not model
durable state as a replay-zero event stream.

## Cold Flow

```ts
const users = callbackFlow<User>((emit, signal) => {
  const remove = api.onUser((user) => void emit(user))
  signal.addEventListener('abort', remove, { once: true })
  return remove
})

const subscription = users.subscribe(async (user) => save(user))
await subscription.done
```

Every collector starts a new producer. Producers observe the supplied
AbortSignal and clean external callbacks. `collect()` resolves on completion
and rejects on producer failure. Creation helpers include `flowOf`,
`fromIterable`, `fromAsyncIterable` and `callbackFlow`.

## StateFlow

```ts
const mutable = new MutableStateFlow({ count: 0 })
const state = mutable.asStateFlow()

mutable.update((previous) => ({ ...previous, count: previous.count + 1 }))
mutable.batch(() => {
  mutable.update(firstReducer)
  mutable.update(secondReducer)
})
```

The transaction publishes one final snapshot. Equality defaults to `Object.is`;
pass a comparator when a domain value has different equivalence semantics.
Derived state computes `value` synchronously, subscribes to sources on the first
listener and releases them after the final listener. `asStateFlow()` and
`asSharedFlow()` return stable wrapper identities.

## SharedFlow and backpressure

```ts
const events = new MutableSharedFlow<Event>({
  replay: 1,
  extraBufferCapacity: 32,
  overflow: 'suspend'
})

await events.emit(event)
const accepted = events.tryEmit(event)
```

- `suspend`: `emit()` waits for capacity; `tryEmit()` returns false.
- `drop-oldest`: remove the oldest queued value and accept the new one.
- `drop-latest`: reject the new value while retaining queued values.
- `error`: fail the emission with a backpressure error.

Set finite capacity deliberately. Replay is delivered in order to a new
subscriber; with `replay: 0`, pre-subscription events are intentionally lost.

## Operators

- Transform: `map`, `filter`, `distinctUntilChanged`, `scan`, `take`, `drop`,
  `onEach`.
- Compose: `combine`, `zip`, `merge`.
- Flatten: `flatMapLatest`, `flatMapConcat`, `flatMapMerge`, `flatMapFirst`.
- Time: `delay`, `debounce`, `throttle`, `sample`, `timeout`.
- Lifecycle/failure: `onStart`, `onCompletion`, `catchFlow`, `retry`,
  `retryWhen`.
- Sharing: `shareIn`, `stateIn` with eager, lazy or while-subscribed policy.

`flatMapLatest` cancels the previous producer; it cannot undo an external side
effect that ignored cancellation. Make commands idempotent where retries or
replacement are possible.

## Tasks

`TaskController` converts commands to typed `AsyncState`:

- `latest`: abort the previous generation; only the latest may update state.
- `enqueue`: execute in submission order.
- `parallel`: run up to the configured limit.
- `ignore`: ignore a start while another run is active.

Each run receives `signal` and `generation`. A late completion from an aborted
generation is discarded. Preserve previous successful data when the UI needs
stable content during refresh or failure.

## Deterministic tests

```ts
const scheduler = new VirtualScheduler()
const turbine = collectFlow(debounce(source, 300, scheduler))
scheduler.advanceBy(300)
expect(await turbine.awaitItem()).toEqual(expected)
await turbine.cancel()
```

Always cancel collectors in `finally` or register them with an owning scope.
