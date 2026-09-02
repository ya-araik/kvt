import { err, ok, type Result } from '@kvt/core'
import type { UserRepositoryFailure } from '../../domain/model/failure/todo-repository-failure.js'
import type { User } from '../../domain/model/user.js'
import { NetworkUserRepository } from '../../domain/repository/network-user-repository.js'
import { parseUsersDto } from '../dto/user-dto.js'
import { HttpRequestFailure, JsonServerHttpClient } from '../http/json-server-http-client.js'
import { mapUserDtoToDomain } from '../mapper/user-mapper.js'

export class HttpUserRepository extends NetworkUserRepository {
  constructor(private readonly http: JsonServerHttpClient) {
    super()
  }

  async list(signal: AbortSignal): Promise<Result<readonly User[], UserRepositoryFailure>> {
    try {
      return ok(
        Object.freeze(
          parseUsersDto(await this.http.request('/users?_sort=name', { signal })).map(
            mapUserDtoToDomain
          )
        )
      )
    } catch (error) {
      if (error instanceof HttpRequestFailure) {
        return err(
          error.kind === 'network'
            ? { code: 'network-unavailable' }
            : { code: 'unexpected-response', status: error.status ?? 0 }
        )
      }
      return err(
        error instanceof TypeError || error instanceof SyntaxError
          ? { code: 'invalid-response' }
          : { code: 'network-unavailable' }
      )
    }
  }
}
