import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const packagesRoot = fileURLToPath(new URL('../packages/', import.meta.url))
const forbiddenProductTerm = ['kva', 'tum'].join('')
const universalPackages = new Set(['core', 'flow', 'theme-core', 'devtools-protocol'])
const forbiddenUniversalImports = [
  'react',
  'react-router',
  '@tanstack/',
  '@opentelemetry/',
  'tailwindcss',
  '@kvt/devtools-react'
]

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    if (['.git', 'coverage', 'dist', 'node_modules', 'playwright-report', 'temp', 'test-results'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (/\.(?:ts|tsx|js|mjs|css|md|json)$/.test(entry.name)) result.push(path)
  }
  return result
}

const violations = []
for (const path of await files(root)) {
  const source = await readFile(path, 'utf8')
  const display = relative(root, path).replaceAll('\\', '/')
  if (source.toLowerCase().includes(forbiddenProductTerm)) {
    violations.push(`${display}: contains product-specific naming`)
  }

  checkExampleArchitecture(path, display, source, violations)

  if (!path.startsWith(packagesRoot)) continue
  const packageName = relative(packagesRoot, path).split('/')[0]
  if (!packageName || !universalPackages.has(packageName)) continue
  for (const dependency of forbiddenUniversalImports) {
    if (source.includes(`from '${dependency}`) || source.includes(`from "${dependency}`)) {
      violations.push(`${display}: universal package imports ${dependency}`)
    }
  }
  if (/\b(?:window|document)\b/.test(source) && !/\.test\.[cm]?[jt]sx?$/.test(path)) {
    violations.push(`${display}: universal package references a browser global`)
  }
}

function checkExampleArchitecture(path, display, source, violations) {
  if (!display.startsWith('examples/') && !display.startsWith('packages/create-kvt/templates/')) return
  if (!display.includes('/src/')) return
  if (display.includes('/src/application/')) {
    violations.push(`${display}: use cases belong in domain/usecase, not application`)
  }
  if (/\/src\/domain\/[^/]+\.[cm]?[jt]sx?$/u.test(display)) {
    violations.push(`${display}: domain files must be split into model, repository or usecase`)
  }
  if (/\/src\/(?:data|presentation)\/[^/]+\.[cm]?[jt]sx?$/u.test(display)) {
    violations.push(`${display}: adapter files must be placed in a named responsibility subdirectory`)
  }

  const sourceLayer = cleanLayer(path)
  if (!sourceLayer) return
  const sourceDomainLayer = domainLayer(path)
  if ((sourceDomainLayer === 'repository' || sourceDomainLayer === 'usecase')
    && /export\s+(?:type|interface|class)\s+\w*(?:Failure|Error)\b/u.test(source)) {
    violations.push(`${display}: business error models belong in domain/model/failure`)
  }
  if (sourceLayer === 'presentation' && !display.includes('/src/presentation/model/')
    && /export\s+(?:type|interface|class)\s+\w*(?:UiError|UiFailure)\b/u.test(source)) {
    violations.push(`${display}: UI error models belong in presentation/model`)
  }
  if (sourceLayer === 'domain' && /\b(?:window|document|localStorage|sessionStorage|crypto)\b/u.test(source)) {
    violations.push(`${display}: domain layer references a host/framework global`)
  }
  for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/gu)) {
    const specifier = match[1]
    if (!specifier) continue
    if (!specifier.startsWith('.')) {
      if (sourceDomainLayer === 'model') {
        violations.push(`${display}: domain model must not depend on framework/package ${specifier}`)
      }
      if ((sourceLayer === 'domain' || sourceLayer === 'data') && (specifier === 'react' || specifier.startsWith('react-'))) {
        violations.push(`${display}: ${sourceLayer} layer must not import renderer ${specifier}`)
      }
      continue
    }
    const target = resolve(dirname(path), specifier)
    const targetLayer = cleanLayer(target)
    if (!targetLayer) continue
    if (sourceLayer === 'domain' && targetLayer !== 'domain') {
      violations.push(`${display}: domain dependency points outward to ${targetLayer}`)
    }
    if (sourceLayer === 'data' && (targetLayer === 'presentation' || targetLayer === 'app')) {
      violations.push(`${display}: data dependency points outward to ${targetLayer}`)
    }
    if (sourceLayer === 'presentation' && (targetLayer === 'data' || targetLayer === 'app')) {
      violations.push(`${display}: presentation must use domain ports, not ${targetLayer}`)
    }
    if (sourceLayer === 'domain' && targetLayer === 'domain') {
      const targetDomainLayer = domainLayer(target)
      const rank = { model: 0, repository: 1, usecase: 2 }
      if (sourceDomainLayer && targetDomainLayer && rank[targetDomainLayer] > rank[sourceDomainLayer]) {
        violations.push(`${display}: domain/${sourceDomainLayer} dependency points outward to domain/${targetDomainLayer}`)
      }
    }
  }
}

function cleanLayer(path) {
  const normalized = path.replaceAll('\\', '/')
  for (const layer of ['domain', 'data', 'presentation', 'app']) {
    if (normalized.includes(`/src/${layer}/`)) return layer
  }
  return undefined
}

function domainLayer(path) {
  const normalized = path.replaceAll('\\', '/')
  for (const layer of ['model', 'repository', 'usecase']) {
    if (normalized.includes(`/src/domain/${layer}/`)) return layer
  }
  return undefined
}

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exitCode = 1
} else {
  console.log('Package boundaries are clean.')
}
