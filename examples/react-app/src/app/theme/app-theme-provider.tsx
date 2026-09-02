import { createLocalStorageThemeAdapter, KvtThemeProvider } from '@kvt/theme-react'
import { useMemo, useState, type ReactNode } from 'react'
import { AppThemeContext, type AppThemeContextValue } from './app-theme-context.js'
import { getAppThemeScheme, isAppThemeSchemeId, type AppThemeSchemeId } from './theme-schemes.js'

const SCHEME_STORAGE_KEY = 'kvt-showcase-scheme'
const PREFERENCE_STORAGE_KEY = 'kvt-showcase-preference'

export function AppThemeProvider({ children }: { readonly children: ReactNode }) {
  const [schemeId, setSchemeId] = useState<AppThemeSchemeId>(readStoredScheme)
  const scheme = getAppThemeScheme(schemeId)
  const selection = useMemo<AppThemeContextValue>(
    () => ({
      schemeId,
      setScheme(id) {
        setSchemeId(id)
        try {
          localStorage.setItem(SCHEME_STORAGE_KEY, id)
        } catch {
          // Theme selection remains usable when storage is blocked.
        }
      }
    }),
    [schemeId]
  )

  return (
    <AppThemeContext.Provider value={selection}>
      <KvtThemeProvider
        target={document.documentElement}
        light={scheme.theme}
        dark={scheme.theme}
        storage={createLocalStorageThemeAdapter(localStorage)}
        storageKey={PREFERENCE_STORAGE_KEY}
        defaultPreference={{ version: 1, color: 'light', motion: 'system' }}
      >
        {children}
      </KvtThemeProvider>
    </AppThemeContext.Provider>
  )
}

function readStoredScheme(): AppThemeSchemeId {
  try {
    const stored = localStorage.getItem(SCHEME_STORAGE_KEY)
    return isAppThemeSchemeId(stored) ? stored : 'lagoon'
  } catch {
    return 'lagoon'
  }
}
