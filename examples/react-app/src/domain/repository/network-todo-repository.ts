import type { Result } from '@kvt/core'
import type { TodoRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import type { CreateTodoData, Todo, TodoCriteria, TodoPage, UpdateTodoData } from '../model/todo.js'

export abstract class NetworkTodoRepository {
  abstract list(
    criteria: TodoCriteria,
    signal: AbortSignal
  ): Promise<Result<TodoPage, TodoRepositoryFailure>>
  abstract create(
    input: CreateTodoData,
    signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>>
  abstract update(
    id: string,
    patch: UpdateTodoData,
    signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>>
  abstract remove(id: string, signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>>
}
