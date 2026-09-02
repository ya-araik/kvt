import type { Result } from '@kvt/core'
import type { StateFlow } from '@kvt/flow'
import type { UserRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import type { CachedUsers, User } from '../model/user.js'

export type LocalUserResult<T> = Result<
  T,
  Extract<UserRepositoryFailure, { readonly code: 'storage-unavailable' }>
>

export abstract class LocalUserRepository {
  abstract readonly state: StateFlow<CachedUsers | undefined>
  abstract load(maxAgeMs: number): Promise<LocalUserResult<void>>
  abstract save(users: readonly User[]): Promise<LocalUserResult<void>>
}
