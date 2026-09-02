import { err, ok } from '@kvt/core'
import { derivedStateFlow, MutableStateFlow } from '@kvt/flow'
import type {
  CachedTodoPage,
  PendingTodoMutation,
  Todo,
  TodoCriteria,
  TodoPage
} from '../../domain/model/todo.js'
import {
  LocalTodoRepository,
  type LocalTodoResult
} from '../../domain/repository/local-todo-repository.js'
import {
  parsePagedTodoDto,
  parseTodoDto,
  type CachedTodoPageDto,
  type PagedTodoDto,
  type PendingTodoMutationDto,
  type TodoDto,
  type TodoQueryDto
} from '../dto/todo-dto.js'
import {
  ShowcaseDatabase,
  TODO_OUTBOX_STORE,
  TODO_PAGES_STORE
} from '../local/showcase-database.js'
import {
  mapCachedTodoPageDtoToDomain,
  mapPendingTodoMutationDtoToDomain,
  mapPendingTodoMutationToDto,
  mapTodoCriteriaToDto,
  mapTodoDomainToDto,
  mapTodoDtoToDomain,
  mapTodoPageDomainToDto
} from '../mapper/todo-mapper.js'

export class IndexedDbLocalTodoRepository extends LocalTodoRepository {
  readonly #pages = new Map<string, MutableStateFlow<CachedTodoPageDto | undefined>>()

  constructor(private readonly storage: ShowcaseDatabase) {
    super()
  }

  observe(criteria: TodoCriteria) {
    const query = mapTodoCriteriaToDto(criteria)
    return derivedStateFlow(
      [this.#pageState(query).asStateFlow()] as const,
      (cached): CachedTodoPage | undefined =>
        cached ? mapCachedTodoPageDtoToDomain(cached) : undefined
    )
  }

  async load(criteria: TodoCriteria, maxAgeMs: number): Promise<LocalTodoResult<void>> {
    const query = mapTodoCriteriaToDto(criteria)
    const key = todoQueryKey(query)
    try {
      const database = await this.storage.get()
      const raw: unknown = await database.get(TODO_PAGES_STORE, key)
      if (raw === undefined) return ok()
      const cached = parseCachedPage(raw)
      if (Date.now() - cached.savedAt > maxAgeMs) {
        await database.delete(TODO_PAGES_STORE, key)
        this.#pageState(query).set(undefined)
        return ok()
      }
      this.#pageState(query).set(cached)
      return ok()
    } catch {
      this.#pageState(query).set(undefined)
      return err({ code: 'storage-unavailable' })
    }
  }

  async savePage(criteria: TodoCriteria, page: TodoPage): Promise<LocalTodoResult<void>> {
    const query = mapTodoCriteriaToDto(criteria)
    const cached: CachedTodoPageDto = Object.freeze({
      query,
      page: mapTodoPageDomainToDto(page),
      savedAt: Date.now()
    })
    try {
      await (await this.storage.get()).put(TODO_PAGES_STORE, cached, todoQueryKey(query))
      this.#pageState(query).set(cached)
      return ok()
    } catch {
      return err({ code: 'storage-unavailable' })
    }
  }

  async find(id: string): Promise<LocalTodoResult<Todo | undefined>> {
    try {
      const pages = [...(await this.#allPages())].sort(
        (left, right) => right.savedAt - left.savedAt
      )
      const dto = pages.flatMap((entry) => entry.page.data).find((todo) => todo.id === id)
      return ok(dto ? mapTodoDtoToDomain(dto) : undefined)
    } catch {
      return err({ code: 'storage-unavailable' })
    }
  }

  create(todo: Todo): Promise<LocalTodoResult<void>> {
    return this.#createDto(mapTodoDomainToDto(todo))
  }

  #createDto(todo: TodoDto): Promise<LocalTodoResult<void>> {
    return this.#changePages((cached) => {
      if (cached.query.page !== 1 || !matches(todo, cached.query)) return cached
      const items = cached.page.items + 1
      return withPage(cached, {
        ...cached.page,
        data: Object.freeze([todo, ...cached.page.data].slice(0, cached.query.pageSize)),
        items,
        pages: Math.max(1, Math.ceil(items / cached.query.pageSize))
      })
    })
  }

  update(todo: Todo): Promise<LocalTodoResult<void>> {
    return this.#updateDto(mapTodoDomainToDto(todo))
  }

  #updateDto(todo: TodoDto): Promise<LocalTodoResult<void>> {
    return this.#changePages((cached) => {
      const contains = cached.page.data.some((candidate) => candidate.id === todo.id)
      if (!contains) return cached
      const staysVisible = matches(todo, cached.query)
      const data = staysVisible
        ? cached.page.data.map((candidate) => (candidate.id === todo.id ? todo : candidate))
        : cached.page.data.filter((candidate) => candidate.id !== todo.id)
      const items = Math.max(0, cached.page.items - (staysVisible ? 0 : 1))
      return withPage(cached, {
        ...cached.page,
        data: Object.freeze(data),
        items,
        pages: Math.max(1, Math.ceil(items / cached.query.pageSize))
      })
    })
  }

  async replaceId(temporaryId: string, todo: Todo): Promise<LocalTodoResult<void>> {
    const todoDto = mapTodoDomainToDto(todo)
    const changed = await this.#changePages((cached) =>
      withPage(cached, {
        ...cached.page,
        data: Object.freeze(
          cached.page.data.map((candidate) => (candidate.id === temporaryId ? todoDto : candidate))
        )
      })
    )
    if (!changed.ok) return changed
    try {
      const database = await this.storage.get()
      const pending = (await database.getAll(TODO_OUTBOX_STORE)) as unknown[]
      for (const raw of pending) {
        const mutation = parsePendingMutation(raw)
        if (mutation.kind === 'create' || mutation.todoId !== temporaryId) continue
        const replacement = Object.freeze({ ...mutation, todoId: todoDto.id })
        await database.put(TODO_OUTBOX_STORE, replacement, replacement.operationId)
      }
      return ok()
    } catch {
      return err({ code: 'storage-unavailable' })
    }
  }

  remove(id: string): Promise<LocalTodoResult<void>> {
    return this.#changePages((cached) => {
      if (!cached.page.data.some((todo) => todo.id === id)) return cached
      const items = Math.max(0, cached.page.items - 1)
      return withPage(cached, {
        ...cached.page,
        data: Object.freeze(cached.page.data.filter((todo) => todo.id !== id)),
        items,
        pages: Math.max(1, Math.ceil(items / cached.query.pageSize))
      })
    })
  }

  async enqueue(mutation: PendingTodoMutation): Promise<LocalTodoResult<void>> {
    try {
      const dto = mapPendingTodoMutationToDto(mutation)
      await (await this.storage.get()).put(TODO_OUTBOX_STORE, dto, dto.operationId)
      return ok()
    } catch {
      return err({ code: 'storage-unavailable' })
    }
  }

  async pending(): Promise<LocalTodoResult<readonly PendingTodoMutation[]>> {
    try {
      const raw = (await (await this.storage.get()).getAll(TODO_OUTBOX_STORE)) as unknown[]
      return ok(
        Object.freeze(
          raw
            .map(parsePendingMutation)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map(mapPendingTodoMutationDtoToDomain)
        )
      )
    } catch {
      return err({ code: 'storage-unavailable' })
    }
  }

  async removePending(operationId: string): Promise<LocalTodoResult<void>> {
    try {
      await (await this.storage.get()).delete(TODO_OUTBOX_STORE, operationId)
      return ok()
    } catch {
      return err({ code: 'storage-unavailable' })
    }
  }

  #pageState(query: TodoQueryDto): MutableStateFlow<CachedTodoPageDto | undefined> {
    const key = todoQueryKey(query)
    let state = this.#pages.get(key)
    if (!state) {
      state = new MutableStateFlow<CachedTodoPageDto | undefined>(undefined)
      this.#pages.set(key, state)
    }
    return state
  }

  async #allPages(): Promise<readonly CachedTodoPageDto[]> {
    const raw = (await (await this.storage.get()).getAll(TODO_PAGES_STORE)) as unknown[]
    return raw.map(parseCachedPage)
  }

  async #changePages(
    transform: (cached: CachedTodoPageDto) => CachedTodoPageDto
  ): Promise<LocalTodoResult<void>> {
    try {
      const database = await this.storage.get()
      const pages = await this.#allPages()
      for (const cached of pages) {
        const changed = transform(cached)
        if (changed === cached) continue
        const saved = Object.freeze({ ...changed, savedAt: Date.now() })
        await database.put(TODO_PAGES_STORE, saved, todoQueryKey(saved.query))
        this.#pages.get(todoQueryKey(saved.query))?.set(saved)
      }
      return ok()
    } catch {
      return err({ code: 'storage-unavailable' })
    }
  }
}

export function todoQueryKey(query: TodoQueryDto): string {
  return JSON.stringify([
    query.page,
    query.pageSize,
    query.search,
    query.status,
    query.userId ?? null
  ])
}

function withPage(cached: CachedTodoPageDto, page: PagedTodoDto): CachedTodoPageDto {
  return Object.freeze({ ...cached, page: Object.freeze(page) })
}

function matches(todo: TodoDto, query: TodoQueryDto): boolean {
  if (query.status === 'active' && todo.completed) return false
  if (query.status === 'completed' && !todo.completed) return false
  if (query.userId !== undefined && todo.userId !== query.userId) return false
  return todo.title.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())
}

function parseCachedPage(value: unknown): CachedTodoPageDto {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('query' in value) ||
    !('page' in value) ||
    !('savedAt' in value) ||
    typeof value.savedAt !== 'number'
  ) {
    throw new TypeError('Invalid cached todo page')
  }
  return Object.freeze({
    query: parseQuery(value.query),
    page: parsePagedTodoDto(value.page),
    savedAt: value.savedAt
  })
}

function parseQuery(value: unknown): TodoQueryDto {
  if (typeof value !== 'object' || value === null) throw new TypeError('Invalid todo query')
  const query = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(query.page) ||
    !Number.isSafeInteger(query.pageSize) ||
    typeof query.search !== 'string' ||
    !['all', 'active', 'completed'].includes(String(query.status)) ||
    (query.userId !== undefined && typeof query.userId !== 'string')
  ) {
    throw new TypeError('Invalid todo query')
  }
  return Object.freeze({
    page: query.page as number,
    pageSize: query.pageSize as number,
    search: query.search,
    status: query.status as TodoQueryDto['status'],
    ...(query.userId === undefined ? {} : { userId: query.userId })
  })
}

function parsePendingMutation(value: unknown): PendingTodoMutationDto {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('operationId' in value) ||
    typeof value.operationId !== 'string' ||
    !('createdAt' in value) ||
    typeof value.createdAt !== 'number' ||
    !('kind' in value)
  ) {
    throw new TypeError('Invalid pending todo mutation')
  }
  if (value.kind === 'create' && 'todo' in value) {
    return Object.freeze({
      operationId: value.operationId,
      kind: 'create',
      todo: parseTodoDto(value.todo),
      createdAt: value.createdAt
    })
  }
  if (
    (value.kind === 'update' || value.kind === 'delete') &&
    'todoId' in value &&
    typeof value.todoId === 'string'
  ) {
    if (value.kind === 'delete')
      return Object.freeze({
        operationId: value.operationId,
        kind: 'delete',
        todoId: value.todoId,
        createdAt: value.createdAt
      })
    if (!('patch' in value) || typeof value.patch !== 'object' || value.patch === null)
      throw new TypeError('Invalid pending todo update')
    const patch = value.patch as Record<string, unknown>
    return Object.freeze({
      operationId: value.operationId,
      kind: 'update',
      todoId: value.todoId,
      patch: Object.freeze({
        ...(typeof patch.title === 'string' ? { title: patch.title } : {}),
        ...(typeof patch.completed === 'boolean' ? { completed: patch.completed } : {}),
        ...(typeof patch.userId === 'string' ? { userId: patch.userId } : {})
      }),
      createdAt: value.createdAt
    })
  }
  throw new TypeError('Invalid pending todo mutation')
}
