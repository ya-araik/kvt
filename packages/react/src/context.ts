import type { KvtRuntime, ViewModelOwner } from '@kvt/core'
import { createContext, useContext } from 'react'
import type { HydrationRegistry } from './hydration.js'

export interface KvtReactContextValue {
  readonly runtime: KvtRuntime
  readonly owner: ViewModelOwner
  readonly hydration: HydrationRegistry
}

export const KvtReactContext = createContext<KvtReactContextValue | null>(null)

export function useKvtContext(): KvtReactContextValue {
  const context = useContext(KvtReactContext)
  if (!context) throw new Error('KVT hooks require a KvtProvider')
  return context
}

export const useKvtRuntime = (): KvtRuntime => useKvtContext().runtime
