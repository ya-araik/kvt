export interface Todo {
  readonly id: string
  readonly userId: string
  readonly title: string
  readonly completed: boolean
}

export type TodoStatusFilter = 'all' | 'active' | 'completed'

export interface TodoCriteria {
  readonly page: number
  readonly pageSize: number
  readonly search: string
  readonly status: TodoStatusFilter
  readonly userId?: string
}

export interface TodoPage {
  readonly todos: readonly Todo[]
  readonly page: number
  readonly pageSize: number
  readonly totalItems: number
  readonly totalPages: number
  readonly hasPreviousPage: boolean
  readonly hasNextPage: boolean
}

export interface CreateTodoData {
  readonly title: string
  readonly userId: string
  readonly completed: boolean
}

export interface UpdateTodoData {
  readonly title?: string
  readonly completed?: boolean
  readonly userId?: string
}

export interface CachedTodoPage {
  readonly criteria: TodoCriteria
  readonly page: TodoPage
  readonly savedAt: number
}

export type PendingTodoMutation =
  | {
      readonly operationId: string
      readonly kind: 'create'
      readonly todo: Todo
      readonly createdAt: number
    }
  | {
      readonly operationId: string
      readonly kind: 'update'
      readonly todoId: string
      readonly patch: UpdateTodoData
      readonly createdAt: number
    }
  | {
      readonly operationId: string
      readonly kind: 'delete'
      readonly todoId: string
      readonly createdAt: number
    }

export interface TodoFeedState {
  readonly status: 'loading' | 'ready' | 'failure'
  readonly page: TodoPage | undefined
  readonly fetching: boolean
  readonly stale: boolean
  readonly connection: ConnectionStatus
  readonly error?: TodoRepositoryFailure
}
import type { TodoRepositoryFailure } from './failure/todo-repository-failure.js'
import type { ConnectionStatus } from './connection.js'
