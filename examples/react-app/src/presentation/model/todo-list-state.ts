import type { ConnectionStatus } from '../../domain/model/connection.js'
import type { Todo, TodoStatusFilter } from '../../domain/model/todo.js'
import type { User } from '../../domain/model/user.js'

export type TodoMessageKey =
  | 'todo.error.emptyTitle'
  | 'todo.error.titleTooLong'
  | 'todo.error.notFound'
  | 'todo.error.networkUnavailable'
  | 'todo.error.invalidResponse'
  | 'todo.error.storageUnavailable'
  | 'todo.error.unexpectedResponse'

export interface TodoUiError {
  readonly messageKey: TodoMessageKey
  readonly params?: Readonly<Record<string, string | number>>
}

export interface TodoListState {
  readonly status: 'loading' | 'ready' | 'failure'
  readonly todos: readonly Todo[]
  readonly users: readonly User[]
  readonly page: number
  readonly totalPages: number
  readonly totalItems: number
  readonly searchDraft: string
  readonly appliedSearch: string
  readonly statusFilter: TodoStatusFilter
  readonly userFilter: string | undefined
  readonly draft: string
  readonly draftUserId: string | undefined
  readonly editing: { readonly id: string; readonly title: string } | undefined
  readonly saving: boolean
  readonly refreshing: boolean
  readonly pendingIds: readonly string[]
  readonly stale: boolean
  readonly fetching: boolean
  readonly connection: ConnectionStatus
  readonly error: TodoUiError | undefined
}

export type TodoUiEvent =
  | { readonly type: 'created'; readonly title: string }
  | { readonly type: 'updated'; readonly title: string }
  | { readonly type: 'deleted'; readonly title: string }
