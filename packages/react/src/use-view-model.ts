import type { ClassIdentifier, ViewModel, ViewModelInstanceKey, ViewModelLease } from '@kvt/core'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useKvtContext } from './context.js'

export interface UseViewModelOptions {
  readonly key?: ViewModelInstanceKey
}

/** Resolves a DI-registered ViewModel from the nearest committed owner. */
export function useViewModel<T extends ViewModel>(
  identifier: ClassIdentifier<T>,
  options: UseViewModelOptions = {}
): T {
  const { owner, runtime } = useKvtContext()
  const instanceKey = options.key
  const lease = useMemo<ViewModelLease<T>>(
    () => owner.acquire(identifier, instanceKey === undefined ? {} : { key: instanceKey }),
    [identifier, instanceKey, owner]
  )
  const [startError, setStartError] = useState<unknown>()
  const activeEffects = useRef(0)

  useLayoutEffect(() => {
    const effectCounter = activeEffects
    effectCounter.current++
    void lease.commit().catch((error: unknown) => {
      runtime.reportError(error, 'view-model', 'start', {
        ownerId: owner.id,
        identifier: identifier.name
      })
      setStartError(() => error)
    })
    return () => {
      effectCounter.current--
      queueMicrotask(() => {
        if (effectCounter.current === 0) lease.dispose()
      })
    }
  }, [identifier, lease, owner.id, runtime])

  if (startError !== undefined) throw startError
  return lease.value
}
