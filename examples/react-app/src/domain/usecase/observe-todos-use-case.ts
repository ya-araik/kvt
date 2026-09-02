import { err, ok, type Result } from '@kvt/core'
import { callbackFlow, type Flow } from '@kvt/flow'
import type { TodoRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import type { TodoCriteria, TodoFeedState } from '../model/todo.js'
import { Connectivity } from '../repository/connectivity.js'
import { LocalTodoRepository } from '../repository/local-todo-repository.js'
import { NetworkTodoRepository } from '../repository/network-todo-repository.js'

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000

type ActiveRefresh = (signal: AbortSignal) => Promise<Result<void, TodoRepositoryFailure>>

export class ObserveTodosUseCase {
  readonly #activeRefreshes = new Set<ActiveRefresh>()

  constructor(
    private readonly network: NetworkTodoRepository,
    private readonly local: LocalTodoRepository,
    private readonly connectivity: Connectivity
  ) {}

  execute(criteria: TodoCriteria): Flow<TodoFeedState> {
    return callbackFlow((emitter, signal) => {
      const localState = this.local.observe(criteria)
      let cached = localState.value
      let fetching = false
      let fresh = false
      let failure: TodoRepositoryFailure | undefined

      const emit = () =>
        emitter.emit({
          status: failure ? 'failure' : cached ? 'ready' : 'loading',
          page: cached?.page,
          fetching,
          stale: !fresh || this.connectivity.state.value !== 'online',
          connection: this.connectivity.state.value,
          ...(failure === undefined ? {} : { error: failure })
        })

      const refresh: ActiveRefresh = async (refreshSignal) => {
        if (this.connectivity.state.value !== 'online') {
          fresh = false
          await emit()
          return err({ code: 'network-unavailable' })
        }
        fetching = true
        failure = undefined
        await emit()
        const result = await retryNetwork(
          () => this.network.list(criteria, refreshSignal),
          refreshSignal
        )
        fetching = false
        if (!result.ok) {
          fresh = false
          failure = result.error
          await emit()
          return result
        }

        fresh = true
        cached = Object.freeze({ criteria, page: result.value, savedAt: Date.now() })
        const saved = await this.local.savePage(criteria, result.value)
        if (!saved.ok) failure = saved.error
        await emit()
        return saved
      }

      const pageSubscription = localState.subscribe((page) => {
        cached = page
        return emit()
      })
      const connectionSubscription = this.connectivity.state.subscribe(() => emit())
      this.#activeRefreshes.add(refresh)

      void (async () => {
        const loaded = await this.local.load(criteria, MAX_CACHE_AGE_MS)
        if (!loaded.ok) {
          failure = loaded.error
          await emit()
        }
        if (!signal.aborted && this.connectivity.state.value === 'online') await refresh(signal)
        else await emit()
      })()

      return async () => {
        this.#activeRefreshes.delete(refresh)
        await Promise.all([pageSubscription.cancel(), connectionSubscription.cancel()])
      }
    })
  }

  async refreshActive(signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>> {
    const results = await Promise.all([...this.#activeRefreshes].map((refresh) => refresh(signal)))
    return results.find((result) => !result.ok) ?? ok()
  }
}

async function retryNetwork<T>(
  request: () => Promise<Result<T, TodoRepositoryFailure>>,
  signal: AbortSignal
): Promise<Result<T, TodoRepositoryFailure>> {
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    signal.throwIfAborted()
    const result = await request()
    if (result.ok || result.error.code !== 'network-unavailable' || attempt === 2) return result
    await delay(300 * 2 ** attempt, signal)
  }
  return err({ code: 'network-unavailable' })
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      reject(signal.reason)
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
