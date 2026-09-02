import { validateThemeContrast } from '@kvt/theme-core'
import { describe, expect, it } from 'vitest'
import { appThemeSchemes, themeSchemeRegistry } from './theme-schemes.js'

describe('showcase themes', () => {
  it.each(appThemeSchemes)('$label meets the documented contrast contract', (scheme) => {
    expect(themeSchemeRegistry.get(scheme.id)).toBeDefined()
    expect(validateThemeContrast(scheme.theme)).toEqual([])
  })
})
