import { ViewModel, match } from '@kvt/core'
import { MutableStateFlow } from '@kvt/flow'
import { AddTodoUseCase } from '../../domain/usecase/add-todo-use-case.js'
import { ObserveTodosUseCase } from '../../domain/usecase/observe-todos-use-case.js'
import { RemoveTodoUseCase } from '../../domain/usecase/remove-todo-use-case.js'
import { ToggleTodoUseCase } from '../../domain/usecase/toggle-todo-use-case.js'
import type {
  AddTodoFailure,
  ChangeTodoFailure
} from '../../domain/model/failure/todo-use-case-failures.js'
import type { TodoListState, TodoUiError } from '../model/todo-list-state.js'

export class TodoListViewModel extends ViewModel {
  readonly #state = new MutableStateFlow<TodoListState>({
    todos: [],
    draft: '',
    saving: false,
    error: undefined
  })
  readonly state = this.#state.asStateFlow()

  constructor(
    private readonly observeTodos: ObserveTodosUseCase,
    private readonly addTodoUseCase: AddTodoUseCase,
    private readonly toggleTodoUseCase: ToggleTodoUseCase,
    private readonly removeTodoUseCase: RemoveTodoUseCase
  ) {
    super()
  }

  protected override onStart(): void {
    this.viewModelScope.collect(this.observeTodos.execute(), (next) =>
      this.#state.update((state) => ({ ...state, todos: next }))
    )
  }

  setDraft(draft: string): void {
    this.#state.update((state) => ({ ...state, draft, error: undefined }))
  }

  async addTodo(): Promise<void> {
    if (this.#state.value.saving) return
    const title = this.#state.value.draft
    this.#state.update((state) => ({
      ...state,
      saving: true,
      error: undefined
    }))
    const result = await this.viewModelScope.run(this.addTodoUseCase, {
      title
    })
    if (result === undefined) return
    match(result, {
      ok: () => this.#state.update((state) => ({ ...state, draft: '', saving: false })),
      err: (failure) =>
        this.#state.update((state) => ({
          ...state,
          saving: false,
          error: addError(failure)
        }))
    })
  }

  async toggleTodo(id: string): Promise<void> {
    const result = await this.viewModelScope.run(this.toggleTodoUseCase, id)
    if (result && !result.ok)
      this.#state.update((state) => ({
        ...state,
        error: changeError(result.error)
      }))
  }

  async removeTodo(id: string): Promise<void> {
    const result = await this.viewModelScope.run(this.removeTodoUseCase, id)
    if (result && !result.ok)
      this.#state.update((state) => ({
        ...state,
        error: changeError(result.error)
      }))
  }
}

function addError(failure: AddTodoFailure): TodoUiError {
  switch (failure.code) {
    case 'empty-title':
      return { messageKey: 'todo.error.emptyTitle' }
    case 'title-too-long':
      return {
        messageKey: 'todo.error.titleTooLong',
        params: { maxLength: failure.maxLength }
      }
    case 'storage-unavailable':
      return { messageKey: 'todo.error.storageUnavailable' }
  }
}

function changeError(failure: ChangeTodoFailure): TodoUiError {
  return failure.code === 'todo-not-found'
    ? { messageKey: 'todo.error.notFound' }
    : { messageKey: 'todo.error.storageUnavailable' }
}
