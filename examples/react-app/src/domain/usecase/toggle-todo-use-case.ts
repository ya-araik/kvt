import { err, ok, type Result, type UseCase, type UseCaseContext } from '@kvt/core'
import type { ChangeTodoFailure } from '../model/failure/todo-use-case-failures.js'
import type { Todo } from '../model/todo.js'
import { Connectivity } from '../repository/connectivity.js'
import { LocalTodoRepository } from '../repository/local-todo-repository.js'
import { NetworkTodoRepository } from '../repository/network-todo-repository.js'

export interface ToggleTodoInput {
  readonly id: string
  readonly completed: boolean
}

export class ToggleTodoUseCase implements UseCase<
  ToggleTodoInput,
  Promise<Result<Todo, ChangeTodoFailure>>
> {
  constructor(
    private readonly network: NetworkTodoRepository,
    private readonly local: LocalTodoRepository,
    private readonly connectivity: Connectivity
  ) {}

  async execute(
    input: ToggleTodoInput,
    context: UseCaseContext
  ): Promise<Result<Todo, ChangeTodoFailure>> {
    const found = await this.local.find(input.id)
    if (!found.ok) return found
    if (!found.value) return err({ code: 'todo-not-found', id: input.id })
    const patch = Object.freeze({ completed: !input.completed })
    const optimistic = Object.freeze({ ...found.value, ...patch })
    const cached = await this.local.update(optimistic)
    if (!cached.ok) return cached

    if (this.connectivity.state.value !== 'online')
      return this.#queue(input.id, patch, optimistic, found.value)

    const remote = await this.network.update(input.id, patch, context.signal)
    if (remote.ok) {
      const saved = await this.local.update(remote.value)
      return saved.ok ? ok(remote.value) : saved
    }
    if (remote.error.code === 'network-unavailable')
      return this.#queue(input.id, patch, optimistic, found.value)
    await this.local.update(found.value)
    return remote
  }

  async #queue(
    id: string,
    patch: { readonly completed: boolean },
    optimistic: Todo,
    previous: Todo
  ): Promise<Result<Todo, ChangeTodoFailure>> {
    const queued = await this.local.enqueue({
      operationId: crypto.randomUUID(),
      kind: 'update',
      todoId: id,
      patch,
      createdAt: Date.now()
    })
    if (!queued.ok) {
      await this.local.update(previous)
      return queued
    }
    return ok(optimistic)
  }
}
