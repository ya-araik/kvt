# SharedFlow и события

SharedFlow — hot broadcast событий. В отличие от StateFlow, он не обязан иметь
текущее значение и не завершается.

Это механизм доставки активным in-process subscribers, а не durable message
queue. Если приложение закрыто, subscriber ещё не подключён и replay равен
нулю, событие не будет восстановлено позже.

## Базовое событие

```ts
type UserEvent =
  { type: "saved"; id: string } | { type: "deleted"; id: string };

const mutableEvents = new MutableSharedFlow<UserEvent>();
export const events = mutableEvents.asSharedFlow();

await mutableEvents.emit({ type: "saved", id: "42" });
```

При `replay: 0` subscriber, подключившийся позже, старое событие не получает.

Если subscribers вообще нет, `emit()` не превращает событие в отложенную
команду. Оно сохраняется только в пределах настроенного replay contract.

## Replay

```ts
const events = new MutableSharedFlow<Event>({ replay: 2 });
```

Новый subscriber сначала получает последние два события. Replay — осознанная
часть контракта, а не случайный cache.

Для toast/navigation чаще нужен `replay: 0`, иначе remount UI повторит старое
действие.

## Buffer

```ts
const events = new MutableSharedFlow<Event>({
  replay: 0,
  extraBufferCapacity: 16,
  overflow: "drop-oldest",
});
```

Buffer ведётся для каждого subscriber. Медленный listener не должен
неограниченно удерживать память.

## Overflow policies

| Policy        | Поведение при полном buffer                 |
| ------------- | ------------------------------------------- |
| `suspend`     | `emit()` ждёт свободное место               |
| `drop-oldest` | удаляет самое старое ожидающее событие      |
| `drop-latest` | игнорирует новое событие                    |
| `error`       | `emit()` reject с `SharedFlowOverflowError` |

Выбор зависит от смысла данных:

- команды, которые нельзя терять → `suspend`;
- UI progress/sensor samples → `drop-oldest`;
- необязательная telemetry → `drop-latest`;
- нарушение capacity является bug → `error`.

## emit и tryEmit

```ts
await events.emit(value);
const accepted = events.tryEmit(value);
```

`emit()` поддерживает backpressure и возвращает Promise. `tryEmit()` никогда не
ждёт и сообщает boolean, если текущая policy не позволяет принять value.

## Listener errors

Ошибка listener:

- отправляется Flow error reporter;
- не ломает других subscribers;
- не превращает SharedFlow в failed state;
- считается обработанным delivery для emit.

## Reset replay

```ts
events.resetReplayCache();
```

Очищает только replay для будущих subscribers. Уже поставленные deliveries не
отменяются.

## ViewModel events в React

```tsx
useSharedFlow(viewModel.events, (event) => {
  if (event.type === "saved") navigate(`/users/${event.id}`);
});
```

Subscription начинается после React commit. Adapter хранит актуальный handler
без вызова callback из abandoned render.

## Event или state?

Если информация должна восстановиться после remount, это state. Например,
«форма сохранена и имеет ID 42» — часть StateFlow. «Показать toast один раз» —
SharedFlow event.

| Требование                                           | Выбор                                     |
| ---------------------------------------------------- | ----------------------------------------- |
| Новый экран должен сразу узнать результат            | `StateFlow`                               |
| Только активный UI должен выполнить transient effect | `SharedFlow`, обычно `replay: 0`          |
| Событие нельзя потерять после restart приложения     | persistent queue/storage, не `SharedFlow` |
| Нужен request/response от одного caller              | Promise/`Result`, не broadcast event      |

Navigation через event удобна, когда решение принимает ViewModel, а сам
переход выполняет React host. Если route уже однозначно следует из durable
state, лучше вычислить его из state и избежать отдельного события.
