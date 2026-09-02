import type { SharedFlow } from '@kvt/flow'
import { useEffect, useLayoutEffect, useRef } from 'react'

const useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function useSharedFlow<T>(flow: SharedFlow<T>, handler: (value: T) => void | Promise<void>): void {
  const committedHandler = useRef(handler)
  useCommitEffect(() => {
    committedHandler.current = handler
  }, [handler])
  useEffect(() => {
    const subscription = flow.subscribe((value) => committedHandler.current(value))
    return () => subscription.cancel()
  }, [flow])
}
