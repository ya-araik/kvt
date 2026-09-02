import type { TraceContext } from './diagnostics.js'

export interface UseCaseContext {
  readonly signal: AbortSignal
  readonly trace?: TraceContext
}

export interface UseCase<I, O> {
  execute: (input: I, context: UseCaseContext) => O | Promise<O>
}

/**
 * An application operation that has no input value but still participates in
 * cancellation and trace propagation.
 */
export interface NoInputUseCase<O> {
  execute: (context: UseCaseContext) => O | Promise<O>
}
