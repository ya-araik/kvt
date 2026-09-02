import { describe, expect, it } from 'vitest'
import { mapTodoPageDtoToDomain } from '../mapper/todo-mapper.js'
import { mapUserDtoToDomain } from '../mapper/user-mapper.js'
import { parsePagedTodoDto, parseTodoDto } from './todo-dto.js'
import { parseUsersDto } from './user-dto.js'

describe('runtime DTO validation', () => {
  it('validates and maps a JSON Server page without leaking DTOs into domain', () => {
    const dto = parsePagedTodoDto({
      first: 1,
      prev: null,
      next: 2,
      last: 10,
      pages: 10,
      items: 200,
      data: [{ id: '1', userId: '2', title: 'Проверить DTO', completed: false }]
    })

    expect(mapTodoPageDtoToDomain(dto, 20)).toEqual({
      todos: [{ id: '1', userId: '2', title: 'Проверить DTO', completed: false }],
      page: 1,
      pageSize: 20,
      totalItems: 200,
      totalPages: 10,
      hasPreviousPage: false,
      hasNextPage: true
    })
  })

  it('rejects number IDs and malformed pagination', () => {
    expect(() => parseTodoDto({ id: 1, userId: '2', title: 'Wrong id', completed: false })).toThrow(
      'todo.id'
    )
    expect(() => parsePagedTodoDto([])).toThrow('paged object')
    expect(() =>
      parsePagedTodoDto({ first: 0, prev: null, next: null, last: 1, pages: 0, items: 0, data: [] })
    ).toThrow('first')
  })

  it('validates users before mapping them', () => {
    const [dto] = parseUsersDto([
      { id: '7', name: 'Kurtis Weissnat', username: 'Elwyn.Skiles', email: 'kurtis@example.test' }
    ])
    expect(dto && mapUserDtoToDomain(dto)).toEqual({
      id: '7',
      name: 'Kurtis Weissnat',
      username: 'Elwyn.Skiles',
      email: 'kurtis@example.test'
    })
    expect(() => parseUsersDto([{ id: '7', name: '', username: 'user', email: 'mail' }])).toThrow(
      'user.name'
    )
  })
})
