import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TodoCriteria, TodoPage } from '../../domain/model/todo.js'
import { mapTodoCriteriaToDto } from '../mapper/todo-mapper.js'
import {
  IndexedDbLocalTodoRepository,
  todoQueryKey
} from '../repository/indexed-db-local-todo-repository.js'
import { ShowcaseDatabase, TODO_PAGES_STORE } from './showcase-database.js'

const criteria: TodoCriteria = {
  page: 1,
  pageSize: 20,
  search: '',
  status: 'all'
}

let database: ShowcaseDatabase
let repository: IndexedDbLocalTodoRepository

beforeEach(async () => {
  database = new ShowcaseDatabase()
  await database.clear()
  repository = new IndexedDbLocalTodoRepository(database)
})

describe('IndexedDB local repository', () => {
  it('uses stable normalized keys for local pages', () => {
    const normalized = mapTodoCriteriaToDto({
      page: 1,
      pageSize: 20,
      search: '  release  ',
      status: 'active'
    })
    expect(todoQueryKey(normalized)).toBe(
      todoQueryKey({ page: 1, pageSize: 20, search: 'release', status: 'active' })
    )
    expect(todoQueryKey(normalized)).not.toBe(
      todoQueryKey({ page: 1, pageSize: 20, search: 'release', status: 'completed' })
    )
  })

  it('saves DTO pages and restores them into the observable local source', async () => {
    await repository.savePage(criteria, page('cached'))
    const restored = new IndexedDbLocalTodoRepository(database)
    await expect(restored.load(criteria, 1_000)).resolves.toEqual({ ok: true, value: undefined })
    expect(restored.observe(criteria).value?.page.todos[0]?.title).toBe('cached')
  })

  it('rejects corrupt local data without leaking it into domain', async () => {
    const query = mapTodoCriteriaToDto(criteria)
    await (await database.get()).put(TODO_PAGES_STORE, { broken: true }, todoQueryKey(query))
    await expect(repository.load(criteria, 1_000)).resolves.toEqual({
      ok: false,
      error: { code: 'storage-unavailable' }
    })
    expect(repository.observe(criteria).value).toBeUndefined()
  })

  it('persists an offline outbox in operation order', async () => {
    await repository.enqueue({
      operationId: 'second',
      kind: 'delete',
      todoId: '1',
      createdAt: 2
    })
    await repository.enqueue({
      operationId: 'first',
      kind: 'update',
      todoId: '1',
      patch: { title: 'offline' },
      createdAt: 1
    })
    const pending = await repository.pending()
    expect(pending.ok && pending.value.map((operation) => operation.operationId)).toEqual([
      'first',
      'second'
    ])
  })
})

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
