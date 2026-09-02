import { bind, defineModule, definePlugin } from '@kvt/core'
import { BrowserConnectivity } from '../../data/browser/browser-connectivity.js'
import { ShowcaseDatabase } from '../../data/local/showcase-database.js'
import { IndexedDbLocalTodoRepository } from '../../data/repository/indexed-db-local-todo-repository.js'
import { IndexedDbLocalUserRepository } from '../../data/repository/indexed-db-local-user-repository.js'
import { Connectivity } from '../../domain/repository/connectivity.js'
import { LocalTodoRepository } from '../../domain/repository/local-todo-repository.js'
import { LocalUserRepository } from '../../domain/repository/local-user-repository.js'
import { ObserveTodosUseCase } from '../../domain/usecase/observe-todos-use-case.js'
import { SyncPendingTodosUseCase } from '../../domain/usecase/sync-pending-todos-use-case.js'

export const browserDataModule = defineModule({
  id: 'browser-data',
  version: '1.0.0',
  providers: [
    bind(Connectivity).to(BrowserConnectivity).singleton(),
    bind(ShowcaseDatabase).singleton(),
    bind(LocalTodoRepository).to(IndexedDbLocalTodoRepository).inject(ShowcaseDatabase).singleton(),
    bind(LocalUserRepository).to(IndexedDbLocalUserRepository).inject(ShowcaseDatabase).singleton()
  ]
})

let stopListeners: (() => void) | undefined
let activeController: AbortController | undefined

export const browserDataPlugin = definePlugin({
  id: 'browser-data',
  version: '1.0.0',
  modules: [browserDataModule],
  start({ scope, emitDiagnostic }) {
    const connectivity = scope.resolve(Connectivity)
    const syncPending = scope.resolve(SyncPendingTodosUseCase)
    const observeTodos = scope.resolve(ObserveTodosUseCase)
    const controller = new AbortController()
    activeController = controller

    const synchronize = async () => {
      if (connectivity.state.value !== 'online' || controller.signal.aborted) return
      const result = await syncPending.execute({ signal: controller.signal })
      emitDiagnostic({
        subsystem: 'plugin',
        operation: 'todo-outbox',
        phase: result.ok ? 'state' : 'failure',
        context: result.ok ? { synchronized: result.value } : { failure: result.error.code }
      })
    }
    const updateOnline = () => {
      connectivity.setBrowserOnline(navigator.onLine)
      if (navigator.onLine) void synchronize()
    }
    const refreshOnFocus = () => {
      if (document.visibilityState === 'hidden' || connectivity.state.value !== 'online') return
      void synchronize()
      void observeTodos.refreshActive(controller.signal)
    }

    updateOnline()
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)
    stopListeners = () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  },
  shutdown() {
    stopListeners?.()
    stopListeners = undefined
    activeController?.abort('runtime-shutdown')
    activeController = undefined
  }
})
