# Cold Flow и operators

Cold `Flow<T>` запускает producer отдельно для каждого collector.

Используйте cold Flow, когда collection и есть команда «начать работу»: читать
stream, слушать callback API или выполнить pipeline. Если источник должен жить
один раз и раздавать одно состояние многим consumers, начните со `StateFlow`
либо явно примените sharing operator с подходящим owner.

## Создание

```ts
const values = flowOf(1, 2, 3);
const fromArray = fromIterable(users);
const fromStream = fromAsyncIterable(stream);
```

Custom producer:

```ts
const ticks = flow<number>(async (observer, { signal }) => {
  let value = 0;
  while (!signal.aborted) {
    await delay(1_000, signal);
    await observer.next(value++);
  }
});
```

Producer Promise resolution завершает Flow. Thrown/rejected error завершает
subscription с ошибкой.

## callbackFlow

Adapter для callback API:

```ts
const messages = callbackFlow<Message>((emitter, signal) => {
  const socket = connect();
  socket.onmessage = (event) => void emitter.emit(parse(event.data));
  socket.onerror = (error) => emitter.fail(error);
  socket.onclose = () => emitter.close();

  const abort = () => socket.close();
  signal.addEventListener("abort", abort, { once: true });

  return () => {
    signal.removeEventListener("abort", abort);
    socket.close();
  };
});
```

Cleanup вызывается при completion, failure и cancellation.

## Collection

```ts
await source.collect(
  async (value) => {
    await save(value);
  },
  { signal },
);
```

Async collector обрабатывается последовательно, сохраняя ordering.

Для ручного контроля:

```ts
const subscription = source.subscribe({
  next: handle,
  error: showError,
  complete: finish,
});
```

## Transform operators

```ts
map(source, transform);
filter(source, predicate);
distinctUntilChanged(source, comparator);
scan(source, initial, reducer);
take(source, count);
drop(source, count);
onEach(source, action);
```

Operators не мутируют source, а создают новый cold Flow.

## Composition

- `merge(...sources)` — значения по мере поступления;
- `zip(left, right)` — пары по позиции;
- `combine(left, right, transform)` — последнее значение обоих sources;
- `flatMapLatest` — отменяет предыдущий inner Flow;
- `flatMapConcat` — выполняет inner flows по очереди;
- `flatMapMerge` — выполняет с ограниченной concurrency;
- `flatMapFirst` — игнорирует новые values, пока inner активен.

| Требуемое поведение                                  | Operator        |
| ---------------------------------------------------- | --------------- |
| Новый запрос отменяет старый                         | `flatMapLatest` |
| Запросы обязаны сохранить порядок                    | `flatMapConcat` |
| Допустима ограниченная параллельность                | `flatMapMerge`  |
| Повторный trigger во время работы нужно игнорировать | `flatMapFirst`  |

Выбирайте operator по product semantics. Например, `flatMapLatest` безопасен
для поиска, но может быть неверен для платежной mutation: отмена ожидания не
обязательно отменяет side effect на сервере.

### Поиск с отменой старого запроса

```ts
const results = flatMapLatest(debounce(queryChanges, 250), (query) =>
  searchRepository.observe(query),
);
```

## Time operators

```ts
delay(source, 100);
debounce(source, 250);
throttle(source, 1_000);
sample(source, 100);
timeout(source, 5_000);
```

Все принимают optional Scheduler, поэтому time tests не обязаны реально ждать.

## Lifecycle/error operators

```ts
onStart(source, start);
onCompletion(source, finish);
catchFlow(source, recover);
retry(source, { attempts: 3, delayMs: 200 });
retryWhen(source, predicate);
```

Retry запускает cold source заново. Не применяйте automatic retry к
неидемпотентной mutation без idempotency key.

## Sharing

`shareIn()` превращает cold Flow в SharedFlow, `stateIn()` — в StateFlow.
Start policy определяет связь с subscribers:

- eager;
- lazy;
- while-subscribed со stop timeout/replay expiration.

Owner sharing scope должен жить не меньше всех consumers.

`shareIn()` и `stateIn()` меняют не только производительность, но и semantics:
после sharing несколько collectors больше не запускают независимые producers.
Документируйте owner и start policy рядом с созданием shared stream, иначе
непонятно, когда подключается и закрывается исходный resource.

## Cancellation от owner до producer

При закрытии ViewModel или route signal отменяет subscription, operator chain
и исходный producer. Каждый adapter в цепочке обязан либо передать signal
ниже, либо выполнить cleanup сам. `callbackFlow` нужен именно для callback API,
где автоматической поддержки `AbortSignal` нет.

## VirtualScheduler

В тесте:

```ts
const scheduler = new VirtualScheduler();
const output = debounce(source, 300, scheduler);

scheduler.advanceBy(299);
// emission ещё нет
scheduler.advanceBy(1);
// emission произошёл
```

Это делает ordering/time tests deterministic.
