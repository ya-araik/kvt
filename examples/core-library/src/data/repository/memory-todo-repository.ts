import { err, ok, type Result } from '@kvt/core'
import { MutableStateFlow } from '@kvt/flow'
import type { TodoRepositoryFailure } from '../../domain/model/failure/todo-repository-failure.js'
import { TodoRepository } from '../../domain/repository/todo-repository.js'
import type { Todo } from '../../domain/model/todo.js'

export class MemoryTodoRepository extends TodoRepository {
  readonly #todos = new MutableStateFlow<readonly Todo[]>([])
  readonly todos = this.#todos.asStateFlow()

  async add(title: string, signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>> {
    signal.throwIfAborted()
    this.#todos.update((todos) => [...todos, { id: crypto.randomUUID(), title, completed: false }])
    return ok()
  }

  async toggle(id: string, signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>> {
    signal.throwIfAborted()
    if (!this.#todos.value.some((todo) => todo.id === id))
      return err({ code: 'todo-not-found', id })
    this.#todos.update((todos) =>
      todos.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo))
    )
    return ok()
  }

  async remove(id: string, signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>> {
    signal.throwIfAborted()
    if (!this.#todos.value.some((todo) => todo.id === id))
      return err({ code: 'todo-not-found', id })
    this.#todos.update((todos) => todos.filter((todo) => todo.id !== id))
    return ok()
  }
}
