export interface Token<T> {
  readonly kind: 'single'
  readonly id: symbol
  readonly description: string
  readonly __type?: T
}

export interface MultiToken<T> {
  readonly kind: 'multi'
  readonly id: symbol
  readonly description: string
  readonly __type?: T
}

export type Constructor<T = unknown, TArguments extends readonly unknown[] = readonly unknown[]> =
  new (...arguments_: TArguments) => T

export type AbstractConstructor<T = unknown> =
  abstract new (...arguments_: readonly never[]) => T

export type ClassIdentifier<T> = abstract new (...arguments_: never[]) => T
export type SingleIdentifier<T> = Token<T> | ClassIdentifier<T>
export type ServiceIdentifier<T> = SingleIdentifier<T> | MultiToken<T>
export type IdentifierKey = symbol | ClassIdentifier<unknown>

export type IdentifierValue<TIdentifier> =
  TIdentifier extends Token<infer T> ? T
    : TIdentifier extends MultiToken<infer T> ? readonly T[]
      : TIdentifier extends abstract new (...arguments_: never[]) => infer T ? T
        : never

export function createToken<T>(description: string): Token<T> {
  validateDescription(description)
  return Object.freeze({ kind: 'single', id: Symbol(description), description })
}

export function createMultiToken<T>(description: string): MultiToken<T> {
  validateDescription(description)
  return Object.freeze({ kind: 'multi', id: Symbol(description), description })
}

export function isClassIdentifier<T>(identifier: ServiceIdentifier<T>): identifier is ClassIdentifier<T> {
  return typeof identifier === 'function'
}

export function isMultiIdentifier(identifier: ServiceIdentifier<unknown>): identifier is MultiToken<unknown> {
  return typeof identifier !== 'function' && identifier.kind === 'multi'
}

export function identifierKey(identifier: ServiceIdentifier<unknown>): IdentifierKey {
  return typeof identifier === 'function' ? identifier : identifier.id
}

export function identifierDescription(identifier: ServiceIdentifier<unknown>): string {
  if (typeof identifier !== 'function') return identifier.description
  return identifier.name || '<anonymous-class>'
}

function validateDescription(description: string): void {
  if (description.trim() !== description || description.length === 0) {
    throw new TypeError('Token description must be a non-empty trimmed string')
  }
}
