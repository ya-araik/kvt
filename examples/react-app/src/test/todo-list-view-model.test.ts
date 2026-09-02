import { ok, type Result, type ShutdownContext } from '@kvt/core'
import { MutableStateFlow } from '@kvt/flow'
import { describe, expect, it, vi } from 'vitest'
import { BrowserConnectivity } from '../data/browser/browser-connectivity.js'
import type {
  TodoRepositoryFailure,
  UserRepositoryFailure
} from '../domain/model/failure/todo-repository-failure.js'
import type {
  CachedTodoPage,
  CreateTodoData,
  PendingTodoMutation,
  Todo,
  TodoCriteria,
  TodoPage,
  UpdateTodoData
} from '../domain/model/todo.js'
import type { CachedUsers, User } from '../domain/model/user.js'
import {
  LocalTodoRepository,
  type LocalTodoResult
} from '../domain/repository/local-todo-repository.js'
import {
  LocalUserRepository,
  type LocalUserResult
} from '../domain/repository/local-user-repository.js'
import { NetworkTodoRepository } from '../domain/repository/network-todo-repository.js'
import { NetworkUserRepository } from '../domain/repository/network-user-repository.js'
import { AddTodoUseCase } from '../domain/usecase/add-todo-use-case.js'
import { ObserveTodosUseCase } from '../domain/usecase/observe-todos-use-case.js'
import { ObserveUsersUseCase } from '../domain/usecase/observe-users-use-case.js'
import { RefreshTodosUseCase } from '../domain/usecase/refresh-todos-use-case.js'
import { RemoveTodoUseCase } from '../domain/usecase/remove-todo-use-case.js'
import { ToggleTodoUseCase } from '../domain/usecase/toggle-todo-use-case.js'
import { UpdateTodoUseCase } from '../domain/usecase/update-todo-use-case.js'
import type { TodoUiEvent } from '../presentation/model/todo-list-state.js'
import { TodoListViewModel } from '../presentation/viewmodel/todo-list-view-model.js'

const shutdownContext: ShutdownContext = {
  signal: new AbortController().signal,
  reason: 'test',
  deadline: undefined
}

describe('TodoListViewModel', () => {
  it('owns filters, debounces search and exposes CRUD events separately from state', async () => {
    const networkTodos = new FakeNetworkTodoRepository()
    const localTodos = new MemoryLocalTodoRepository()
    const connectivity = new BrowserConnectivity()
    const observeTodos = new ObserveTodosUseCase(networkTodos, localTodos, connectivity)
    const users = new ObserveUsersUseCase(
      new FakeNetworkUserRepository(),
      new MemoryLocalUserRepository(),
      connectivity
    )
    const viewModel = new TodoListViewModel(
      observeTodos,
      users,
      new AddTodoUseCase(networkTodos, localTodos, connectivity),
      new UpdateTodoUseCase(networkTodos, localTodos, connectivity),
      new ToggleTodoUseCase(networkTodos, localTodos, connectivity),
      new RemoveTodoUseCase(networkTodos, localTodos, connectivity),
      new RefreshTodosUseCase(observeTodos)
    )
    const events: TodoUiEvent[] = []
    const eventSubscription = viewModel.events.subscribe((event) => {
      events.push(event)
    })
    await viewModel.start(new AbortController().signal)
    await vi.waitFor(() => expect(viewModel.state.value.draftUserId).toBe('1'))

    viewModel.setStatusFilter('active')
    await vi.waitFor(() => expect(networkTodos.queries.at(-1)?.status).toBe('active'))
    viewModel.searchChanged('первый')
    viewModel.searchChanged('финальный запрос')
    await vi.waitFor(() => expect(networkTodos.queries.at(-1)?.search).toBe('финальный запрос'), {
      timeout: 1_000
    })

    viewModel.setDraft('  Создано через ViewModel  ')
    await viewModel.addTodo()
    expect(events).toEqual([{ type: 'created', title: 'Создано через ViewModel' }])
    expect(viewModel.state.value.draft).toBe('')

    await eventSubscription.cancel()
    await viewModel.shutdown(shutdownContext)
    expect(viewModel.lifecycleState.value).toBe('stopped')
  })
})

class FakeNetworkTodoRepository extends NetworkTodoRepository {
  readonly queries: TodoCriteria[] = []
  #nextId = 2

  list(
    query: TodoCriteria,
    _signal: AbortSignal
  ): Promise<Result<TodoPage, TodoRepositoryFailure>> {
    this.queries.push(query)
    return Promise.resolve(ok(page()))
  }

  create(
    input: CreateTodoData,
    _signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>> {
    return Promise.resolve(ok({ id: String(this.#nextId++), ...input }))
  }

  update(
    id: string,
    patch: UpdateTodoData,
    _signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>> {
    return Promise.resolve(
      ok({
        id,
        userId: '1',
        title: patch.title ?? 'Первая задача',
        completed: patch.completed ?? false
      })
    )
  }

  remove(_id: string, _signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>> {
    return Promise.resolve(ok())
  }
}

class MemoryLocalTodoRepository extends LocalTodoRepository {
  readonly #state = new MutableStateFlow<CachedTodoPage | undefined>(undefined)
  readonly #pending: PendingTodoMutation[] = []

  observe(_criteria: TodoCriteria) {
    return this.#state.asStateFlow()
  }
  load(_criteria: TodoCriteria, _maxAgeMs: number): Promise<LocalTodoResult<void>> {
    return Promise.resolve(ok())
  }
  savePage(criteria: TodoCriteria, page: TodoPage): Promise<LocalTodoResult<void>> {
    this.#state.set({ criteria, page, savedAt: Date.now() })
    return Promise.resolve(ok())
  }
  find(id: string): Promise<LocalTodoResult<Todo | undefined>> {
    return Promise.resolve(ok(this.#state.value?.page.todos.find((todo) => todo.id === id)))
  }
  create(todo: Todo): Promise<LocalTodoResult<void>> {
    const cached = this.#state.value
    if (cached)
      this.#state.set({
        ...cached,
        page: {
          ...cached.page,
          todos: [todo, ...cached.page.todos],
          totalItems: cached.page.totalItems + 1
        }
      })
    return Promise.resolve(ok())
  }
  update(todo: Todo): Promise<LocalTodoResult<void>> {
    const cached = this.#state.value
    if (cached)
      this.#state.set({
        ...cached,
        page: {
          ...cached.page,
          todos: cached.page.todos.map((item) => (item.id === todo.id ? todo : item))
        }
      })
    return Promise.resolve(ok())
  }
  replaceId(temporaryId: string, todo: Todo): Promise<LocalTodoResult<void>> {
    const cached = this.#state.value
    if (cached)
      this.#state.set({
        ...cached,
        page: {
          ...cached.page,
          todos: cached.page.todos.map((item) => (item.id === temporaryId ? todo : item))
        }
      })
    return Promise.resolve(ok())
  }
  remove(id: string): Promise<LocalTodoResult<void>> {
    const cached = this.#state.value
    if (cached)
      this.#state.set({
        ...cached,
        page: { ...cached.page, todos: cached.page.todos.filter((todo) => todo.id !== id) }
      })
    return Promise.resolve(ok())
  }
  enqueue(mutation: PendingTodoMutation): Promise<LocalTodoResult<void>> {
    this.#pending.push(mutation)
    return Promise.resolve(ok())
  }
  pending(): Promise<LocalTodoResult<readonly PendingTodoMutation[]>> {
    return Promise.resolve(ok(this.#pending))
  }
  removePending(operationId: string): Promise<LocalTodoResult<void>> {
    const index = this.#pending.findIndex((item) => item.operationId === operationId)
    if (index >= 0) this.#pending.splice(index, 1)
    return Promise.resolve(ok())
  }
}

class FakeNetworkUserRepository extends NetworkUserRepository {
  list(_signal: AbortSignal): Promise<Result<readonly User[], UserRepositoryFailure>> {
    return Promise.resolve(
      ok([{ id: '1', name: 'Leanne Graham', username: 'Bret', email: 'leanne@example.test' }])
    )
  }
}

class MemoryLocalUserRepository extends LocalUserRepository {
  readonly #state = new MutableStateFlow<CachedUsers | undefined>(undefined)
  readonly state = this.#state.asStateFlow()
  load(_maxAgeMs: number): Promise<LocalUserResult<void>> {
    return Promise.resolve(ok())
  }
  save(users: readonly User[]): Promise<LocalUserResult<void>> {
    this.#state.set({ users, savedAt: Date.now() })
    return Promise.resolve(ok())
  }
}

function page(): TodoPage {
  return {
    todos: [{ id: '1', userId: '1', title: 'Первая задача', completed: false }],
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false
  }
}
