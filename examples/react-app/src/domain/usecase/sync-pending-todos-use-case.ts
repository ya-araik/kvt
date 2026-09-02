import { ok, type NoInputUseCase, type Result, type UseCaseContext } from '@kvt/core'
import type { TodoRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import type { PendingTodoMutation } from '../model/todo.js'
import { Connectivity } from '../repository/connectivity.js'
import { LocalTodoRepository } from '../repository/local-todo-repository.js'
import { NetworkTodoRepository } from '../repository/network-todo-repository.js'
import { ObserveTodosUseCase } from './observe-todos-use-case.js'

export class SyncPendingTodosUseCase implements NoInputUseCase<
  Promise<Result<number, TodoRepositoryFailure>>
> {
  #running: Promise<Result<number, TodoRepositoryFailure>> | undefined

  constructor(
    private readonly network: NetworkTodoRepository,
    private readonly local: LocalTodoRepository,
    private readonly connectivity: Connectivity,
    private readonly observeTodos: ObserveTodosUseCase
  ) {}

  execute(context: UseCaseContext): Promise<Result<number, TodoRepositoryFailure>> {
    this.#running ??= this.#synchronizeAll(context).finally(() => {
      this.#running = undefined
    })
    return this.#running
  }

  async #synchronizeAll(context: UseCaseContext): Promise<Result<number, TodoRepositoryFailure>> {
    if (this.connectivity.state.value !== 'online') return ok(0)
    const pending = await this.local.pending()
    if (!pending.ok) return pending

    let synchronized = 0
    for (const mutation of pending.value) {
      const result = await this.#synchronize(mutation, context.signal)
      if (!result.ok) return result
      const removed = await this.local.removePending(mutation.operationId)
      if (!removed.ok) return removed
      synchronized += 1
    }
    if (synchronized > 0) await this.observeTodos.refreshActive(context.signal)
    return ok(synchronized)
  }

  async #synchronize(
    mutation: PendingTodoMutation,
    signal: AbortSignal
  ): Promise<Result<void, TodoRepositoryFailure>> {
    if (mutation.kind === 'create') {
      const created = await this.network.create(
        {
          userId: mutation.todo.userId,
          title: mutation.todo.title,
          completed: mutation.todo.completed
        },
        signal
      )
      if (!created.ok) return created
      return this.local.replaceId(mutation.todo.id, created.value)
    }
    if (mutation.kind === 'update') {
      const updated = await this.network.update(mutation.todoId, mutation.patch, signal)
      if (!updated.ok) return updated
      return this.local.update(updated.value)
    }
    const removed = await this.network.remove(mutation.todoId, signal)
    return removed.ok || removed.error.code === 'todo-not-found' ? ok() : removed
  }
}
