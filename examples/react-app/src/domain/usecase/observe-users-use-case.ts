import { callbackFlow, type Flow } from '@kvt/flow'
import type { UserRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import type { UsersState } from '../model/user.js'
import { Connectivity } from '../repository/connectivity.js'
import { LocalUserRepository } from '../repository/local-user-repository.js'
import { NetworkUserRepository } from '../repository/network-user-repository.js'

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000

export class ObserveUsersUseCase {
  constructor(
    private readonly network: NetworkUserRepository,
    private readonly local: LocalUserRepository,
    private readonly connectivity: Connectivity
  ) {}

  execute(): Flow<UsersState> {
    return callbackFlow((emitter, signal) => {
      let cached = this.local.state.value
      let fetching = false
      let fresh = false
      let failure: UserRepositoryFailure | undefined
      const emit = () =>
        emitter.emit({
          status: failure ? 'failure' : cached ? 'ready' : 'loading',
          users: cached?.users ?? [],
          fetching,
          stale: !fresh,
          ...(failure === undefined ? {} : { error: failure })
        })

      const localSubscription = this.local.state.subscribe((users) => {
        cached = users
        return emit()
      })
      void (async () => {
        const loaded = await this.local.load(MAX_CACHE_AGE_MS)
        if (!loaded.ok) failure = loaded.error
        if (this.connectivity.state.value === 'online') {
          fetching = true
          await emit()
          const result = await this.network.list(signal)
          fetching = false
          if (result.ok) {
            fresh = true
            failure = undefined
            cached = Object.freeze({ users: result.value, savedAt: Date.now() })
            const saved = await this.local.save(result.value)
            if (!saved.ok) failure = saved.error
          } else {
            failure = result.error
          }
        }
        await emit()
      })()

      return () => localSubscription.cancel()
    })
  }
}
