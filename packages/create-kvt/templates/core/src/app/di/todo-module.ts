import { bind, defineModule } from '@kvt/core'
import { AddTodoUseCase } from '../../domain/usecase/add-todo-use-case.js'
import { ObserveTodosUseCase } from '../../domain/usecase/observe-todos-use-case.js'
import { RemoveTodoUseCase } from '../../domain/usecase/remove-todo-use-case.js'
import { ToggleTodoUseCase } from '../../domain/usecase/toggle-todo-use-case.js'
import { MemoryTodoRepository } from '../../data/repository/memory-todo-repository.js'
import { TodoRepository } from '../../domain/repository/todo-repository.js'

export const todoModule = defineModule({
  id: 'todo',
  version: '1.0.0',
  providers: [
    bind(TodoRepository).to(MemoryTodoRepository).singleton(),
    bind(ObserveTodosUseCase).inject(TodoRepository),
    bind(AddTodoUseCase).inject(TodoRepository),
    bind(ToggleTodoUseCase).inject(TodoRepository),
    bind(RemoveTodoUseCase).inject(TodoRepository)
  ]
})
