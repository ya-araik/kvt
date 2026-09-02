import type { User } from '../../domain/model/user.js'
import type { UserDto } from '../dto/user-dto.js'

export function mapUserDtoToDomain(dto: UserDto): User {
  return Object.freeze({ ...dto })
}

export function mapUserDomainToDto(user: User): UserDto {
  return Object.freeze({ ...user })
}
