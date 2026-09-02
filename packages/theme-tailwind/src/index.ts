const colorNames = [
  'primary', 'on-primary', 'primary-container', 'on-primary-container',
  'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
  'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
  'error', 'on-error', 'error-container', 'on-error-container',
  'background', 'on-background', 'surface', 'on-surface', 'surface-variant',
  'on-surface-variant', 'outline', 'outline-variant', 'inverse-surface',
  'inverse-on-surface', 'inverse-primary', 'scrim', 'shadow'
] as const

const typographyNames = [
  ['display-lg', 'display-large'],
  ['headline-lg', 'headline-large'],
  ['title-lg', 'title-large'],
  ['body-lg', 'body-large'],
  ['body-md', 'body-medium'],
  ['label-lg', 'label-large'],
  ['label-sm', 'label-small']
] as const

const shapeNames = [
  ['none', 'none'], ['xs', 'extra-small'], ['sm', 'small'], ['md', 'medium'],
  ['lg', 'large'], ['xl', 'extra-large'], ['full', 'full']
] as const

const spacingNames = [
  ['0', 'none'], ['xs', 'extra-small'], ['sm', 'small'], ['md', 'medium'],
  ['lg', 'large'], ['xl', 'extra-large']
] as const

export function createKvtTailwindThemeCss(): string {
  const mappings: string[] = colorNames.map((name) =>
    `  --color-kvt-${name}: var(--kvt-colors-${name});`
  )
  mappings.push('  --font-kvt-sans: var(--kvt-typography-body-large-font-family);')
  for (const [tailwindName, tokenName] of typographyNames) {
    mappings.push(
      `  --text-kvt-${tailwindName}: var(--kvt-typography-${tokenName}-font-size);`,
      `  --text-kvt-${tailwindName}--line-height: var(--kvt-typography-${tokenName}-line-height);`,
      `  --text-kvt-${tailwindName}--letter-spacing: var(--kvt-typography-${tokenName}-letter-spacing);`,
      `  --text-kvt-${tailwindName}--font-weight: var(--kvt-typography-${tokenName}-font-weight);`
    )
  }
  for (const [tailwindName, tokenName] of shapeNames) {
    mappings.push(`  --radius-kvt-${tailwindName}: var(--kvt-shapes-${tokenName});`)
  }
  for (const [tailwindName, tokenName] of spacingNames) {
    mappings.push(`  --spacing-kvt-${tailwindName}: var(--kvt-spacing-${tokenName});`)
  }
  for (let level = 0; level <= 5; level++) {
    mappings.push(`  --shadow-kvt-${level}: var(--kvt-elevation-level-${level});`)
  }
  mappings.push(
    '  --ease-kvt-standard: var(--kvt-motion-easing-standard);',
    '  --ease-kvt-emphasized: var(--kvt-motion-easing-emphasized);'
  )
  return `@theme inline {\n${mappings.join('\n')}\n}`
}
