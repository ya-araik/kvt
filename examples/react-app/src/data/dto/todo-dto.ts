export interface TodoDto {
  readonly id: string
  readonly userId: string
  readonly title: string
  readonly completed: boolean
}

export interface PagedTodoDto {
  readonly first: number
  readonly prev: number | null
  readonly next: number | null
  readonly last: number
  readonly pages: number
  readonly items: number
  readonly data: readonly TodoDto[]
}

export interface CreateTodoRequestDto {
  readonly userId: string
  readonly title: string
  readonly completed: boolean
}

export interface UpdateTodoRequestDto {
  readonly userId?: string
  readonly title?: string
  readonly completed?: boolean
}

export interface TodoQueryDto {
  readonly page: number
  readonly pageSize: number
  readonly search: string
  readonly status: 'all' | 'active' | 'completed'
  readonly userId?: string
}

export interface CachedTodoPageDto {
  readonly query: TodoQueryDto
  readonly page: PagedTodoDto
  readonly savedAt: number
}

export type PendingTodoMutationDto =
  | {
      readonly operationId: string
      readonly kind: 'create'
      readonly todo: TodoDto
      readonly createdAt: number
    }
  | {
      readonly operationId: string
      readonly kind: 'update'
      readonly todoId: string
      readonly patch: UpdateTodoRequestDto
      readonly createdAt: number
    }
  | {
      readonly operationId: string
      readonly kind: 'delete'
      readonly todoId: string
      readonly createdAt: number
    }

export function parseTodoDto(value: unknown): TodoDto {
  if (!isRecord(value)) throw new TypeError('Todo response must be an object')
  return Object.freeze({
    id: requiredString(value.id, 'todo.id'),
    userId: requiredString(value.userId, 'todo.userId'),
    title: requiredString(value.title, 'todo.title'),
    completed: requiredBoolean(value.completed, 'todo.completed')
  })
}

export function parsePagedTodoDto(value: unknown): PagedTodoDto {
  if (!isRecord(value) || !Array.isArray(value.data))
    throw new TypeError('Todo list response must be a paged object')
  return Object.freeze({
    first: requiredPage(value.first, 'first'),
    prev: optionalPage(value.prev, 'prev'),
    next: optionalPage(value.next, 'next'),
    last: requiredPage(value.last, 'last'),
    pages: requiredNonNegativeInteger(value.pages, 'pages'),
    items: requiredNonNegativeInteger(value.items, 'items'),
    data: Object.freeze(value.data.map(parseTodoDto))
  })
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new TypeError(`${path} must be a non-empty string`)
  return value
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`)
  return value
}

function requiredPage(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new TypeError(`${path} must be a positive integer`)
  return value as number
}

function optionalPage(value: unknown, path: string): number | null {
  return value === null ? null : requiredPage(value, path)
}

function requiredNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`${path} must be a non-negative integer`)
  return value as number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
