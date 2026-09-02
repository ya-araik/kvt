import type {
  CachedTodoPage,
  PendingTodoMutation,
  Todo,
  TodoCriteria,
  TodoPage
} from '../../domain/model/todo.js'
import type {
  CachedTodoPageDto,
  PagedTodoDto,
  PendingTodoMutationDto,
  TodoDto,
  TodoQueryDto
} from '../dto/todo-dto.js'

export function mapTodoDtoToDomain(dto: TodoDto): Todo {
  return Object.freeze({ ...dto })
}

export function mapTodoDomainToDto(todo: Todo): TodoDto {
  return Object.freeze({ ...todo })
}

export function mapTodoPageDtoToDomain(dto: PagedTodoDto, pageSize: number): TodoPage {
  const page = dto.prev === null ? dto.first : dto.prev + 1
  return Object.freeze({
    todos: Object.freeze(dto.data.map(mapTodoDtoToDomain)),
    page,
    pageSize,
    totalItems: dto.items,
    totalPages: dto.pages,
    hasPreviousPage: dto.prev !== null,
    hasNextPage: dto.next !== null
  })
}

export function mapTodoPageDomainToDto(page: TodoPage): PagedTodoDto {
  return Object.freeze({
    first: 1,
    prev: page.hasPreviousPage ? page.page - 1 : null,
    next: page.hasNextPage ? page.page + 1 : null,
    last: Math.max(1, page.totalPages),
    pages: page.totalPages,
    items: page.totalItems,
    data: Object.freeze(page.todos.map(mapTodoDomainToDto))
  })
}

export function mapTodoCriteriaToDto(criteria: TodoCriteria): TodoQueryDto {
  return Object.freeze({
    page: Math.max(1, Math.trunc(criteria.page)),
    pageSize: Math.max(1, Math.trunc(criteria.pageSize)),
    search: criteria.search.trim(),
    status: criteria.status,
    ...(criteria.userId === undefined ? {} : { userId: criteria.userId })
  })
}

export function mapTodoQueryDtoToDomain(query: TodoQueryDto): TodoCriteria {
  return Object.freeze({ ...query })
}

export function mapCachedTodoPageDtoToDomain(cached: CachedTodoPageDto): CachedTodoPage {
  return Object.freeze({
    criteria: mapTodoQueryDtoToDomain(cached.query),
    page: mapTodoPageDtoToDomain(cached.page, cached.query.pageSize),
    savedAt: cached.savedAt
  })
}

export function mapPendingTodoMutationToDto(mutation: PendingTodoMutation): PendingTodoMutationDto {
  if (mutation.kind === 'create')
    return Object.freeze({ ...mutation, todo: mapTodoDomainToDto(mutation.todo) })
  return Object.freeze({ ...mutation })
}

export function mapPendingTodoMutationDtoToDomain(
  mutation: PendingTodoMutationDto
): PendingTodoMutation {
  if (mutation.kind === 'create')
    return Object.freeze({ ...mutation, todo: mapTodoDtoToDomain(mutation.todo) })
  return Object.freeze({ ...mutation })
}
