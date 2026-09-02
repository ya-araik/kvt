import { defineModule } from '@kvt/core'
import { infrastructureModule } from './infrastructure-module.js'
import { todoModule } from './todo-module.js'

export const appModule = defineModule({
  id: 'todo-showcase',
  version: '1.0.0',
  includes: [infrastructureModule, todoModule]
})
