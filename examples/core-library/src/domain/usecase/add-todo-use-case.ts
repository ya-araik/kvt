import { err, type Result, type UseCase, type UseCaseContext } from '@kvt/core'
import type { AddTodoFailure } from '../model/failure/todo-use-case-failures.js'
import { TodoRepository } from '../repository/todo-repository.js'

export interface AddTodoInput {
  readonly title: string
}

export class AddTodoUseCase implements UseCase<
  AddTodoInput,
  Promise<Result<void, AddTodoFailure>>
> {
  constructor(private readonly repository: TodoRepository) {}

  async execute(
    input: AddTodoInput,
    context: UseCaseContext
  ): Promise<Result<void, AddTodoFailure>> {
    const title = input.title.trim()
    if (title.length === 0) return err({ code: 'empty-title' })
    if (title.length > 200) return err({ code: 'title-too-long', maxLength: 200 })
    const result = await this.repository.add(title, context.signal)
    if (result.ok) return result
    return err({ code: 'storage-unavailable' })
  }
}
