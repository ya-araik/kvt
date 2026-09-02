import type { Result } from '@kvt/core'
import type { UserRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import type { User } from '../model/user.js'

export abstract class NetworkUserRepository {
  abstract list(signal: AbortSignal): Promise<Result<readonly User[], UserRepositoryFailure>>
}
