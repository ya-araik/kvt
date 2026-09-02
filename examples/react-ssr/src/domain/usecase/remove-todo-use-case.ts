import type { Result, UseCase, UseCaseContext } from '@kvt/core'
import type { ChangeTodoFailure } from '../model/failure/todo-use-case-failures.js'
import { TodoRepository } from '../repository/todo-repository.js'

export class RemoveTodoUseCase implements UseCase<
  string,
  Promise<Result<void, ChangeTodoFailure>>
> {
  constructor(private readonly repository: TodoRepository) {}

  execute(id: string, context: UseCaseContext): Promise<Result<void, ChangeTodoFailure>> {
    return this.repository.remove(id, context.signal)
  }
}
