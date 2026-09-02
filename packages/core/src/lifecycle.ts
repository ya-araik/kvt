import { KvtError } from './errors.js'

export interface Disposable {
  dispose(): void
}

export interface ShutdownContext {
  readonly signal: AbortSignal
  readonly reason: string
  readonly deadline: number | undefined
}

export interface Shutdownable {
  shutdown(context: ShutdownContext): void | Promise<void>
}

export function isDisposable(value: unknown): value is Disposable {
  return typeof value === 'object' && value !== null && typeof (value as { dispose?: unknown }).dispose === 'function'
}

export function isShutdownable(value: unknown): value is Shutdownable {
  return typeof value === 'object' && value !== null && typeof (value as { shutdown?: unknown }).shutdown === 'function'
}

export async function shutdownResource(value: unknown, context: ShutdownContext): Promise<void> {
  if (isShutdownable(value)) {
    await raceWithAbort(Promise.resolve(value.shutdown(context)), context.signal)
  } else if (isDisposable(value)) {
    value.dispose()
  }
}

export async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal)
  let rejectAbort!: (reason: unknown) => void
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => rejectAbort(abortError(signal))
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([operation, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new KvtError('Operation was aborted', {
    code: 'KVT_LIFECYCLE_ABORTED',
    subsystem: 'lifecycle',
    operation: 'shutdown'
  })
}
