export interface UserDto {
  readonly id: string
  readonly name: string
  readonly username: string
  readonly email: string
}

export interface CachedUsersDto {
  readonly users: readonly UserDto[]
  readonly savedAt: number
}

export function parseUsersDto(value: unknown): readonly UserDto[] {
  if (!Array.isArray(value)) throw new TypeError('Users response must be an array')
  return Object.freeze(value.map(parseUserDto))
}

export function parseUserDto(value: unknown): UserDto {
  if (!isRecord(value)) throw new TypeError('User response must be an object')
  return Object.freeze({
    id: requiredString(value.id, 'user.id'),
    name: requiredString(value.name, 'user.name'),
    username: requiredString(value.username, 'user.username'),
    email: requiredString(value.email, 'user.email')
  })
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new TypeError(`${path} must be a non-empty string`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
