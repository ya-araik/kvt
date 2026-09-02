import { err, ok, type Result, type UseCase, type UseCaseContext } from '@kvt/core'
import type { ChangeTodoFailure } from '../model/failure/todo-use-case-failures.js'
import type { Todo } from '../model/todo.js'
import { Connectivity } from '../repository/connectivity.js'
import { LocalTodoRepository } from '../repository/local-todo-repository.js'
import { NetworkTodoRepository } from '../repository/network-todo-repository.js'

export class RemoveTodoUseCase implements UseCase<
  string,
  Promise<Result<void, ChangeTodoFailure>>
> {
  constructor(
    private readonly network: NetworkTodoRepository,
    private readonly local: LocalTodoRepository,
    private readonly connectivity: Connectivity
  ) {}

  async execute(id: string, context: UseCaseContext): Promise<Result<void, ChangeTodoFailure>> {
    const found = await this.local.find(id)
    if (!found.ok) return found
    if (!found.value) return err({ code: 'todo-not-found', id })
    const removed = await this.local.remove(id)
    if (!removed.ok) return removed

    if (this.connectivity.state.value !== 'online') return this.#queue(id, found.value)
    const remote = await this.network.remove(id, context.signal)
    if (remote.ok) return ok()
    if (remote.error.code === 'network-unavailable') return this.#queue(id, found.value)
    await this.local.update(found.value)
    return remote
  }

  async #queue(id: string, previous: Todo): Promise<Result<void, ChangeTodoFailure>> {
    const queued = await this.local.enqueue({
      operationId: crypto.randomUUID(),
      kind: 'delete',
      todoId: id,
      createdAt: Date.now()
    })
    if (!queued.ok) {
      await this.local.update(previous)
      return queued
    }
    return ok()
  }
}
