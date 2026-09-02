import {
  ThemeSchemeRegistry,
  createDarkColorScheme,
  createLightColorScheme,
  createTheme,
  validateThemeContrast,
  type KvtTheme
} from '@kvt/theme-core'

export type AppThemeSchemeId = 'lagoon' | 'sunset' | 'midnight'

export interface AppThemeScheme {
  readonly id: AppThemeSchemeId
  readonly label: string
  readonly description: string
  readonly swatches: readonly [string, string, string]
  readonly theme: KvtTheme
}

const lagoon = createTheme({
  colors: createLightColorScheme({
    primary: '#006B5F',
    onPrimary: '#FFFFFF',
    primaryContainer: '#9EF2E2',
    onPrimaryContainer: '#00201C',
    secondary: '#4A635E',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#CCE8E1',
    onSecondaryContainer: '#06201B',
    tertiary: '#456179',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#CCE5FF',
    onTertiaryContainer: '#001E30',
    background: '#F5FBF8',
    onBackground: '#171D1B',
    surface: '#F5FBF8',
    onSurface: '#171D1B',
    surfaceVariant: '#DAE5E1',
    onSurfaceVariant: '#3F4946',
    outline: '#6F7976',
    outlineVariant: '#BEC9C5'
  })
})

const sunset = createTheme({
  colors: createLightColorScheme({
    primary: '#8B2800',
    onPrimary: '#FFFFFF',
    primaryContainer: '#FFDCCB',
    onPrimaryContainer: '#321000',
    secondary: '#745548',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#FFDCCB',
    onSecondaryContainer: '#2B160E',
    tertiary: '#655F30',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#ECE4A8',
    onTertiaryContainer: '#201C00',
    background: '#FFF8F5',
    onBackground: '#241A17',
    surface: '#FFF8F5',
    onSurface: '#241A17',
    surfaceVariant: '#F4DED5',
    onSurfaceVariant: '#52443E',
    outline: '#85736B',
    outlineVariant: '#D8C2B9'
  })
})

const midnight = createTheme({
  colors: createDarkColorScheme({
    primary: '#65D9E8',
    onPrimary: '#00363D',
    primaryContainer: '#004F58',
    onPrimaryContainer: '#9EF0FA',
    secondary: '#B2CBD0',
    onSecondary: '#1D3438',
    secondaryContainer: '#344B4F',
    onSecondaryContainer: '#CEE7EC',
    tertiary: '#C4C1EA',
    onTertiary: '#2E2C4D',
    tertiaryContainer: '#454364',
    onTertiaryContainer: '#E1DFFF',
    background: '#0D1416',
    onBackground: '#DCE4E6',
    surface: '#0D1416',
    onSurface: '#DCE4E6',
    surfaceVariant: '#3F484A',
    onSurfaceVariant: '#BFC8CA',
    outline: '#899294',
    outlineVariant: '#3F484A',
    inverseSurface: '#DCE4E6',
    inverseOnSurface: '#293133',
    inversePrimary: '#006874'
  })
})

const definitions: readonly AppThemeScheme[] = Object.freeze([
  Object.freeze({
    id: 'lagoon',
    label: 'Лагуна',
    description: 'Спокойная светлая тема с бирюзовым акцентом.',
    swatches: ['#006B5F', '#9EF2E2', '#F5FBF8'] as const,
    theme: lagoon
  }),
  Object.freeze({
    id: 'sunset',
    label: 'Закат',
    description: 'Тёплая светлая тема с терракотовым акцентом.',
    swatches: ['#8B2800', '#FFDCCB', '#FFF8F5'] as const,
    theme: sunset
  }),
  Object.freeze({
    id: 'midnight',
    label: 'Полночь',
    description: 'Контрастная тёмная тема с холодным свечением.',
    swatches: ['#65D9E8', '#004F58', '#0D1416'] as const,
    theme: midnight
  })
])

export const themeSchemeRegistry = new ThemeSchemeRegistry()
for (const scheme of definitions) {
  const failures = validateThemeContrast(scheme.theme)
  if (failures.length > 0) {
    throw new Error(`Theme ${scheme.id} has ${failures.length} contrast failure(s)`)
  }
  themeSchemeRegistry.register(scheme.id, scheme.theme)
}

export const appThemeSchemes = definitions

export function getAppThemeScheme(id: AppThemeSchemeId): AppThemeScheme {
  const scheme = definitions.find((candidate) => candidate.id === id)
  if (!scheme) throw new Error(`Unknown theme scheme: ${id}`)
  return scheme
}

export function isAppThemeSchemeId(value: unknown): value is AppThemeSchemeId {
  return value === 'lagoon' || value === 'sunset' || value === 'midnight'
}
