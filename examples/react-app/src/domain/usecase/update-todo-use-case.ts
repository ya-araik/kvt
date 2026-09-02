import { err, ok, type Result, type UseCase, type UseCaseContext } from '@kvt/core'
import type { UpdateTodoFailure } from '../model/failure/todo-use-case-failures.js'
import type { Todo, UpdateTodoData } from '../model/todo.js'
import { Connectivity } from '../repository/connectivity.js'
import { LocalTodoRepository } from '../repository/local-todo-repository.js'
import { NetworkTodoRepository } from '../repository/network-todo-repository.js'

export interface UpdateTodoInput {
  readonly id: string
  readonly title: string
}

export class UpdateTodoUseCase implements UseCase<
  UpdateTodoInput,
  Promise<Result<Todo, UpdateTodoFailure>>
> {
  constructor(
    private readonly network: NetworkTodoRepository,
    private readonly local: LocalTodoRepository,
    private readonly connectivity: Connectivity
  ) {}

  async execute(
    input: UpdateTodoInput,
    context: UseCaseContext
  ): Promise<Result<Todo, UpdateTodoFailure>> {
    const title = input.title.trim()
    if (title.length === 0) return err({ code: 'empty-title' })
    if (title.length > 200) return err({ code: 'title-too-long', maxLength: 200 })
    return this.#update(input.id, { title }, context.signal)
  }

  async #update(
    id: string,
    patch: UpdateTodoData,
    signal: AbortSignal
  ): Promise<Result<Todo, UpdateTodoFailure>> {
    const found = await this.local.find(id)
    if (!found.ok) return found
    if (!found.value) return err({ code: 'todo-not-found', id })
    const optimistic = Object.freeze({ ...found.value, ...patch })
    const cached = await this.local.update(optimistic)
    if (!cached.ok) return cached

    if (this.connectivity.state.value !== 'online')
      return this.#queue(id, patch, optimistic, found.value)

    const remote = await this.network.update(id, patch, signal)
    if (remote.ok) {
      const saved = await this.local.update(remote.value)
      return saved.ok ? ok(remote.value) : saved
    }
    if (remote.error.code === 'network-unavailable')
      return this.#queue(id, patch, optimistic, found.value)

    await this.local.update(found.value)
    return remote
  }

  async #queue(
    id: string,
    patch: UpdateTodoData,
    domain: Todo,
    previous: Todo
  ): Promise<Result<Todo, UpdateTodoFailure>> {
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
    return ok(domain)
  }
}
