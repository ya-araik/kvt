import { bind, defineModule } from '@kvt/core'
import { ObserveTodosUseCase } from '../../domain/usecase/observe-todos-use-case.js'
import { ObserveUsersUseCase } from '../../domain/usecase/observe-users-use-case.js'
import { TodoInsightsViewModel } from './todo-insights-view-model.js'

export const insightsModule = defineModule({
  id: 'todo-insights',
  version: '1.0.0',
  requires: [{ id: 'todo', version: '^1.0.0' }],
  providers: [
    bind(TodoInsightsViewModel).inject(ObserveTodosUseCase, ObserveUsersUseCase).viewModel()
  ]
})
