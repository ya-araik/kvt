import type { Todo } from '../../domain/model/todo.js'

export type TodoMessageKey =
  | 'todo.error.emptyTitle'
  | 'todo.error.titleTooLong'
  | 'todo.error.notFound'
  | 'todo.error.storageUnavailable'

export interface TodoUiError {
  readonly messageKey: TodoMessageKey
  readonly params?: Readonly<Record<string, string | number>>
}

export interface TodoListState {
  readonly todos: readonly Todo[]
  readonly draft: string
  readonly saving: boolean
  readonly error: TodoUiError | undefined
}
