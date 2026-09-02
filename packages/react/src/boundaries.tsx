import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'

export interface KvtErrorBoundaryProps {
  readonly fallback: ReactNode | ((error: unknown, reset: () => void) => ReactNode)
  readonly onError?: (error: unknown, info: ErrorInfo) => void
  readonly children: ReactNode
}

export interface KvtErrorBoundaryState {
  readonly error: unknown | null
}

export class KvtErrorBoundary extends Component<KvtErrorBoundaryProps, KvtErrorBoundaryState> {
  override state: KvtErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): KvtErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      const reset = () => this.setState({ error: null })
      return typeof this.props.fallback === 'function' ? this.props.fallback(this.state.error, reset) : this.props.fallback
    }
    return this.props.children
  }
}

export interface KvtSuspenseBoundaryProps {
  readonly fallback: ReactNode
  readonly children: ReactNode
}

export function KvtSuspenseBoundary({ fallback, children }: KvtSuspenseBoundaryProps) {
  return <Suspense fallback={fallback}>{children}</Suspense>
}
