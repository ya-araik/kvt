# Clean Architecture в KVT-проекте

## Сначала главное: спецификации папок нет

Clean Architecture не задаёт обязательные названия каталогов. В первоисточнике
Robert C. Martin прямо пишет, что четыре круга на схеме условны и слоёв может
быть больше. Неизменным остаётся **Dependency Rule**: исходные зависимости
могут смотреть только внутрь, а внутренний слой ничего не знает о внешнем.

KVT использует следующую файловую конвенцию:

```text
src/
├── domain/
│   ├── model/          entities, value objects и domain failures
│   ├── repository/     порты, необходимые use cases
│   └── usecase/        application-specific business rules
├── data/
│   └── repository/     реализации domain repository ports
├── presentation/
│   ├── model/          UI state и UI-specific errors
│   ├── viewmodel/      state holders и обработка intent
│   └── view/           React screens/components
├── app/
│   ├── di/             composition root и module wiring
│   ├── navigation/     routes
│   └── app.tsx         внешний UI shell
└── main.tsx            browser host/entry point
```

Это не попытка объявить структуру единственно возможной. Это выбранная KVT
конвенция, которая делает архитектурные границы видимыми и проверяемыми.

## Как каталоги соответствуют кругам

| KVT-каталог         | Роль Clean Architecture            | Может зависеть от                         |
| ------------------- | ---------------------------------- | ----------------------------------------- |
| `domain/model`      | Entities                           | других domain models                      |
| `domain/repository` | Use Case ports/gateways            | `domain/model`                            |
| `domain/usecase`    | Use Cases / Interactors            | model, repository ports, другие use cases |
| `data`              | Interface Adapters                 | domain contracts                          |
| `presentation`      | Interface Adapters                 | domain contracts и собственные UI types   |
| `app`, `main.tsx`   | Frameworks & Drivers / composition | всех внутренних слоёв                     |

Use case лежит внутри `domain/usecase`, потому что в KVT словом `domain`
обозначается вся renderer-independent business core: entities, порты и
application-specific rules. Это также соответствует привычной Kotlin/Android
конвенции, где use cases помещаются в domain layer. При этом entities и use
cases не смешиваются в одном каталоге и сохраняют разное направление
зависимостей.

## Правильное направление

```text
main/app ───────────────┐
  │                     │
  ├──> presentation ────┼──> domain/usecase ──> domain/repository
  │                     │            │                    │
  └──> data/repository ─┘            └────────> domain/model
            │
            └─────────────────────────────────> domain
```

Примеры допустимых импортов:

```ts
// presentation/viewmodel
import { AddTodoUseCase } from "../../domain/usecase/add-todo-use-case.js";

// data/repository
import { TodoRepository } from "../../domain/repository/todo-repository.js";

// app/di — composition root знает обе стороны binding
bind(TodoRepository).to(MemoryTodoRepository).singleton();
```

Недопустимо:

```ts
// domain не знает data implementation
import { MemoryTodoRepository } from "../../data/repository/memory-todo-repository.js";

// ViewModel не обходит use case и не зависит от implementation
import { MemoryTodoRepository } from "../../data/repository/memory-todo-repository.js";

// data не знает React/ViewModel
import { TodoListViewModel } from "../../presentation/viewmodel/todo-list-view-model.js";
```

## Почему repository interface находится в domain

Use case должен уметь запросить или изменить данные, не зная HTTP, IndexedDB,
SQL или памяти. Поэтому требуемый ему interface является внутренним портом:

```ts
export abstract class TodoRepository {
  abstract readonly todos: StateFlow<readonly Todo[]>;
  abstract add(
    title: string,
    signal: AbortSignal,
  ): Promise<Result<void, TodoRepositoryFailure>>;
}
```

Реализация находится снаружи:

```ts
export class MemoryTodoRepository extends TodoRepository {
  // MutableStateFlow и способ хранения являются detail data-слоя.
}
```

Связь между ними знает только `app/di/todo-module.ts`. Это и есть dependency
inversion: use case зависит от своего порта, а внешний adapter реализует порт.

## Где находятся failures

В выбранной layer-first структуре ожидаемая ошибка является domain value, а
значит находится в model layer:

```text
domain/model/failure/
├── todo-repository-failure.ts
└── todo-use-case-failures.ts
```

- `TodoRepositoryFailure` описывает ожидаемый результат domain port;
- `AddTodoFailure` и `ChangeTodoFailure` описывают результаты use cases;
- `TodoUiError`/message key остаётся в `presentation/model`;
- неожиданный framework defect остаётся `KvtError`, а не domain failure.

Важно различать domain failure и технический exception. HTTP status, stack
trace или текст ошибки драйвера не являются domain model: data adapter обязан
сопоставить их с безопасным domain failure. Так data layer не протекает в
domain, а domain не знает UI-текст.

## Framework-зависимости во внутренних слоях

`domain/model` остаётся обычным TypeScript и не импортирует React или KVT.
Repository ports и use cases могут использовать только renderer-neutral
контракты `@kvt/core` и `@kvt/flow`: `Result`, `UseCaseContext`, `StateFlow`.
Они не импортируют React, Router, browser storage, HTTP client или конкретный
query engine.

Это осознанная граница KVT. Если business core должен быть полностью независим
даже от KVT types, приложение может определить собственные структурные порты и
адаптировать их в composition root.

## Автоматическая проверка

`npm run check:boundaries` проверяет Todo templates и examples:

- отсутствие старого `src/application`;
- запрет domain → data/presentation/app;
- запрет data → presentation/app;
- запрет presentation → data/app;
- порядок внутри domain: model ← repository ← usecase;
- отсутствие React imports в domain/data;
- отсутствие framework imports в `domain/model`.

Эта проверка важнее визуального совпадения дерева: правильная папка с
неправильным импортом всё равно нарушает Clean Architecture.

## Куда положить новый код

Используйте вопрос «кто должен знать об этом типе?»:

| Новый код                                 | Каталог                  | Почему                                  |
| ----------------------------------------- | ------------------------ | --------------------------------------- |
| `Invoice`, `Money`, business failure      | `domain/model`           | Не зависит от хранения и UI             |
| Требуемая use case операция чтения/записи | `domain/repository`      | Внутренний порт                         |
| Правило «оплатить счёт»                   | `domain/usecase`         | Application-specific business operation |
| HTTP/IndexedDB реализация порта           | `data/repository`        | Infrastructure detail                   |
| Screen state и message key                | `presentation/model`     | Зависит от требований UI                |
| Intent и координация state                | `presentation/viewmodel` | Renderer-independent presentation logic |
| JSX и accessibility                       | `presentation/view`      | React adapter                           |
| Binding interface к implementation        | `app/di`                 | Composition root знает обе стороны      |

Если один файл хочется положить одновременно в domain и data, вероятно, в нём
смешаны contract и implementation. Разделите port и adapter.

## Как добавить feature

1. Сначала опишите model и ожидаемые failures.
2. Определите repository port только с теми операциями, которые нужны use cases.
3. Напишите use case и протестируйте его с fake port.
4. Реализуйте data adapter.
5. Добавьте ViewModel state/intents.
6. Свяжите implementation и contract только в module.
7. Подключите route и React view.

Такой порядок не требует заранее проектировать всю infrastructure и сразу
показывает, если domain contract начал зависеть от HTTP или React.

## Источники

- [Robert C. Martin — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Android Developers — Domain layer](https://developer.android.com/topic/architecture/domain-layer)
- [Android Developers — Guide to app architecture](https://developer.android.com/topic/architecture)
