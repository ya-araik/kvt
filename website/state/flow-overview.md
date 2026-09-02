# Flow: общая картина

`@kvt/flow` — renderer-independent reactive layer. Он различает состояние,
события и вычисляемую последовательность вместо одного универсального stream.

Flow нужен на границе, где значение меняется во времени и у него несколько
потребителей или явно управляемый lifecycle подписки. Для локального значения
одного React-компонента обычный `useState` проще и достаточнее.

## Три семантики

| Тип             | Hot/cold | Имеет current value | Completion/error |
| --------------- | -------- | ------------------- | ---------------- |
| `StateFlow<T>`  | hot      | да                  | никогда          |
| `SharedFlow<T>` | hot      | нет                 | никогда          |
| `Flow<T>`       | cold     | нет                 | да               |

Выбор типа является частью смысла API.

Один и тот же payload не определяет тип. Например, `User` может быть текущим
пользователем (`StateFlow<User | null>`), событием авторизации
(`SharedFlow<UserLoggedIn>`) или элементом загружаемой последовательности
(`Flow<User>`). Сначала определите поведение во времени, затем выбирайте API.

## StateFlow: «что сейчас?»

```ts
const state = new MutableStateFlow({ status: "idle" });
state.value; // текущий snapshot
```

Используйте для screen state, selected filter, connection state и любой модели,
где новый consumer должен сразу получить текущее значение.

## SharedFlow: «что произошло?»

```ts
const events = new MutableSharedFlow<SavedEvent>({ replay: 0 });
await events.emit({ id: "42" });
```

Используйте для one-off events: saved, navigation intent, toast, analytics
signal. У события нет обязательного current value.

## Cold Flow: «выполни последовательность»

```ts
const numbers = flowOf(1, 2, 3);
await numbers.collect(console.log);
```

Каждый collector запускает producer заново. Подходит для pipelines, adapter
callbacks, файловых/сетевых последовательностей и операторов композиции.

## Subscription

```ts
const subscription = state.subscribe(render);

subscription.closed;
subscription.cancel("screen-closed");
await subscription.done;
```

Subscription — owned resource. Cancellation:

- прекращает будущие emissions этому collector;
- запускает producer cleanup;
- завершает `done` согласно причине;
- может быть связана с внешним `AbortSignal`.

## Cancellation

```ts
const controller = new AbortController();

const subscription = source.subscribe(handle, {
  signal: controller.signal,
});

controller.abort("navigation-changed");
```

Abort является cooperative. Producer и async callback должны учитывать signal.

## Error isolation

- Ошибка StateFlow/SharedFlow listener не мешает остальным listeners.
- Она передаётся configured Flow error reporter.
- Cold Flow collector error завершает его subscription.
- StateFlow и SharedFlow сами не переходят в error state.

Application failure хранится обычным data value, например `AsyncState.failure`.

## Полный lifecycle подписки

```ts
const subscription = source.subscribe(render, {
  signal: owner.signal,
});

try {
  await subscription.done;
} finally {
  // producer cleanup к этому моменту завершён
}
```

Owner подписки — ViewModel, route, request или другой scope — должен отменить
её при завершении своего lifecycle. Если subscription создаётся без понятного
owner, она почти всегда превращается в утечку или продолжает обновлять уже
закрытый экран.

## Настройка reporter

```ts
setFlowErrorReporter((error, context) => {
  monitoring.capture(error, context);
});
```

Не используйте listener exception как механизм control flow.

## Быстрый выбор

- Компонент должен сразу отрисовать значение → `StateFlow`.
- Новый consumer не должен повторно получить старое событие → `SharedFlow({ replay: 0 })`.
- Каждый вызов должен заново выполнить источник → cold `Flow`.
- Нужен async operation state и concurrency policy → `TaskController`.

Не используйте `SharedFlow` как очередь гарантированной доставки между
процессами и не используйте `StateFlow` как базу данных. Это in-memory
примитивы состояния и подписки внутри одного JavaScript runtime.
