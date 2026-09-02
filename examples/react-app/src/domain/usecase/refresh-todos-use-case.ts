import type { NoInputUseCase, Result, UseCaseContext } from '@kvt/core'
import type { TodoRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import { ObserveTodosUseCase } from './observe-todos-use-case.js'

export class RefreshTodosUseCase implements NoInputUseCase<
  Promise<Result<void, TodoRepositoryFailure>>
> {
  constructor(private readonly observeTodos: ObserveTodosUseCase) {}

  execute(context: UseCaseContext): Promise<Result<void, TodoRepositoryFailure>> {
    return this.observeTodos.refreshActive(context.signal)
  }
}
