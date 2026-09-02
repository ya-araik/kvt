import type { StateFlow } from '@kvt/flow'
import type { Todo } from '../model/todo.js'
import { TodoRepository } from '../repository/todo-repository.js'

export class ObserveTodosUseCase {
  constructor(private readonly repository: TodoRepository) {}

  execute(): StateFlow<readonly Todo[]> {
    return this.repository.todos
  }
}
