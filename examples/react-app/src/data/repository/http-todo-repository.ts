import { err, ok, type Result } from '@kvt/core'
import type { TodoRepositoryFailure } from '../../domain/model/failure/todo-repository-failure.js'
import type {
  CreateTodoData,
  Todo,
  TodoCriteria,
  TodoPage,
  UpdateTodoData
} from '../../domain/model/todo.js'
import { NetworkTodoRepository } from '../../domain/repository/network-todo-repository.js'
import { parsePagedTodoDto, parseTodoDto } from '../dto/todo-dto.js'
import { HttpRequestFailure, JsonServerHttpClient } from '../http/json-server-http-client.js'
import {
  mapTodoCriteriaToDto,
  mapTodoDtoToDomain,
  mapTodoPageDtoToDomain
} from '../mapper/todo-mapper.js'

export class HttpTodoRepository extends NetworkTodoRepository {
  constructor(private readonly http: JsonServerHttpClient) {
    super()
  }

  async list(
    criteria: TodoCriteria,
    signal: AbortSignal
  ): Promise<Result<TodoPage, TodoRepositoryFailure>> {
    try {
      const query = mapTodoCriteriaToDto(criteria)
      const page = parsePagedTodoDto(await this.http.request(todoListPath(query), { signal }))
      return ok(mapTodoPageDtoToDomain(page, query.pageSize))
    } catch (error) {
      return err(mapNetworkFailure(error))
    }
  }

  async create(
    input: CreateTodoData,
    signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>> {
    try {
      return ok(
        mapTodoDtoToDomain(
          parseTodoDto(await this.http.request('/todos', { method: 'POST', body: input, signal }))
        )
      )
    } catch (error) {
      return err(mapNetworkFailure(error))
    }
  }

  async update(
    id: string,
    patch: UpdateTodoData,
    signal: AbortSignal
  ): Promise<Result<Todo, TodoRepositoryFailure>> {
    try {
      return ok(
        mapTodoDtoToDomain(
          parseTodoDto(
            await this.http.request(`/todos/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: patch,
              signal
            })
          )
        )
      )
    } catch (error) {
      return err(mapNetworkFailure(error, id))
    }
  }

  async remove(id: string, signal: AbortSignal): Promise<Result<void, TodoRepositoryFailure>> {
    try {
      await this.http.request(`/todos/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        signal
      })
      return ok()
    } catch (error) {
      return err(mapNetworkFailure(error, id))
    }
  }
}

function todoListPath(query: import('../dto/todo-dto.js').TodoQueryDto): string {
  const parameters = new URLSearchParams({
    _page: String(query.page),
    _per_page: String(query.pageSize),
    _sort: '-id'
  })
  if (query.search.length > 0) parameters.set('title:contains', query.search)
  if (query.status !== 'all') parameters.set('completed', String(query.status === 'completed'))
  if (query.userId !== undefined) parameters.set('userId', query.userId)
  return `/todos?${parameters.toString()}`
}

function mapNetworkFailure(error: unknown, id?: string): TodoRepositoryFailure {
  if (error instanceof HttpRequestFailure) {
    if (error.kind === 'network') return { code: 'network-unavailable' }
    if (error.status === 404 && id !== undefined) return { code: 'todo-not-found', id }
    return { code: 'unexpected-response', status: error.status ?? 0 }
  }
  if (error instanceof TypeError || error instanceof SyntaxError)
    return { code: 'invalid-response' }
  return { code: 'network-unavailable' }
}
