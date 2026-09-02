import type { StateFlow } from '@kvt/flow'
import type { ConnectionStatus } from '../model/connection.js'

export abstract class Connectivity {
  abstract readonly state: StateFlow<ConnectionStatus>
  abstract setBrowserOnline(online: boolean): void
  abstract setReachable(): void
  abstract setUnreachable(): void
}
