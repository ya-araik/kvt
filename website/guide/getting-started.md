# Todo App: первый запуск

Эта глава проходит весь путь данных: domain model → repository port → use case
→ ViewModel → React. Именно такую структуру создаёт официальный шаблон.

В конце получится SPA с двумя routes, route-owned ViewModel и root singleton
repository. Пример намеренно использует память вместо HTTP: так видны
архитектурные границы без шума network client и server API.

```text
domain/model ← domain/repository ← domain/usecase ← presentation
       ↑               ↑                                  ↑
       └──────── data/repository                    app/navigation
```

Подробнее о соответствии кругам и Dependency Rule:
[Clean Architecture в KVT](/guide/clean-architecture).

## Создать проект

```bash
npm create kvt@latest my-todo -- spa
cd my-todo
npm install
npm run dev
```

Требования: Node.js 20/22/24, ESM, TypeScript 5.7+, React 18.3/19. Также
доступны шаблоны `core` и `ssr`.

После запуска откройте `/`, добавьте несколько задач, перейдите на `/about` и
вернитесь. ViewModel будет создана заново, а задачи сохранятся: это практическая
проверка различия route owner и root singleton.

## 1. Domain model

Файл: `src/domain/model/todo.ts`.

```ts
export interface Todo {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
}
```

Ожидаемые business failures тоже являются domain models. Они отделены от
entities подкаталогом `domain/model/failure`:

```ts
// src/domain/model/failure/todo-use-case-failures.ts

export type AddTodoFailure =
  | { code: "empty-title" }
  | { code: "title-too-long"; maxLength: number }
  | { code: "storage-unavailable" };
```

Ожидаемая ошибка — часть контракта, а не `throw new Error('текст')`. UI позже
сопоставит `code` со своей локализацией.

## 2. Repository contract

Файл: `src/domain/repository/todo-repository.ts`.

```ts
export abstract class TodoRepository {
  abstract readonly todos: StateFlow<readonly Todo[]>;
  abstract add(
    title: string,
    signal: AbortSignal,
  ): Promise<Result<void, TodoRepositoryFailure>>;
  abstract toggle(
    id: string,
    signal: AbortSignal,
  ): Promise<Result<void, TodoRepositoryFailure>>;
  abstract remove(
    id: string,
    signal: AbortSignal,
  ): Promise<Result<void, TodoRepositoryFailure>>;
}
```

Используем abstract class: она задаёт type contract и одновременно существует
в JavaScript как DI identifier. Token здесь не нужен.

## 3. Data adapter

Файл: `src/data/repository/memory-todo-repository.ts`.

```ts
export class MemoryTodoRepository extends TodoRepository {
  readonly #todos = new MutableStateFlow<readonly Todo[]>([]);
  readonly todos = this.#todos.asStateFlow();
  // add/toggle/remove возвращают Result
}
```

Domain не знает, где лежат данные. Позже Memory implementation можно заменить
HTTP/IndexedDB binding без изменения use cases или ViewModel.

## 4. Use cases

Файлы находятся в `src/domain/usecase`. Use case является business rule
конкретного приложения, а не частью data или presentation.

```ts
export class ObserveTodosUseCase {
  constructor(private readonly repository: TodoRepository) {}

  execute(): StateFlow<readonly Todo[]> {
    return this.repository.todos;
  }
}

export class AddTodoUseCase {
  constructor(private readonly repository: TodoRepository) {}

  async execute(input: { title: string }, context: UseCaseContext) {
    const title = input.title.trim();
    if (title.length === 0) return err({ code: "empty-title" } as const);
    const result = await this.repository.add(title, context.signal);
    return result.ok ? ok() : err({ code: "storage-unavailable" } as const);
  }
}
```

Потоковый use case только возвращает `StateFlow`: его `execute()` не требует
фиктивного input или signal, потому что временем жизни подписки управляет
collector. Асинхронный use case получает `UseCaseContext`, но ViewModel передаёт
его через `viewModelScope.run()`, а не собирает вручную. ViewModel не становится
прокси-сервисом над repository и не знает infrastructure.

## 5. ViewModel

```ts
export class TodoListViewModel extends ViewModel {
  readonly #state = new MutableStateFlow<TodoListState>(initialState);
  readonly state = this.#state.asStateFlow();

  constructor(
    private readonly observeTodos: ObserveTodosUseCase,
    private readonly addTodoUseCase: AddTodoUseCase,
    private readonly toggleTodoUseCase: ToggleTodoUseCase,
    private readonly removeTodoUseCase: RemoveTodoUseCase,
  ) {
    super();
  }

  protected override onStart(): void {
    this.viewModelScope.collect(this.observeTodos.execute(), (todos) =>
      this.#state.update((state) => ({ ...state, todos })),
    );
  }

  async addTodo(title: string): Promise<void> {
    const result = await this.viewModelScope.run(this.addTodoUseCase, {
      title,
    });
    if (result === undefined) return; // ViewModel уже остановлена
    // сопоставить Result с presentation state
  }
}
```

Constructor чистый: создаёт только локальное состояние. Framework вызывает
`onStart()` после commit route owner. Всё в `viewModelScope` отменяется при
выходе с маршрута. `run()` автоматически передаёт signal текущей ViewModel и
возвращает `undefined`, если scope остановлен до завершения операции.

## 6. DI module

```ts
export const todoModule = defineModule({
  id: "todo",
  version: "1.0.0",
  providers: [
    bind(TodoRepository).to(MemoryTodoRepository).singleton(),
    bind(ObserveTodosUseCase).inject(TodoRepository),
    bind(AddTodoUseCase).inject(TodoRepository),
    bind(ToggleTodoUseCase).inject(TodoRepository),
    bind(RemoveTodoUseCase).inject(TodoRepository),
    bind(TodoListViewModel)
      .inject(
        ObserveTodosUseCase,
        AddTodoUseCase,
        ToggleTodoUseCase,
        RemoveTodoUseCase,
      )
      .viewModel(),
  ],
});
```

Repository singleton сохраняет задачи при переходе `/` → `/about` → `/`.
Use cases transient по умолчанию. ViewModel принадлежит owner активного route.
`id` и `version` описывают идентичность и совместимость модуля; подробные
правила находятся в разделе [Modules, plugins и features](/core/modules-plugins-features#зачем-модулю-id).

## 7. Routes

```tsx
export const routes = [
  { path: "/", Component: TodoPage },
  { path: "/about", Component: AboutPage },
];
```

Это обычные React Router objects. KVT автоматически создаёт owner для каждого
match; ручные route scope flags не нужны.

## 8. React UI

```tsx
export function TodoPage() {
  const viewModel = useViewModel(TodoListViewModel);
  const state = useStateFlow(viewModel.state);

  return <TodoScreen state={state} viewModel={viewModel} />;
}
```

Hook получает уже зарегистрированную ViewModel по классу. Он держит lease, но
не владеет lifecycle. Несколько компонентов внутри route получают тот же
instance.

## 9. Bootstrap

```tsx
const runtime = await bootstrapKvt({ modules: [todoModule] });
const router = createKvtBrowserRouter({ runtime, routes });

createRoot(document.getElementById("root")!).render(
  <KvtProvider runtime={runtime}>
    <RouterProvider router={router} />
  </KvtProvider>,
);
```

Runtime и router создаются до React. `KvtProvider` сам обрабатывает реальный
выход browser page; обычный React unmount не считается завершением приложения.

## 10. Проверка

```bash
npx kvt doctor
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

Framework-specific lint rules и настройка Prettier разобраны в разделе
[Lint и форматирование](/operations/code-quality).

## Как проверить lifecycle вручную

1. Откройте Todo route: создаётся route owner и `TodoListViewModel`.
2. Добавьте задачу: command выполняется через `viewModelScope.run()`.
3. Перейдите на `/about`: collection и ViewModel закрываются.
4. Вернитесь на `/`: создаётся новая ViewModel, но singleton repository сразу
   отдаёт сохранённый StateFlow snapshot.
5. Закройте страницу: `KvtProvider` инициирует shutdown root runtime.

Если задачи исчезли на шаге 4, repository получил слишком узкий lifetime. Если
ViewModel не закрылась на шаге 3, route owner или router cleanup настроены
неверно.

Следующий шаг — [построчный разбор Todo example](/guide/react-example).
