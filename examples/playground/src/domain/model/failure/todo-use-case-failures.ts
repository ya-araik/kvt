import type { TodoRepositoryFailure } from './todo-repository-failure.js'

export type AddTodoFailure =
  | { readonly code: 'empty-title' }
  | { readonly code: 'title-too-long'; readonly maxLength: number }
  | { readonly code: 'storage-unavailable' }

export type ChangeTodoFailure = TodoRepositoryFailure
