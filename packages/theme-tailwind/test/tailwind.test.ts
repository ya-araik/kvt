import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createKvtTailwindThemeCss } from '../src/index.js'

describe('@kvt/theme-tailwind', () => {
  it('emits only namespaced Tailwind 4 semantic mappings', () => {
    const css = createKvtTailwindThemeCss()
    expect(css).toContain('@theme inline')
    expect(css).toContain('--color-kvt-primary: var(--kvt-colors-primary)')
    expect(css).toContain('--text-kvt-title-lg: var(--kvt-typography-title-large-font-size)')
    expect(css).toContain('--radius-kvt-lg: var(--kvt-shapes-large)')
    expect(css).toContain('--spacing-kvt-md: var(--kvt-spacing-medium)')
    expect(css).toContain('--shadow-kvt-3: var(--kvt-elevation-level-3)')
    expect(css).not.toMatch(/\b(?:html|body|\*)\s*\{/)
    expect(css).not.toContain('--primary:')
  })

  it('keeps the published CSS entrypoint synchronized with the TypeScript schema', async () => {
    const published = await readFile(new URL('../theme.css', import.meta.url), 'utf8')
    expect(published.trim()).toBe(createKvtTailwindThemeCss())
  })
})
