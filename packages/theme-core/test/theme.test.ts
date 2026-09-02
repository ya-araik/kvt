import { describe, expect, it } from 'vitest'
import {
  ThemeSchemeRegistry,
  contrastRatio,
  createDarkColorScheme,
  createLightColorScheme,
  createTheme,
  darkTheme,
  deserializeTheme,
  lightTheme,
  serializeTheme,
  themeToCssText,
  themeToCssVariables,
  validateTheme,
  validateThemeContrast,
  withMotionPreference
} from '../src/index.js'

describe('@kvt/theme-core', () => {
  it('deep freezes partial themes and keeps one namespaced CSS schema', () => {
    const theme = createTheme({ shapes: { medium: '1rem' } })
    expect(theme.shapes.medium).toBe('1rem')
    expect(Object.isFrozen(theme)).toBe(true)
    expect(Object.isFrozen(theme.colors)).toBe(true)
    const variables = themeToCssVariables(theme)
    expect(variables['--kvt-colors-primary']).toBe(theme.colors.primary)
    expect(Object.keys(variables).every((key) => key.startsWith('--kvt-'))).toBe(true)
  })

  it('passes documented WCAG AA color pairs in standard schemes', () => {
    expect(validateThemeContrast(lightTheme)).toEqual([])
    expect(validateThemeContrast(darkTheme)).toEqual([])
  })

  it('round-trips versioned themes and disables decorative motion', () => {
    expect(deserializeTheme(serializeTheme(darkTheme))).toEqual(darkTheme)
    const none = withMotionPreference(lightTheme, 'none')
    expect(none.motion.durationLong).toBe('0ms')
    expect(none.motion.preference).toBe('none')
  })

  it('requires explicit sequential migrations and rejects unknown schema keys', () => {
    const legacy = { version: 0, theme: { colors: { brand: '#0057B8' } } }
    const migrated = deserializeTheme(legacy, [{
      fromVersion: 0,
      toVersion: 1,
      migrate: () => serializeTheme(lightTheme).theme
    }])
    expect(migrated).toEqual(lightTheme)
    expect(() => deserializeTheme(legacy)).toThrow('Missing theme migration')
    expect(() => deserializeTheme({
      ...serializeTheme(lightTheme),
      theme: { ...lightTheme, productSpecific: 'forbidden' }
    })).toThrow('unknown=[productSpecific]')
  })

  it('supports light/dark overrides, reduced motion, CSS text and contrast failures', () => {
    expect(createLightColorScheme({ primary: '#123456' }).primary).toBe('#123456')
    expect(createDarkColorScheme({ onSurface: 'rgb(1 2 3)' }).onSurface).toBe('rgb(1 2 3)')
    expect(withMotionPreference(lightTheme, 'full')).toEqual(lightTheme)
    expect(withMotionPreference(lightTheme, 'reduced').motion.durationMedium).toBe('80ms')
    expect(themeToCssText(lightTheme, '.root')).toMatch(/^\.root\{--kvt-/)
    expect(() => themeToCssText(lightTheme, '')).toThrow('Invalid CSS selector')
    expect(() => themeToCssText(lightTheme, 'a{color:red}')).toThrow('Invalid CSS selector')

    const lowContrast = createTheme({ colors: { primary: '#FFFFFF', onPrimary: '#FFFFFF' } })
    expect(validateThemeContrast(lowContrast)).toEqual(expect.arrayContaining([
      expect.objectContaining({ foreground: 'onPrimary', background: 'primary', ratio: 1 })
    ]))
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21)
    expect(() => contrastRatio('red', '#FFFFFF')).toThrow('requires hexadecimal')
  })

  it('validates malformed themes at every structural boundary', () => {
    const invalidValues: unknown[] = [
      { ...lightTheme, colors: { ...lightTheme.colors, primary: 'not a color!' } },
      { ...lightTheme, typography: { ...lightTheme.typography, bodyLarge: { ...lightTheme.typography.bodyLarge, fontWeight: 0 } } },
      { ...lightTheme, motion: { ...lightTheme.motion, preference: 'fast' } },
      { ...lightTheme, spacing: { ...lightTheme.spacing, medium: null } },
      { ...lightTheme, shapes: { ...lightTheme.shapes, unknown: '1px' } },
      { ...lightTheme, elevation: undefined }
    ]
    for (const value of invalidValues) expect(() => validateTheme(value as never)).toThrow(TypeError)
  })

  it('validates serialized envelopes and migration chains', () => {
    for (const value of [null, {}, { version: 1, theme: null }, { version: 1.5, theme: {} }]) {
      expect(() => deserializeTheme(value)).toThrow('Unsupported or invalid')
    }
    const legacy = { version: 0, theme: {} }
    expect(() => deserializeTheme(legacy, [{ fromVersion: 0, toVersion: 2, migrate: (value) => value }]))
      .toThrow('advance exactly one')
    expect(() => deserializeTheme(legacy, [
      { fromVersion: 0, toVersion: 1, migrate: () => ({}) },
      { fromVersion: 0, toVersion: 1, migrate: () => ({}) }
    ])).toThrow('Duplicate theme migration')
    expect(() => deserializeTheme(legacy, [{ fromVersion: 0, toVersion: 1, migrate: () => [] }]))
      .toThrow('returned an invalid value')
    expect(() => deserializeTheme({ version: 2, theme: lightTheme })).toThrow('Unsupported theme version')
  })

  it('registers immutable named custom schemes', () => {
    const registry = new ThemeSchemeRegistry()
    registry.register('brand.dark-1', darkTheme)
    expect(registry.get('brand.dark-1')).toEqual(darkTheme)
    expect(registry.get('missing')).toBeUndefined()
    expect(() => registry.register('Bad id', lightTheme)).toThrow('Invalid scheme id')
    expect(() => registry.register('brand.dark-1', lightTheme)).toThrow('already exists')
  })
})
