import { MutableStateFlow } from '@kvt/flow'
import type { ConnectionStatus } from '../../domain/model/connection.js'
import { Connectivity } from '../../domain/repository/connectivity.js'

export class BrowserConnectivity extends Connectivity {
  readonly #state = new MutableStateFlow<ConnectionStatus>('online')
  readonly state = this.#state.asStateFlow()

  constructor() {
    super()
  }

  setBrowserOnline(online: boolean): void {
    this.#state.set(online ? 'online' : 'offline')
  }

  setReachable(): void {
    this.#state.set('online')
  }

  setUnreachable(): void {
    if (this.#state.value !== 'offline') this.#state.set('unreachable')
  }
}
