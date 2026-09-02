export type KvtSubsystem =
  | 'runtime'
  | 'lifecycle'
  | 'di'
  | 'module'
  | 'plugin'
  | 'view-model'
  | 'router'
  | 'query'
  | 'theme'
  | 'diagnostics'

export interface KvtErrorOptions extends ErrorOptions {
  readonly code: string
  readonly subsystem: KvtSubsystem
  readonly operation: string
  readonly context?: Readonly<Record<string, unknown>>
  readonly path?: readonly string[]
  readonly retryable?: boolean
}

export class KvtError extends Error {
  readonly code: string
  readonly subsystem: KvtSubsystem
  readonly operation: string
  readonly context: Readonly<Record<string, string | number | boolean | null>>
  readonly path: readonly string[]
  readonly retryable: boolean

  constructor(message: string, options: KvtErrorOptions) {
    super(message, options)
    this.name = 'KvtError'
    this.code = options.code
    this.subsystem = options.subsystem
    this.operation = options.operation
    this.context = redactKvtContext(options.context)
    this.path = Object.freeze([...(options.path ?? [])])
    this.retryable = options.retryable ?? false
  }
}

export function isKvtError(error: unknown): error is KvtError {
  return error instanceof KvtError
}

const sensitiveContextKey = /(?:authorization|cookie|credential|password|secret|token|value|data|payload|body)/i

export function redactKvtContext(
  context: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, string | number | boolean | null>> {
  const safe: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(context)) {
    if (sensitiveContextKey.test(key)) safe[key] = '[redacted]'
    else if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') safe[key] = value
    else if (value instanceof Error) safe[key] = value.name
    else if (value !== undefined) safe[key] = `[${Array.isArray(value) ? 'array' : typeof value}]`
  }
  return Object.freeze(safe)
}
