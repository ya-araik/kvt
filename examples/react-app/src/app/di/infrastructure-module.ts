import { defineModule, provide } from '@kvt/core'
import { JsonServerHttpClient } from '../../data/http/json-server-http-client.js'
import { Connectivity } from '../../domain/repository/connectivity.js'
import { appConfigToken, type AppConfig } from './app-config.js'

const appConfig: AppConfig = Object.freeze({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api'
})

export const infrastructureModule = defineModule({
  id: 'infrastructure',
  version: '1.0.0',
  requires: [{ id: 'browser-data', version: '^1.0.0' }],
  providers: [
    provide(appConfigToken).value(appConfig),
    provide(JsonServerHttpClient)
      .inject(appConfigToken, Connectivity)
      .using((config, connectivity) => new JsonServerHttpClient(config.apiBaseUrl, connectivity))
      .singleton()
  ]
})
