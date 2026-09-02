# StateFlow

StateFlow — hot container с обязательным текущим immutable snapshot.

Он лучше всего подходит для данных, на которые можно ответить вопросом «что UI
должен отрисовать прямо сейчас?». Новый subscriber сразу получает полноценный
snapshot и не обязан воспроизводить историю событий.

## Как моделировать screen state

Предпочитайте состояние, из которого экран можно восстановить целиком:

```ts
type UsersState =
  | { status: "loading"; users: readonly User[] }
  | { status: "ready"; users: readonly User[] }
  | { status: "failure"; users: readonly User[]; message: string };
```

Discriminated union не позволяет случайно получить сочетание вроде
`loading: true` одновременно с несовместимой error-моделью. Если состояния
могут меняться независимо — например, filter и connection status — их можно
держать раздельно и объединить через `derivedStateFlow`.

## Создание

```ts
const mutable = new MutableStateFlow<UserState>({
  status: "idle",
  users: [],
});

export const state = mutable.asStateFlow();
```

`asStateFlow()` возвращает один стабильный read-only wrapper. Не создавайте
собственную обёртку при каждом getter.

## Чтение и subscription

```ts
state.value;

const subscription = state.subscribe((snapshot) => {
  console.log(snapshot);
});
```

По умолчанию subscriber сразу получает current value. Отключить initial
emission:

```ts
state.subscribe(listener, { emitCurrent: false });
```

## Set и comparator

```ts
mutable.set(nextState);
```

Default comparator — `Object.is`. Равное значение notification не создаёт.

Custom comparator:

```ts
const selection = new MutableStateFlow(initial, {
  comparator: (left, right) => left.id === right.id,
});
```

Comparator должен быть быстрым, симметричным и стабильным.

## Update

```ts
mutable.update((current) => ({
  ...current,
  page: current.page + 1,
}));
```

`update()` принимает reducer для любого `T`. Старого API `update(Partial<T>)`
нет, потому что primitives и discriminated unions нельзя корректно patch таким
способом.

## Object patch

Для object-shaped state существует отдельный class:

```ts
const form = new MutableObjectStateFlow({ name: "", saving: false });
form.patch({ saving: true });
form.patch((current) => ({ name: current.name.trim() }));
```

Patch поверхностный. Nested object обновляйте явно reducer-ом.

## Immutable snapshots

Нельзя:

```ts
mutable.value.users.push(user);
mutable.set(mutable.value);
```

Правильно:

```ts
mutable.update((current) => ({
  ...current,
  users: [...current.users, user],
}));
```

React adapter в development обнаруживает shallow mutation с прежней identity.

## Transaction

Несколько изменений одного state можно опубликовать одним notification:

```ts
mutable.transaction(() => {
  mutable.update(changeA);
  mutable.update(changeB);
});
```

Для нескольких StateFlow:

```ts
batch(
  () => {
    userState.set(nextUser);
    permissionsState.set(nextPermissions);
  },
  userState,
  permissionsState,
);
```

Values меняются внутри batch, а subscribers видят согласованный конечный набор.

## Derived StateFlow

```ts
const fullName = derivedStateFlow(
  [firstName, lastName],
  (first, last) => `${first} ${last}`,
  { keepAliveMs: 5_000 },
);
```

Derived flow:

- вычисляет `.value` синхронно;
- подписывается на sources только при первом subscriber;
- освобождает sources после последнего;
- может временно держать subscription через `keepAliveMs`;
- не теряет последний computed snapshot.

Derived state должен быть чистой функцией sources. Не выполняйте внутри mapper
network request, запись в storage или analytics: повторные вычисления не имеют
семантики команды. Side effects запускайте из use case, task или plugin.

## Reentrant emissions

Во время emission используется snapshot списка subscribers:

- новый subscriber не попадает в уже идущий fan-out;
- cancelled subscriber не получает следующие values;
- exception одного listener не прерывает остальные.

## React

```tsx
const userName = useStateFlow(viewModel.state, {
  selector: (state) => state.user.name,
  equality: Object.is,
});
```

Selector уменьшает renders, но source state всё равно должен оставаться
immutable. Подробнее: [React integration](/application/react).

## Кто владеет mutable частью

Обычно `MutableStateFlow` остаётся private внутри repository или ViewModel, а
наружу выдаётся `StateFlow`:

```ts
class UsersViewModel {
  readonly #state = new MutableStateFlow<UsersState>({
    status: "loading",
    users: [],
  });

  readonly state = this.#state.asStateFlow();
}
```

Так consumer может читать и подписываться, но не менять state в обход intents.
Если несколько независимых классов вызывают `set()` одного mutable container,
границы ownership уже потеряны — перенесите изменения к одному владельцу.
