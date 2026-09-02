import { startTransition } from 'react'

export function runKvtTransition(operation: () => void): void {
  startTransition(operation)
}
