import { err, ok, type Result, type UseCase, type UseCaseContext } from '@kvt/core'
import type { AddTodoFailure } from '../model/failure/todo-use-case-failures.js'
import type { Todo } from '../model/todo.js'
import { Connectivity } from '../repository/connectivity.js'
import { LocalTodoRepository } from '../repository/local-todo-repository.js'
import { NetworkTodoRepository } from '../repository/network-todo-repository.js'

export interface AddTodoInput {
  readonly title: string
  readonly userId: string
}

export class AddTodoUseCase implements UseCase<
  AddTodoInput,
  Promise<Result<Todo, AddTodoFailure>>
> {
  constructor(
    private readonly network: NetworkTodoRepository,
    private readonly local: LocalTodoRepository,
    private readonly connectivity: Connectivity
  ) {}

  async execute(
    input: AddTodoInput,
    context: UseCaseContext
  ): Promise<Result<Todo, AddTodoFailure>> {
    const title = input.title.trim()
    if (title.length === 0) return err({ code: 'empty-title' })
    if (title.length > 200) return err({ code: 'title-too-long', maxLength: 200 })

    const optimistic: Todo = Object.freeze({
      id: `local:${crypto.randomUUID()}`,
      userId: input.userId,
      title,
      completed: false
    })
    const cached = await this.local.create(optimistic)
    if (!cached.ok) return cached

    if (this.connectivity.state.value !== 'online') return this.#queue(optimistic)

    const remote = await this.network.create(
      { userId: optimistic.userId, title: optimistic.title, completed: false },
      context.signal
    )
    if (remote.ok) {
      const replaced = await this.local.replaceId(optimistic.id, remote.value)
      return replaced.ok ? ok(remote.value) : replaced
    }
    if (remote.error.code === 'network-unavailable') return this.#queue(optimistic)

    await this.local.remove(optimistic.id)
    return remote
  }

  async #queue(optimistic: Todo): Promise<Result<Todo, AddTodoFailure>> {
    const queued = await this.local.enqueue({
      operationId: crypto.randomUUID(),
      kind: 'create',
      todo: optimistic,
      createdAt: Date.now()
    })
    if (!queued.ok) {
      await this.local.remove(optimistic.id)
      return queued
    }
    return ok(optimistic)
  }
}
