export interface User {
  readonly id: string
  readonly name: string
  readonly username: string
  readonly email: string
}

export interface CachedUsers {
  readonly users: readonly User[]
  readonly savedAt: number
}

export interface UsersState {
  readonly status: 'loading' | 'ready' | 'failure'
  readonly users: readonly User[]
  readonly fetching: boolean
  readonly stale: boolean
  readonly error?: UserRepositoryFailure
}
import type { UserRepositoryFailure } from './failure/todo-repository-failure.js'
