import { MutableStateFlow, type StateFlow } from './state-flow.js'

export type AsyncState<T, E> =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly previous?: T }
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'failure'; readonly error: E; readonly previous?: T }
  | { readonly status: 'cancelled'; readonly previous?: T }

export type TaskPolicy = 'latest' | 'enqueue' | 'parallel' | 'ignore'

export interface TaskRunContext {
  readonly signal: AbortSignal
  readonly generation: number
}

export interface TaskControllerOptions<E> {
  readonly policy?: TaskPolicy
  readonly concurrency?: number
  readonly mapError?: (error: unknown) => E
}

interface TaskRequest<I, T> {
  readonly input: I
  readonly resolve: (value: T | undefined) => void
  readonly reject: (error: unknown) => void
}

export class TaskController<I, T, E = unknown> {
  readonly #task: (input: I, context: TaskRunContext) => Promise<T>
  readonly #policy: TaskPolicy
  readonly #concurrency: number
  readonly #mapError: (error: unknown) => E
  readonly #mutableState = new MutableStateFlow<AsyncState<T, E>>({ status: 'idle' })
  readonly #active = new Map<number, AbortController>()
  readonly #queue: TaskRequest<I, T>[] = []
  #generation = 0
  #lastSuccess?: T

  constructor(task: (input: I, context: TaskRunContext) => Promise<T>, options: TaskControllerOptions<E> = {}) {
    this.#task = task
    this.#policy = options.policy ?? 'latest'
    if (this.#policy !== 'parallel' && options.concurrency !== undefined && options.concurrency !== 1) {
      throw new RangeError('Only the parallel task policy accepts concurrency other than one')
    }
    this.#concurrency = this.#policy === 'parallel' ? options.concurrency ?? Infinity : 1
    if (this.#concurrency !== Infinity && (!Number.isSafeInteger(this.#concurrency) || this.#concurrency < 1)) {
      throw new RangeError('concurrency must be a positive safe integer or Infinity')
    }
    this.#mapError = options.mapError ?? ((error) => error as E)
  }

  get state(): StateFlow<AsyncState<T, E>> {
    return this.#mutableState.asStateFlow()
  }

  get activeCount(): number {
    return this.#active.size
  }

  run(input: I): Promise<T | undefined> {
    if (this.#policy === 'ignore' && this.#active.size > 0) return Promise.resolve(undefined)
    if (this.#policy === 'latest') this.cancel('superseded')
    return new Promise<T | undefined>((resolve, reject) => {
      const request: TaskRequest<I, T> = { input, resolve, reject }
      if ((this.#policy === 'enqueue' || this.#policy === 'parallel') && this.#active.size >= this.#concurrency) {
        this.#queue.push(request)
      } else {
        this.#start(request)
      }
    })
  }

  cancel(reason?: unknown): void {
    for (const controller of this.#active.values()) controller.abort(reason)
    this.#queue.splice(0).forEach((request) => request.resolve(undefined))
  }

  #start(request: TaskRequest<I, T>): void {
    const generation = ++this.#generation
    const controller = new AbortController()
    this.#active.set(generation, controller)
    this.#mutableState.set(Object.freeze(this.#lastSuccess === undefined
      ? { status: 'running' }
      : { status: 'running', previous: this.#lastSuccess }))

    let operation: Promise<T>
    try {
      operation = this.#task(request.input, { signal: controller.signal, generation })
    } catch (error) {
      operation = Promise.reject(error)
    }
    void operation.then(
      (value) => {
        if (controller.signal.aborted) {
          this.#finish(generation)
          request.resolve(undefined)
          return
        }
        this.#lastSuccess = value
        if (this.#policy !== 'latest' || generation === this.#generation) {
          this.#mutableState.set(Object.freeze({ status: 'success', data: value }))
        }
        this.#finish(generation)
        request.resolve(value)
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          if (this.#policy !== 'latest' || generation === this.#generation) {
            this.#mutableState.set(Object.freeze(this.#lastSuccess === undefined
              ? { status: 'cancelled' }
              : { status: 'cancelled', previous: this.#lastSuccess }))
          }
          this.#finish(generation)
          request.resolve(undefined)
          return
        }
        let mapped: E
        try { mapped = this.#mapError(error) } catch (mappingError) { mapped = mappingError as E }
        if (this.#policy !== 'latest' || generation === this.#generation) {
          this.#mutableState.set(Object.freeze(this.#lastSuccess === undefined
            ? { status: 'failure', error: mapped }
            : { status: 'failure', error: mapped, previous: this.#lastSuccess }))
        }
        this.#finish(generation)
        request.reject(mapped)
      }
    )
  }

  #finish(generation: number): void {
      this.#active.delete(generation)
      const next = this.#queue.shift()
      if (next) this.#start(next)
  }
}
