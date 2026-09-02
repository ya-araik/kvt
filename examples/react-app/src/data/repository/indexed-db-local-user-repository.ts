import { err, ok } from '@kvt/core'
import { derivedStateFlow, MutableStateFlow } from '@kvt/flow'
import type { CachedUsers, User } from '../../domain/model/user.js'
import {
  LocalUserRepository,
  type LocalUserResult
} from '../../domain/repository/local-user-repository.js'
import { parseUsersDto, type CachedUsersDto } from '../dto/user-dto.js'
import { ShowcaseDatabase, USERS_STORE } from '../local/showcase-database.js'
import { mapUserDomainToDto, mapUserDtoToDomain } from '../mapper/user-mapper.js'

const USERS_KEY = 'all'

export class IndexedDbLocalUserRepository extends LocalUserRepository {
  readonly #state = new MutableStateFlow<CachedUsersDto | undefined>(undefined)
  readonly state = derivedStateFlow(
    [this.#state.asStateFlow()] as const,
    (cached): CachedUsers | undefined =>
      cached
        ? Object.freeze({
            users: Object.freeze(cached.users.map(mapUserDtoToDomain)),
            savedAt: cached.savedAt
          })
        : undefined
  )

  constructor(private readonly storage: ShowcaseDatabase) {
    super()
  }

  async load(maxAgeMs: number): Promise<LocalUserResult<void>> {
    try {
      const database = await this.storage.get()
      const raw: unknown = await database.get(USERS_STORE, USERS_KEY)
      if (raw === undefined) return ok()
      const cached = parseCachedUsers(raw)
      if (Date.now() - cached.savedAt > maxAgeMs) {
        await database.delete(USERS_STORE, USERS_KEY)
        this.#state.set(undefined)
        return ok()
      }
      this.#state.set(cached)
      return ok()
    } catch {
      this.#state.set(undefined)
      return err({ code: 'storage-unavailable' })
    }
  }

  async save(users: readonly User[]): Promise<LocalUserResult<void>> {
    try {
      const cached: CachedUsersDto = Object.freeze({
        users: Object.freeze(users.map(mapUserDomainToDto)),
        savedAt: Date.now()
      })
      await (await this.storage.get()).put(USERS_STORE, cached, USERS_KEY)
      this.#state.set(cached)
      return ok()
    } catch {
      return err({ code: 'storage-unavailable' })
    }
  }
}

function parseCachedUsers(value: unknown): CachedUsersDto {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('users' in value) ||
    !('savedAt' in value) ||
    typeof value.savedAt !== 'number'
  ) {
    throw new TypeError('Invalid cached users')
  }
  return Object.freeze({ users: parseUsersDto(value.users), savedAt: value.savedAt })
}
