import type { Result } from '@kvt/core'
import type { StateFlow } from '@kvt/flow'
import type { TodoRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import type {
  CachedTodoPage,
  PendingTodoMutation,
  Todo,
  TodoCriteria,
  TodoPage
} from '../model/todo.js'

export type LocalTodoResult<T> = Result<
  T,
  Extract<TodoRepositoryFailure, { readonly code: 'storage-unavailable' }>
>

export abstract class LocalTodoRepository {
  abstract observe(criteria: TodoCriteria): StateFlow<CachedTodoPage | undefined>
  abstract load(criteria: TodoCriteria, maxAgeMs: number): Promise<LocalTodoResult<void>>
  abstract savePage(criteria: TodoCriteria, page: TodoPage): Promise<LocalTodoResult<void>>
  abstract find(id: string): Promise<LocalTodoResult<Todo | undefined>>
  abstract create(todo: Todo): Promise<LocalTodoResult<void>>
  abstract update(todo: Todo): Promise<LocalTodoResult<void>>
  abstract replaceId(temporaryId: string, todo: Todo): Promise<LocalTodoResult<void>>
  abstract remove(id: string): Promise<LocalTodoResult<void>>
  abstract enqueue(mutation: PendingTodoMutation): Promise<LocalTodoResult<void>>
  abstract pending(): Promise<LocalTodoResult<readonly PendingTodoMutation[]>>
  abstract removePending(operationId: string): Promise<LocalTodoResult<void>>
}
