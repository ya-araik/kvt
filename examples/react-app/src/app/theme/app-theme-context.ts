import { useKvtTheme, type ThemeMotionPreference } from '@kvt/theme-react'
import { createContext, useContext } from 'react'
import type { AppThemeSchemeId } from './theme-schemes.js'

export interface AppThemeContextValue {
  readonly schemeId: AppThemeSchemeId
  setScheme(id: AppThemeSchemeId): void
}

export const AppThemeContext = createContext<AppThemeContextValue | null>(null)

export function useAppTheme() {
  const selection = useContext(AppThemeContext)
  if (!selection) throw new Error('useAppTheme requires AppThemeProvider')
  const theme = useKvtTheme()
  return {
    ...selection,
    motion: theme.preference.motion,
    resolvedMotion: theme.resolvedMotion,
    setMotion(motion: ThemeMotionPreference) {
      theme.setPreference({ color: 'light', motion })
    }
  }
}
