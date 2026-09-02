import type { Result } from '@kvt/core'
import type { StateFlow } from '@kvt/flow'
import type { TodoRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import type { Todo } from '../model/todo.js'

export abstract class TodoRepository {
  abstract readonly todos: StateFlow<readonly Todo[]>

  abstract add(title: string, signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>>
  abstract toggle(id: string, signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>>
  abstract remove(id: string, signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>>
}
