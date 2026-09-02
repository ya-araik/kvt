export type TodoRepositoryFailure =
  | { readonly code: 'todo-not-found'; readonly id: string }
  | { readonly code: 'storage-unavailable' }
