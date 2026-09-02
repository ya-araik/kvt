import { ViewModel } from '@kvt/core'
import { MutableSharedFlow, MutableStateFlow, type Subscription } from '@kvt/flow'
import type { TodoRepositoryFailure } from '../../domain/model/failure/todo-repository-failure.js'
import type {
  AddTodoFailure,
  UpdateTodoFailure
} from '../../domain/model/failure/todo-use-case-failures.js'
import type { Todo, TodoCriteria, TodoStatusFilter } from '../../domain/model/todo.js'
import { AddTodoUseCase } from '../../domain/usecase/add-todo-use-case.js'
import { ObserveTodosUseCase } from '../../domain/usecase/observe-todos-use-case.js'
import { ObserveUsersUseCase } from '../../domain/usecase/observe-users-use-case.js'
import { RefreshTodosUseCase } from '../../domain/usecase/refresh-todos-use-case.js'
import { RemoveTodoUseCase } from '../../domain/usecase/remove-todo-use-case.js'
import { ToggleTodoUseCase } from '../../domain/usecase/toggle-todo-use-case.js'
import { UpdateTodoUseCase } from '../../domain/usecase/update-todo-use-case.js'
import type { TodoListState, TodoUiError, TodoUiEvent } from '../model/todo-list-state.js'

const initialCriteria: TodoCriteria = Object.freeze({
  page: 1,
  pageSize: 20,
  search: '',
  status: 'all'
})

export class TodoListViewModel extends ViewModel {
  readonly #state = new MutableStateFlow<TodoListState>({
    status: 'loading',
    todos: [],
    users: [],
    page: 1,
    totalPages: 1,
    totalItems: 0,
    searchDraft: '',
    appliedSearch: '',
    statusFilter: 'all',
    userFilter: undefined,
    draft: '',
    draftUserId: undefined,
    editing: undefined,
    saving: false,
    refreshing: false,
    pendingIds: [],
    stale: false,
    fetching: false,
    connection: 'online',
    error: undefined
  })
  readonly state = this.#state.asStateFlow()
  readonly #events = new MutableSharedFlow<TodoUiEvent>({
    replay: 0,
    extraBufferCapacity: 8,
    overflow: 'drop-oldest'
  })
  readonly events = this.#events.asSharedFlow()
  readonly #searchTask
  #criteria = initialCriteria
  #todoSubscription: Subscription | undefined

  constructor(
    private readonly observeTodos: ObserveTodosUseCase,
    private readonly observeUsers: ObserveUsersUseCase,
    private readonly addTodoUseCase: AddTodoUseCase,
    private readonly updateTodoUseCase: UpdateTodoUseCase,
    private readonly toggleTodoUseCase: ToggleTodoUseCase,
    private readonly removeTodoUseCase: RemoveTodoUseCase,
    private readonly refreshTodosUseCase: RefreshTodosUseCase
  ) {
    super()
    this.#searchTask = this.viewModelScope.task<string, string>(
      'latest',
      async (search, signal) => {
        await wait(300, signal)
        return search.trim()
      }
    )
  }

  protected override onStart(): void {
    this.viewModelScope.collect(this.observeUsers.execute(), (state) => {
      this.#state.update((current) => ({
        ...current,
        users: state.users,
        draftUserId: current.draftUserId ?? state.users[0]?.id
      }))
    })
    this.#bindTodos()
  }

  setDraft(draft: string): void {
    this.#state.update((state) => ({ ...state, draft, error: undefined }))
  }

  setDraftUser(userId: string): void {
    this.#state.update((state) => ({ ...state, draftUserId: userId }))
  }

  searchChanged(searchDraft: string): void {
    this.#state.update((state) => ({ ...state, searchDraft }))
    void this.#applySearch(searchDraft)
  }

  setStatusFilter(status: TodoStatusFilter): void {
    this.#criteria = Object.freeze({ ...this.#criteria, page: 1, status })
    this.#state.update((state) => ({ ...state, statusFilter: status, page: 1 }))
    this.#bindTodos()
  }

  setUserFilter(userId: string | undefined): void {
    const base: TodoCriteria = {
      page: 1,
      pageSize: this.#criteria.pageSize,
      search: this.#criteria.search,
      status: this.#criteria.status,
      ...(userId === undefined ? {} : { userId })
    }
    this.#criteria = Object.freeze({
      ...base,
      page: 1
    })
    this.#state.update((state) => ({ ...state, userFilter: userId, page: 1 }))
    this.#bindTodos()
  }

  setPage(page: number): void {
    const bounded = Math.max(1, Math.min(page, this.#state.value.totalPages))
    if (bounded === this.#criteria.page) return
    this.#criteria = Object.freeze({ ...this.#criteria, page: bounded })
    this.#state.update((state) => ({ ...state, page: bounded }))
    this.#bindTodos()
  }

  beginEdit(todo: Todo): void {
    this.#state.update((state) => ({
      ...state,
      editing: { id: todo.id, title: todo.title },
      error: undefined
    }))
  }

  editChanged(title: string): void {
    this.#state.update((state) =>
      state.editing === undefined
        ? state
        : { ...state, editing: { ...state.editing, title }, error: undefined }
    )
  }

  cancelEdit(): void {
    this.#state.update((state) => ({ ...state, editing: undefined }))
  }

  async addTodo(): Promise<void> {
    const current = this.#state.value
    if (current.saving || current.draftUserId === undefined) return
    this.#state.update((state) => ({ ...state, saving: true, error: undefined }))
    const result = await this.viewModelScope.run(this.addTodoUseCase, {
      title: current.draft,
      userId: current.draftUserId
    })
    if (result === undefined) return
    if (result.ok) {
      this.#state.update((state) => ({ ...state, draft: '', saving: false }))
      await this.#events.emit({ type: 'created', title: result.value.title })
    } else {
      this.#state.update((state) => ({ ...state, saving: false, error: toUiError(result.error) }))
    }
  }

  async saveEdit(): Promise<void> {
    const editing = this.#state.value.editing
    if (!editing || this.#isPending(editing.id)) return
    this.#setPending(editing.id, true)
    const result = await this.viewModelScope.run(this.updateTodoUseCase, editing)
    if (result === undefined) return
    this.#setPending(editing.id, false)
    if (result.ok) {
      this.#state.update((state) => ({ ...state, editing: undefined }))
      await this.#events.emit({ type: 'updated', title: result.value.title })
    } else {
      this.#state.update((state) => ({ ...state, error: toUiError(result.error) }))
    }
  }

  async toggleTodo(todo: Todo): Promise<void> {
    if (this.#isPending(todo.id)) return
    this.#setPending(todo.id, true)
    const result = await this.viewModelScope.run(this.toggleTodoUseCase, {
      id: todo.id,
      completed: todo.completed
    })
    if (result === undefined) return
    this.#setPending(todo.id, false)
    if (!result.ok) this.#state.update((state) => ({ ...state, error: toUiError(result.error) }))
  }

  async removeTodo(todo: Todo): Promise<void> {
    if (this.#isPending(todo.id)) return
    this.#setPending(todo.id, true)
    const result = await this.viewModelScope.run(this.removeTodoUseCase, todo.id)
    if (result === undefined) return
    this.#setPending(todo.id, false)
    if (result.ok) await this.#events.emit({ type: 'deleted', title: todo.title })
    else this.#state.update((state) => ({ ...state, error: toUiError(result.error) }))
  }

  async refresh(): Promise<void> {
    if (this.#state.value.refreshing) return
    this.#state.update((state) => ({ ...state, refreshing: true, error: undefined }))
    const result = await this.viewModelScope.run(this.refreshTodosUseCase)
    if (result === undefined) return
    this.#state.update((state) => ({
      ...state,
      refreshing: false,
      ...(result.ok ? {} : { error: toUiError(result.error) })
    }))
  }

  clearError(): void {
    this.#state.update((state) => ({ ...state, error: undefined }))
  }

  async #applySearch(searchDraft: string): Promise<void> {
    const search = await this.#searchTask.run(searchDraft)
    if (search === undefined || search === this.#criteria.search) return
    this.#criteria = Object.freeze({ ...this.#criteria, page: 1, search })
    this.#state.update((state) => ({ ...state, appliedSearch: search, page: 1 }))
    this.#bindTodos()
  }

  #bindTodos(): void {
    this.#todoSubscription?.cancel('criteria-changed')
    this.#todoSubscription = this.viewModelScope.collect(
      this.observeTodos.execute(this.#criteria),
      (feed) => {
        const page = feed.page
        this.#state.update((state) => ({
          ...state,
          status: feed.status === 'failure' && page !== undefined ? 'ready' : feed.status,
          todos: page?.todos ?? [],
          page: page?.page ?? this.#criteria.page,
          totalPages: Math.max(1, page?.totalPages ?? 1),
          totalItems: page?.totalItems ?? 0,
          stale: feed.stale || feed.status === 'failure',
          fetching: feed.fetching,
          connection: feed.connection,
          ...(feed.status === 'failure' && feed.error !== undefined
            ? { error: toUiError(feed.error) }
            : {})
        }))
      }
    )
  }

  #isPending(id: string): boolean {
    return this.#state.value.pendingIds.includes(id)
  }

  #setPending(id: string, pending: boolean): void {
    this.#state.update((state) => ({
      ...state,
      pendingIds: pending
        ? state.pendingIds.includes(id)
          ? state.pendingIds
          : [...state.pendingIds, id]
        : state.pendingIds.filter((candidate) => candidate !== id)
    }))
  }
}

function toUiError(
  failure: AddTodoFailure | UpdateTodoFailure | TodoRepositoryFailure
): TodoUiError {
  switch (failure.code) {
    case 'empty-title':
      return { messageKey: 'todo.error.emptyTitle' }
    case 'title-too-long':
      return { messageKey: 'todo.error.titleTooLong', params: { maxLength: failure.maxLength } }
    case 'todo-not-found':
      return { messageKey: 'todo.error.notFound' }
    case 'network-unavailable':
      return { messageKey: 'todo.error.networkUnavailable' }
    case 'invalid-response':
      return { messageKey: 'todo.error.invalidResponse' }
    case 'storage-unavailable':
      return { messageKey: 'todo.error.storageUnavailable' }
    case 'unexpected-response':
      return { messageKey: 'todo.error.unexpectedResponse', params: { status: failure.status } }
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
