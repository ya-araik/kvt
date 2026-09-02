export type DeepPartial<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepPartial<U>[]
    : T extends object
      ? { readonly [K in keyof T]?: DeepPartial<T[K]> }
      : T

export interface ColorScheme {
  readonly primary: string
  readonly onPrimary: string
  readonly primaryContainer: string
  readonly onPrimaryContainer: string
  readonly secondary: string
  readonly onSecondary: string
  readonly secondaryContainer: string
  readonly onSecondaryContainer: string
  readonly tertiary: string
  readonly onTertiary: string
  readonly tertiaryContainer: string
  readonly onTertiaryContainer: string
  readonly error: string
  readonly onError: string
  readonly errorContainer: string
  readonly onErrorContainer: string
  readonly background: string
  readonly onBackground: string
  readonly surface: string
  readonly onSurface: string
  readonly surfaceVariant: string
  readonly onSurfaceVariant: string
  readonly outline: string
  readonly outlineVariant: string
  readonly inverseSurface: string
  readonly inverseOnSurface: string
  readonly inversePrimary: string
  readonly scrim: string
  readonly shadow: string
}

export interface TypographyStyle {
  readonly fontFamily: string
  readonly fontSize: string
  readonly fontWeight: number
  readonly lineHeight: string
  readonly letterSpacing: string
}

export interface TypographyScheme {
  readonly displayLarge: TypographyStyle
  readonly headlineLarge: TypographyStyle
  readonly titleLarge: TypographyStyle
  readonly bodyLarge: TypographyStyle
  readonly bodyMedium: TypographyStyle
  readonly labelLarge: TypographyStyle
  readonly labelSmall: TypographyStyle
}

export interface ShapeScheme {
  readonly none: string
  readonly extraSmall: string
  readonly small: string
  readonly medium: string
  readonly large: string
  readonly extraLarge: string
  readonly full: string
}

export interface SpacingScheme {
  readonly none: string
  readonly extraSmall: string
  readonly small: string
  readonly medium: string
  readonly large: string
  readonly extraLarge: string
}

export type MotionPreference = 'full' | 'reduced' | 'none'

export interface MotionScheme {
  readonly preference: MotionPreference
  readonly durationShort: string
  readonly durationMedium: string
  readonly durationLong: string
  readonly easingStandard: string
  readonly easingEmphasized: string
}

export interface ElevationScheme {
  readonly level0: string
  readonly level1: string
  readonly level2: string
  readonly level3: string
  readonly level4: string
  readonly level5: string
}

export interface KvtTheme {
  readonly colors: ColorScheme
  readonly typography: TypographyScheme
  readonly shapes: ShapeScheme
  readonly spacing: SpacingScheme
  readonly motion: MotionScheme
  readonly elevation: ElevationScheme
}

const lightColors: ColorScheme = {
  primary: '#0057B8', onPrimary: '#FFFFFF', primaryContainer: '#D7E3FF', onPrimaryContainer: '#001B3F',
  secondary: '#4B5F7A', onSecondary: '#FFFFFF', secondaryContainer: '#D3E4FF', onSecondaryContainer: '#041C35',
  tertiary: '#715574', onTertiary: '#FFFFFF', tertiaryContainer: '#FBD7FC', onTertiaryContainer: '#29132E',
  error: '#BA1A1A', onError: '#FFFFFF', errorContainer: '#FFDAD6', onErrorContainer: '#410002',
  background: '#FDFBFF', onBackground: '#1A1C1E', surface: '#FDFBFF', onSurface: '#1A1C1E',
  surfaceVariant: '#E0E2EC', onSurfaceVariant: '#43474E', outline: '#74777F', outlineVariant: '#C4C6CF',
  inverseSurface: '#2F3033', inverseOnSurface: '#F1F0F4', inversePrimary: '#AAC7FF', scrim: '#000000', shadow: '#000000'
}

const darkColors: ColorScheme = {
  primary: '#AAC7FF', onPrimary: '#002F66', primaryContainer: '#00458F', onPrimaryContainer: '#D7E3FF',
  secondary: '#B3C8E8', onSecondary: '#1D344E', secondaryContainer: '#344B65', onSecondaryContainer: '#D3E4FF',
  tertiary: '#DEBCDF', onTertiary: '#402843', tertiaryContainer: '#583E5B', onTertiaryContainer: '#FBD7FC',
  error: '#FFB4AB', onError: '#690005', errorContainer: '#93000A', onErrorContainer: '#FFDAD6',
  background: '#111318', onBackground: '#E2E2E9', surface: '#111318', onSurface: '#E2E2E9',
  surfaceVariant: '#43474E', onSurfaceVariant: '#C4C6CF', outline: '#8E9099', outlineVariant: '#43474E',
  inverseSurface: '#E2E2E9', inverseOnSurface: '#2F3033', inversePrimary: '#0057B8', scrim: '#000000', shadow: '#000000'
}

const typography: TypographyScheme = {
  displayLarge: style('3.5rem', 400, '4rem', '-0.02em'),
  headlineLarge: style('2rem', 500, '2.5rem', '-0.01em'),
  titleLarge: style('1.375rem', 600, '1.75rem', '0'),
  bodyLarge: style('1rem', 400, '1.5rem', '0.01em'),
  bodyMedium: style('0.875rem', 400, '1.25rem', '0.01em'),
  labelLarge: style('0.875rem', 600, '1.25rem', '0.02em'),
  labelSmall: style('0.6875rem', 600, '1rem', '0.04em')
}

const shapes: ShapeScheme = {
  none: '0', extraSmall: '0.25rem', small: '0.5rem', medium: '0.75rem',
  large: '1rem', extraLarge: '1.75rem', full: '9999px'
}

const spacing: SpacingScheme = {
  none: '0', extraSmall: '0.25rem', small: '0.5rem', medium: '1rem', large: '1.5rem', extraLarge: '2rem'
}

const motion: MotionScheme = {
  preference: 'full', durationShort: '120ms', durationMedium: '240ms', durationLong: '400ms',
  easingStandard: 'cubic-bezier(0.2, 0, 0, 1)', easingEmphasized: 'cubic-bezier(0.2, 0, 0, 1.2)'
}

const elevation: ElevationScheme = {
  level0: 'none', level1: '0 1px 2px rgb(0 0 0 / 0.16)', level2: '0 2px 6px rgb(0 0 0 / 0.18)',
  level3: '0 4px 12px rgb(0 0 0 / 0.2)', level4: '0 8px 20px rgb(0 0 0 / 0.22)',
  level5: '0 12px 32px rgb(0 0 0 / 0.24)'
}

const colorKeys = Object.freeze([
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'secondary', 'onSecondary',
  'secondaryContainer', 'onSecondaryContainer', 'tertiary', 'onTertiary', 'tertiaryContainer',
  'onTertiaryContainer', 'error', 'onError', 'errorContainer', 'onErrorContainer', 'background',
  'onBackground', 'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant', 'outline',
  'outlineVariant', 'inverseSurface', 'inverseOnSurface', 'inversePrimary', 'scrim', 'shadow'
] satisfies readonly (keyof ColorScheme)[])
const typographyKeys = Object.freeze([
  'displayLarge', 'headlineLarge', 'titleLarge', 'bodyLarge', 'bodyMedium', 'labelLarge', 'labelSmall'
] satisfies readonly (keyof TypographyScheme)[])
const typographyStyleKeys = Object.freeze([
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'
] satisfies readonly (keyof TypographyStyle)[])
const shapeKeys = Object.freeze([
  'none', 'extraSmall', 'small', 'medium', 'large', 'extraLarge', 'full'
] satisfies readonly (keyof ShapeScheme)[])
const spacingKeys = Object.freeze([
  'none', 'extraSmall', 'small', 'medium', 'large', 'extraLarge'
] satisfies readonly (keyof SpacingScheme)[])
const motionKeys = Object.freeze([
  'preference', 'durationShort', 'durationMedium', 'durationLong', 'easingStandard', 'easingEmphasized'
] satisfies readonly (keyof MotionScheme)[])
const elevationKeys = Object.freeze([
  'level0', 'level1', 'level2', 'level3', 'level4', 'level5'
] satisfies readonly (keyof ElevationScheme)[])

export function createLightColorScheme(overrides: DeepPartial<ColorScheme> = {}): ColorScheme {
  return deepFreeze(deepMerge<ColorScheme>(lightColors, overrides))
}

export function createDarkColorScheme(overrides: DeepPartial<ColorScheme> = {}): ColorScheme {
  return deepFreeze(deepMerge<ColorScheme>(darkColors, overrides))
}

export function createTheme(overrides: DeepPartial<KvtTheme> = {}): KvtTheme {
  const base: KvtTheme = { colors: createLightColorScheme(), typography, shapes, spacing, motion, elevation }
  const theme = deepFreeze(deepMerge<KvtTheme>(base, overrides))
  validateTheme(theme)
  return theme
}

export const lightTheme = createTheme()
export const darkTheme = createTheme({ colors: createDarkColorScheme() })

export function withMotionPreference(theme: KvtTheme, preference: MotionPreference): KvtTheme {
  if (preference === 'full') return createTheme(theme)
  const durations = preference === 'none'
    ? { durationShort: '0ms', durationMedium: '0ms', durationLong: '0ms' }
    : { durationShort: '40ms', durationMedium: '80ms', durationLong: '120ms' }
  return createTheme({ ...theme, motion: { ...theme.motion, ...durations, preference } })
}

export function validateTheme(theme: KvtTheme): void {
  assertExactKeys(theme, ['colors', 'typography', 'shapes', 'spacing', 'motion', 'elevation'], 'theme')
  assertExactKeys(theme.colors, colorKeys, 'colors')
  assertExactKeys(theme.typography, typographyKeys, 'typography')
  assertExactKeys(theme.shapes, shapeKeys, 'shapes')
  assertExactKeys(theme.spacing, spacingKeys, 'spacing')
  assertExactKeys(theme.motion, motionKeys, 'motion')
  assertExactKeys(theme.elevation, elevationKeys, 'elevation')
  validateRecord(theme.colors, 'colors')
  validateRecord(theme.typography, 'typography')
  validateRecord(theme.shapes, 'shapes')
  validateRecord(theme.spacing, 'spacing')
  validateRecord(theme.motion, 'motion')
  validateRecord(theme.elevation, 'elevation')
  for (const key of Object.keys(theme.colors) as Array<keyof ColorScheme>) {
    const color = theme.colors[key]
    if (!isCssColor(color)) throw new TypeError(`Invalid CSS color at colors.${key}`)
  }
  for (const key of typographyKeys) {
    assertExactKeys(theme.typography[key], typographyStyleKeys, `typography.${key}`)
    if (!Number.isFinite(theme.typography[key].fontWeight) || theme.typography[key].fontWeight < 1) {
      throw new TypeError(`Invalid font weight at typography.${key}.fontWeight`)
    }
  }
  if (!['full', 'reduced', 'none'].includes(theme.motion.preference)) {
    throw new TypeError(`Invalid motion preference: ${String(theme.motion.preference)}`)
  }
}

export interface ContrastFailure {
  readonly foreground: keyof ColorScheme
  readonly background: keyof ColorScheme
  readonly ratio: number
  readonly required: number
}

const documentedPairs: ReadonlyArray<readonly [keyof ColorScheme, keyof ColorScheme]> = [
  ['onPrimary', 'primary'], ['onPrimaryContainer', 'primaryContainer'], ['onSecondary', 'secondary'],
  ['onSecondaryContainer', 'secondaryContainer'], ['onTertiary', 'tertiary'], ['onError', 'error'],
  ['onErrorContainer', 'errorContainer'], ['onBackground', 'background'], ['onSurface', 'surface'],
  ['onSurfaceVariant', 'surfaceVariant'], ['inverseOnSurface', 'inverseSurface']
]

export function validateThemeContrast(theme: KvtTheme, required = 4.5): readonly ContrastFailure[] {
  const failures: ContrastFailure[] = []
  for (const [foreground, background] of documentedPairs) {
    const ratio = contrastRatio(theme.colors[foreground], theme.colors[background])
    if (ratio < required) failures.push({ foreground, background, ratio, required })
  }
  return Object.freeze(failures)
}

export function contrastRatio(foreground: string, background: string): number {
  const first = luminance(parseHex(foreground))
  const second = luminance(parseHex(background))
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

export function themeToCssVariables(theme: KvtTheme): Readonly<Record<`--kvt-${string}`, string>> {
  validateTheme(theme)
  const variables: Record<`--kvt-${string}`, string> = {} as Record<`--kvt-${string}`, string>
  flattenVariables(theme as unknown as Record<string, unknown>, [], variables)
  return Object.freeze(variables)
}

export function themeToCssText(theme: KvtTheme, selector = ':host'): string {
  if (selector.trim().length === 0 || selector.includes('{') || selector.includes('}')) throw new TypeError('Invalid CSS selector')
  const declarations = Object.entries(themeToCssVariables(theme)).map(([key, value]) => `${key}:${value};`).join('')
  return `${selector}{${declarations}}`
}

export const KVT_THEME_SERIALIZATION_VERSION = 1 as const

export interface SerializedTheme {
  readonly version: typeof KVT_THEME_SERIALIZATION_VERSION
  readonly theme: KvtTheme
}

export function serializeTheme(theme: KvtTheme): SerializedTheme {
  validateTheme(theme)
  return deepFreeze({ version: KVT_THEME_SERIALIZATION_VERSION, theme })
}

export interface ThemeMigration {
  readonly fromVersion: number
  readonly toVersion: number
  readonly migrate: (value: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>
}

export function deserializeTheme(value: unknown, migrations: readonly ThemeMigration[] = []): KvtTheme {
  if (!isRecord(value) || !Number.isSafeInteger(value.version) || !isRecord(value.theme)) {
    throw new TypeError('Unsupported or invalid serialized theme')
  }
  let version = value.version as number
  let serialized = value.theme
  const byVersion = new Map<number, ThemeMigration>()
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.fromVersion) || !Number.isSafeInteger(migration.toVersion)
      || migration.toVersion !== migration.fromVersion + 1) {
      throw new TypeError('Theme migrations must advance exactly one integer version')
    }
    if (byVersion.has(migration.fromVersion)) throw new Error(`Duplicate theme migration from version ${migration.fromVersion}`)
    byVersion.set(migration.fromVersion, migration)
  }
  while (version < KVT_THEME_SERIALIZATION_VERSION) {
    const migration = byVersion.get(version)
    if (!migration) throw new TypeError(`Missing theme migration from version ${version}`)
    serialized = migration.migrate(serialized)
    if (!isRecord(serialized)) throw new TypeError(`Theme migration from version ${version} returned an invalid value`)
    version = migration.toVersion
  }
  if (version !== KVT_THEME_SERIALIZATION_VERSION) throw new TypeError(`Unsupported theme version: ${version}`)
  return createTheme(serialized as DeepPartial<KvtTheme>)
}

export class ThemeSchemeRegistry {
  readonly #schemes = new Map<string, KvtTheme>()

  register(id: string, theme: KvtTheme): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new TypeError(`Invalid scheme id: ${id}`)
    if (this.#schemes.has(id)) throw new Error(`Theme scheme already exists: ${id}`)
    this.#schemes.set(id, createTheme(theme))
  }

  get(id: string): KvtTheme | undefined {
    return this.#schemes.get(id)
  }
}

function style(fontSize: string, fontWeight: number, lineHeight: string, letterSpacing: string): TypographyStyle {
  return { fontFamily: 'system-ui, sans-serif', fontSize, fontWeight, lineHeight, letterSpacing }
}

function deepMerge<T>(base: T, override: DeepPartial<T>): T {
  if (!isRecord(base) || !isRecord(override)) return (override ?? base) as T
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) result[key] = isRecord(result[key]) && isRecord(value) ? deepMerge(result[key], value) : value
  }
  return result as T
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function validateRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`)
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === null || (typeof child !== 'string' && typeof child !== 'number' && !isRecord(child))) {
      throw new TypeError(`Invalid theme value at ${path}.${key}`)
    }
  }
}

function assertExactKeys(value: object, expected: readonly string[], path: string): void {
  const actual = Object.keys(value)
  const missing = expected.filter((key) => !Object.hasOwn(value, key))
  const unknown = actual.filter((key) => !expected.includes(key))
  if (missing.length > 0 || unknown.length > 0) {
    throw new TypeError(`Invalid ${path} keys; missing=[${missing.join(',')}], unknown=[${unknown.join(',')}]`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCssColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value)
    || /^(?:rgb|hsl|oklch|color)\(/.test(value)
    || /^[a-zA-Z]+$/.test(value)
}

function parseHex(value: string): readonly [number, number, number] {
  const match = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})/.exec(value)
  if (!match) throw new TypeError('Contrast validation currently requires hexadecimal colors')
  return [Number.parseInt(match[1] ?? '0', 16), Number.parseInt(match[2] ?? '0', 16), Number.parseInt(match[3] ?? '0', 16)]
}

function luminance(color: readonly [number, number, number]): number {
  const channels = color.map((value) => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

function flattenVariables(
  value: Record<string, unknown>,
  path: readonly string[],
  output: Record<`--kvt-${string}`, string>
): void {
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, kebabCase(key)]
    if (isRecord(child)) flattenVariables(child, nextPath, output)
    else output[`--kvt-${nextPath.join('-')}`] = String(child)
  }
}

function kebabCase(value: string): string {
  return value.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}
