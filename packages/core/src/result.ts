export type Result<T, E> = Ok<T> | Err<E>

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export function ok(): Ok<void>
export function ok<T>(value: T): Ok<T>
export function ok<T>(value?: T): Ok<T | void> {
  return Object.freeze({ ok: true, value })
}
export const err = <E>(error: E): Err<E> => Object.freeze({ ok: false, error })

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok
}

export function map<T, R, E>(result: Result<T, E>, transform: (value: T) => R): Result<R, E> {
  return result.ok ? ok(transform(result.value)) : result
}

export function flatMap<T, R, E, F>(result: Result<T, E>, transform: (value: T) => Result<R, F>): Result<R, E | F> {
  return result.ok ? transform(result.value) : result
}

export function mapError<T, E, F>(result: Result<T, E>, transform: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(transform(result.error))
}

export function match<T, E, R>(result: Result<T, E>, branches: {
  readonly ok: (value: T) => R
  readonly err: (error: E) => R
}): R {
  return result.ok ? branches.ok(result.value) : branches.err(result.error)
}

export function tap<T, E>(result: Result<T, E>, action: (value: T) => void): Result<T, E> {
  if (result.ok) action(result.value)
  return result
}

export async function fromPromise<T, E = unknown>(
  operation: Promise<T> | (() => Promise<T>),
  mapError: (error: unknown) => E = (error) => error as E
): Promise<Result<T, E>> {
  try {
    return ok(await (typeof operation === 'function' ? operation() : operation))
  } catch (error) {
    return err(mapError(error))
  }
}

export function combine<T extends readonly Result<unknown, unknown>[]>(
  results: T
): Result<{ [K in keyof T]: T[K] extends Result<infer V, unknown> ? V : never }, T[number] extends Result<unknown, infer E> ? E : never> {
  const values: unknown[] = []
  for (const result of results) {
    if (!result.ok) return result as never
    values.push(result.value)
  }
  return ok(values as never)
}
