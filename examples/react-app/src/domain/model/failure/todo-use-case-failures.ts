import type { TodoRepositoryFailure } from './todo-repository-failure.js'

export type AddTodoFailure =
  | { readonly code: 'empty-title' }
  | { readonly code: 'title-too-long'; readonly maxLength: number }
  | TodoRepositoryFailure

export type ChangeTodoFailure = TodoRepositoryFailure

export type UpdateTodoFailure =
  | { readonly code: 'empty-title' }
  | { readonly code: 'title-too-long'; readonly maxLength: number }
  | ChangeTodoFailure
