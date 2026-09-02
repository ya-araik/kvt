import { createToken } from '@kvt/core'

export interface AppConfig {
  readonly apiBaseUrl: string
}

export const appConfigToken = createToken<AppConfig>('todo-showcase.app-config')
