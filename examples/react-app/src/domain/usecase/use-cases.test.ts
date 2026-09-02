import { err, ok, type Result } from '@kvt/core'
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserConnectivity } from '../../data/browser/browser-connectivity.js'
import { ShowcaseDatabase } from '../../data/local/showcase-database.js'
import { IndexedDbLocalTodoRepository } from '../../data/repository/indexed-db-local-todo-repository.js'
import type { TodoRepositoryFailure } from '../model/failure/todo-repository-failure.js'
import type { CreateTodoData, Todo, TodoCriteria, TodoPage, UpdateTodoData } from '../model/todo.js'
import { NetworkTodoRepository } from '../repository/network-todo-repository.js'
import { AddTodoUseCase } from './add-todo-use-case.js'
import { ObserveTodosUseCase } from './observe-todos-use-case.js'
import { RefreshTodosUseCase } from './refresh-todos-use-case.js'
import { SyncPendingTodosUseCase } from './sync-pending-todos-use-case.js'
import { UpdateTodoUseCase } from './update-todo-use-case.js'

const criteria: TodoCriteria = { page: 1, pageSize: 20, search: '', status: 'all' }
const context = { signal: new AbortController().signal }

let database: ShowcaseDatabase
let local: IndexedDbLocalTodoRepository
let network: FakeNetworkTodoRepository
let connectivity: BrowserConnectivity

beforeEach(async () => {
  database = new ShowcaseDatabase()
  await database.clear()
  local = new IndexedDbLocalTodoRepository(database)
  network = new FakeNetworkTodoRepository()
  connectivity = new BrowserConnectivity()
})

describe('Todo use cases orchestrate data sources', () => {
  it('emits local DTO cache first, then maps the fresh network DTO to domain', async () => {
    await local.savePage(criteria, page('Из IndexedDB'))
    network.page = page('С сервера')
    const observe = new ObserveTodosUseCase(network, local, connectivity)
    const titles: string[] = []
    const subscription = observe
      .execute({ page: 1, pageSize: 20, search: '', status: 'all' })
      .subscribe((state) => {
        const title = state.page?.todos[0]?.title
        if (title && titles.at(-1) !== title) titles.push(title)
      })

    await vi.waitFor(() => expect(titles).toEqual(['Из IndexedDB', 'С сервера']))
    await subscription.cancel()
  })

  it('validates input before touching either repository', async () => {
    const add = new AddTodoUseCase(network, local, connectivity)
    const update = new UpdateTodoUseCase(network, local, connectivity)
    await expect(add.execute({ title: '   ', userId: '1' }, context)).resolves.toEqual(
      err({ code: 'empty-title' })
    )
    await expect(update.execute({ id: '1', title: 'x'.repeat(201) }, context)).resolves.toEqual(
      err({ code: 'title-too-long', maxLength: 200 })
    )
    expect(network.calls).toBe(0)
  })

  it('saves offline changes locally and synchronizes the outbox when online returns', async () => {
    await local.savePage(criteria, page('Исходная задача'))
    connectivity.setBrowserOnline(false)
    const observe = new ObserveTodosUseCase(network, local, connectivity)
    const add = new AddTodoUseCase(network, local, connectivity)
    const created = await add.execute({ title: '  Offline задача  ', userId: '2' }, context)
    expect(created.ok && created.value.id.startsWith('local:')).toBe(true)
    const pendingBefore = await local.pending()
    expect(pendingBefore.ok && pendingBefore.value).toHaveLength(1)
    expect(local.observe(criteria).value?.page.todos[0]?.title).toBe('Offline задача')

    connectivity.setBrowserOnline(true)
    network.created = { id: '201', userId: '2', title: 'Offline задача', completed: false }
    const synchronized = await new SyncPendingTodosUseCase(
      network,
      local,
      connectivity,
      observe
    ).execute(context)
    expect(synchronized).toEqual(ok(1))
    const pendingAfter = await local.pending()
    expect(pendingAfter.ok && pendingAfter.value).toHaveLength(0)
    expect(local.observe(criteria).value?.page.todos[0]?.id).toBe('201')
  })

  it('keeps NoInputUseCase refresh explicit and cancellable', async () => {
    const observe = new ObserveTodosUseCase(network, local, connectivity)
    const subscription = observe
      .execute({ page: 1, pageSize: 20, search: '', status: 'all' })
      .subscribe(() => undefined)
    await vi.waitFor(() => expect(network.listCalls).toBe(1))
    await expect(new RefreshTodosUseCase(observe).execute(context)).resolves.toEqual(ok())
    expect(network.listCalls).toBe(2)
    await subscription.cancel()
  })
})

class FakeNetworkTodoRepository extends NetworkTodoRepository {
  page = page('С сервера')
  created: Todo = { id: 'created', userId: '1', title: 'Создано', completed: false }
  calls = 0
  listCalls = 0

  list(
    _criteria: TodoCriteria,
    _signal: AbortSignal
  ): Promise<Result<TodoPage, TodoRepositoryFailure>> {
    this.calls += 1
    this.listCalls += 1
    return Promise.resolve(ok(this.page))
  }

  create(
    _input: CreateTodoData,
    _signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>> {
    this.calls += 1
    return Promise.resolve(ok(this.created))
  }

  update(
    id: string,
    patch: UpdateTodoData,
    _signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>> {
    this.calls += 1
    return Promise.resolve(ok({ id, userId: '1', title: patch.title ?? 'Todo', completed: false }))
  }

  remove(_id: string, _signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>> {
    this.calls += 1
    return Promise.resolve(ok())
  }
}

function page(title: string): TodoPage {
  return {
    todos: [{ id: '1', userId: '1', title, completed: false }],
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false
  }
}
