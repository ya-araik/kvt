export type TodoRepositoryFailure =
  | { readonly code: 'todo-not-found'; readonly id: string }
  | { readonly code: 'network-unavailable' }
  | { readonly code: 'invalid-response' }
  | { readonly code: 'storage-unavailable' }
  | { readonly code: 'unexpected-response'; readonly status: number }

export type UserRepositoryFailure = Exclude<
  TodoRepositoryFailure,
  { readonly code: 'todo-not-found' }
>
