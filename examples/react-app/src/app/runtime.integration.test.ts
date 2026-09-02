import { bind, ok, type Result } from '@kvt/core'
import { assertRuntimeReleased, TestRuntimeBuilder } from '@kvt/testing'
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { ShowcaseDatabase } from '../data/local/showcase-database.js'
import { IndexedDbLocalTodoRepository } from '../data/repository/indexed-db-local-todo-repository.js'
import type { TodoRepositoryFailure } from '../domain/model/failure/todo-repository-failure.js'
import type {
  CreateTodoData,
  Todo,
  TodoCriteria,
  TodoPage,
  UpdateTodoData
} from '../domain/model/todo.js'
import { NetworkTodoRepository } from '../domain/repository/network-todo-repository.js'
import { AddTodoUseCase } from '../domain/usecase/add-todo-use-case.js'
import { TodoListViewModel } from '../presentation/viewmodel/todo-list-view-model.js'
import { appModule } from './di/app-module.js'
import { browserDataPlugin } from './di/browser-data-plugin.js'

const shutdownContext = {
  signal: new AbortController().signal,
  reason: 'test',
  deadline: undefined
} as const

describe('application runtime integration', () => {
  it('restores the local source before network and releases plugin resources', async () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const database = new ShowcaseDatabase()
    await database.clear()
    const local = new IndexedDbLocalTodoRepository(database)
    await local.savePage(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      pageDto('Из IndexedDB')
    )
    await database.shutdown(shutdownContext)

    const runtime = await new TestRuntimeBuilder()
      .module(appModule)
      .plugin(browserDataPlugin)
      .build()
    expect(runtime.inspect().plugins.every((plugin) => plugin.started)).toBe(true)
    const lease = runtime.rootViewModelOwner.acquire(TodoListViewModel)
    await lease.commit()
    await vi.waitFor(() => expect(lease.value.state.value.todos[0]?.title).toBe('Из IndexedDB'))
    expect(addListener).toHaveBeenCalledWith('online', expect.any(Function))
    expect(addListener).toHaveBeenCalledWith('focus', expect.any(Function))

    await runtime.shutdown({ reason: 'integration-test' })
    expect(removeListener).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith('focus', expect.any(Function))
    assertRuntimeReleased(runtime)
  })

  it('supports a single-source network repository override', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const database = new ShowcaseDatabase()
    await database.clear()
    await database.shutdown(shutdownContext)
    const runtime = await new TestRuntimeBuilder()
      .module(appModule)
      .plugin(browserDataPlugin)
      .override(bind(NetworkTodoRepository).to(OverrideNetworkTodoRepository).singleton())
      .build()

    const result = await runtime
      .resolve(AddTodoUseCase)
      .execute({ title: 'override', userId: '1' }, { signal: new AbortController().signal })
    expect(result).toEqual(ok({ id: 'override', userId: '1', title: 'override', completed: false }))
    await runtime.shutdown({ reason: 'override-test' })
    assertRuntimeReleased(runtime)
  })
})

class OverrideNetworkTodoRepository extends NetworkTodoRepository {
  list(
    _criteria: TodoCriteria,
    _signal: AbortSignal
  ): Promise<Result<TodoPage, TodoRepositoryFailure>> {
    return Promise.resolve(ok(pageDto('override')))
  }

  create(
    input: CreateTodoData,
    _signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>> {
    return Promise.resolve(ok({ id: 'override', ...input }))
  }

  update(
    id: string,
    patch: UpdateTodoData,
    _signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>> {
    return Promise.resolve(
      ok({ id, userId: patch.userId ?? '1', title: patch.title ?? 'override', completed: false })
    )
  }

  remove(_id: string, _signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>> {
    return Promise.resolve(ok())
  }
}

function pageDto(title: string): TodoPage {
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
