export type FlowErrorReporter = (error: unknown, context: FlowErrorContext) => void

export interface FlowErrorContext {
  readonly operation: 'collector' | 'listener' | 'producer' | 'scheduler'
  readonly flowName?: string
}

let reporter: FlowErrorReporter = () => undefined

export function setFlowErrorReporter(next: FlowErrorReporter): () => void {
  const previous = reporter
  reporter = next
  return () => {
    reporter = previous
  }
}

export function reportFlowError(error: unknown, context: FlowErrorContext): void {
  try {
    reporter(error, context)
  } catch {
    // Error reporting is observational and must never break a flow operation.
  }
}
