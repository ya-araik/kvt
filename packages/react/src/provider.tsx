import type { KvtRuntime } from '@kvt/core'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { KvtReactContext } from './context.js'
import { createHydrationRegistry, type HydrationState } from './hydration.js'

export interface KvtProviderProps {
  readonly runtime: KvtRuntime
  readonly hydration?: HydrationState
  /**
   * Forwards a real browser page exit to the root runtime. This is enabled by
   * default, ignored during SSR and does not shut the runtime down on an
   * ordinary React unmount.
   */
  readonly shutdownOnPageHide?: boolean
  readonly shutdownTimeoutMs?: number
  readonly children: ReactNode
}

export function KvtProvider({
  runtime,
  hydration,
  shutdownOnPageHide = true,
  shutdownTimeoutMs = 10_000,
  children
}: KvtProviderProps) {
  if (runtime.state !== 'running') throw new Error(`KvtProvider requires a running runtime; received ${runtime.state}`)
  const [initialRuntime] = useState(runtime)
  if (initialRuntime !== runtime) {
    throw new Error('KvtProvider runtime identity changed without remounting the provider')
  }
  const registry = useMemo(() => createHydrationRegistry(hydration), [hydration])
  const context = useMemo(() => ({ runtime, owner: runtime.rootViewModelOwner, hydration: registry }), [runtime, registry])
  useEffect(() => {
    if (!shutdownOnPageHide || typeof window === 'undefined') return
    const shutdown = (event: PageTransitionEvent) => {
      // A persisted page is entering the back/forward cache and can be shown
      // again with the same JavaScript heap. Its runtime must stay alive.
      if (event.persisted) return
      void runtime.shutdown({ reason: 'pagehide', timeoutMs: shutdownTimeoutMs }).catch((error: unknown) => {
        runtime.reportError(error, 'runtime', 'browser-pagehide-shutdown')
      })
    }
    window.addEventListener('pagehide', shutdown)
    return () => window.removeEventListener('pagehide', shutdown)
  }, [runtime, shutdownOnPageHide, shutdownTimeoutMs])
  return <KvtReactContext.Provider value={context}>{children}</KvtReactContext.Provider>
}
