import { bind, defineModule } from '@kvt/core'
import { JsonServerHttpClient } from '../../data/http/json-server-http-client.js'
import { HttpTodoRepository } from '../../data/repository/http-todo-repository.js'
import { HttpUserRepository } from '../../data/repository/http-user-repository.js'
import { Connectivity } from '../../domain/repository/connectivity.js'
import { LocalTodoRepository } from '../../domain/repository/local-todo-repository.js'
import { LocalUserRepository } from '../../domain/repository/local-user-repository.js'
import { NetworkTodoRepository } from '../../domain/repository/network-todo-repository.js'
import { NetworkUserRepository } from '../../domain/repository/network-user-repository.js'
import { AddTodoUseCase } from '../../domain/usecase/add-todo-use-case.js'
import { ObserveTodosUseCase } from '../../domain/usecase/observe-todos-use-case.js'
import { ObserveUsersUseCase } from '../../domain/usecase/observe-users-use-case.js'
import { RefreshTodosUseCase } from '../../domain/usecase/refresh-todos-use-case.js'
import { RemoveTodoUseCase } from '../../domain/usecase/remove-todo-use-case.js'
import { SyncPendingTodosUseCase } from '../../domain/usecase/sync-pending-todos-use-case.js'
import { ToggleTodoUseCase } from '../../domain/usecase/toggle-todo-use-case.js'
import { UpdateTodoUseCase } from '../../domain/usecase/update-todo-use-case.js'
import { TodoListViewModel } from '../../presentation/viewmodel/todo-list-view-model.js'

export const todoModule = defineModule({
  id: 'todo',
  version: '1.0.0',
  requires: [{ id: 'infrastructure', version: '^1.0.0' }],
  providers: [
    bind(NetworkTodoRepository).to(HttpTodoRepository).inject(JsonServerHttpClient).singleton(),
    bind(NetworkUserRepository).to(HttpUserRepository).inject(JsonServerHttpClient).singleton(),
    bind(ObserveTodosUseCase)
      .inject(NetworkTodoRepository, LocalTodoRepository, Connectivity)
      .singleton(),
    bind(ObserveUsersUseCase)
      .inject(NetworkUserRepository, LocalUserRepository, Connectivity)
      .singleton(),
    bind(AddTodoUseCase).inject(NetworkTodoRepository, LocalTodoRepository, Connectivity),
    bind(UpdateTodoUseCase).inject(NetworkTodoRepository, LocalTodoRepository, Connectivity),
    bind(ToggleTodoUseCase).inject(NetworkTodoRepository, LocalTodoRepository, Connectivity),
    bind(RemoveTodoUseCase).inject(NetworkTodoRepository, LocalTodoRepository, Connectivity),
    bind(RefreshTodosUseCase).inject(ObserveTodosUseCase),
    bind(SyncPendingTodosUseCase)
      .inject(NetworkTodoRepository, LocalTodoRepository, Connectivity, ObserveTodosUseCase)
      .singleton(),
    bind(TodoListViewModel)
      .inject(
        ObserveTodosUseCase,
        ObserveUsersUseCase,
        AddTodoUseCase,
        UpdateTodoUseCase,
        ToggleTodoUseCase,
        RemoveTodoUseCase,
        RefreshTodosUseCase
      )
      .viewModel()
  ]
})
