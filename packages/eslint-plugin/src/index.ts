import type { ESLint, Linter, Rule } from 'eslint'
import { dirname, resolve } from 'node:path'

type CleanLayer = 'domain' | 'data' | 'presentation' | 'app'
type DomainLayer = 'model' | 'repository' | 'usecase'

const layerRank: Readonly<Record<DomainLayer, number>> = {
  model: 0,
  repository: 1,
  usecase: 2
}

const architectureBoundaries: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce KVT Clean Architecture dependency direction.' },
    schema: [],
    messages: {
      outward: '{{source}} must not depend on outer {{target}} layer.',
      domainOutward: 'domain/{{source}} must not depend on domain/{{target}}.',
      renderer: '{{source}} layer must not import renderer package {{dependency}}.',
      modelPackage: 'domain/model must not import framework package {{dependency}}.',
      repositoryBypass: 'Presentation must use a use case instead of importing a repository port directly.'
    }
  },
  create(context) {
    const filename = normalize(context.filename)
    const sourceLayer = cleanLayer(filename)
    const sourceDomainLayer = domainLayer(filename)

    const checkImport = (node: Rule.Node, dependency: string): void => {
      if (!sourceLayer) return
      if (!dependency.startsWith('.')) {
        if (sourceDomainLayer === 'model') {
          context.report({ node, messageId: 'modelPackage', data: { dependency } })
        } else if ((sourceLayer === 'domain' || sourceLayer === 'data')
          && (dependency === 'react' || dependency.startsWith('react-'))) {
          context.report({ node, messageId: 'renderer', data: { source: sourceLayer, dependency } })
        }
        return
      }

      const target = normalize(resolve(dirname(filename), dependency))
      const targetLayer = cleanLayer(target)
      if (!targetLayer) return
      if (sourceLayer === 'domain' && targetLayer !== 'domain') {
        context.report({ node, messageId: 'outward', data: { source: sourceLayer, target: targetLayer } })
      }
      if (sourceLayer === 'data' && (targetLayer === 'presentation' || targetLayer === 'app')) {
        context.report({ node, messageId: 'outward', data: { source: sourceLayer, target: targetLayer } })
      }
      if (sourceLayer === 'presentation' && (targetLayer === 'data' || targetLayer === 'app')) {
        context.report({ node, messageId: 'outward', data: { source: sourceLayer, target: targetLayer } })
      }
      if (sourceLayer === 'presentation' && target.includes('/src/domain/repository/')) {
        context.report({ node, messageId: 'repositoryBypass' })
      }
      if (sourceLayer === 'domain' && targetLayer === 'domain' && sourceDomainLayer) {
        const targetDomainLayer = domainLayer(target)
        if (targetDomainLayer && layerRank[targetDomainLayer] > layerRank[sourceDomainLayer]) {
          context.report({
            node,
            messageId: 'domainOutward',
            data: { source: sourceDomainLayer, target: targetDomainLayer }
          })
        }
      }
    }

    return {
      ImportDeclaration(node) {
        const dependency = sourceValue(node)
        if (dependency) checkImport(node, dependency)
      },
      ImportExpression(node) {
        const dependency = sourceValue(node)
        if (dependency) checkImport(node, dependency)
      },
      ExportNamedDeclaration(node) {
        const dependency = sourceValue(node)
        if (dependency) checkImport(node, dependency)
      },
      ExportAllDeclaration(node) {
        const dependency = sourceValue(node)
        if (dependency) checkImport(node, dependency)
      }
    }
  }
}

const errorModelLocation: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep domain and UI error models in their canonical model layers.' },
    schema: [],
    messages: {
      domain: 'Business error models belong in domain/model/failure.',
      presentation: 'UI error models belong in presentation/model.'
    }
  },
  create(context) {
    const filename = normalize(context.filename)
    const sourceLayer = cleanLayer(filename)
    const sourceDomainLayer = domainLayer(filename)

    const checkDeclaration = (node: Rule.Node): void => {
      const name = declarationName(node)
      if (!name) return
      if ((sourceDomainLayer === 'repository' || sourceDomainLayer === 'usecase')
        && /(?:Failure|Error)$/u.test(name)) {
        context.report({ node, messageId: 'domain' })
      }
      if (sourceLayer === 'presentation' && !filename.includes('/src/presentation/model/')
        && /(?:UiFailure|UiError)$/u.test(name)) {
        context.report({ node, messageId: 'presentation' })
      }
    }

    return {
      TSTypeAliasDeclaration: checkDeclaration,
      TSInterfaceDeclaration: checkDeclaration,
      ClassDeclaration: checkDeclaration
    }
  }
}

const legacyApiNames = new Set([
  'Module',
  'Provides',
  'Inject',
  'Singleton',
  'ViewModelProvider',
  'createModuleFromClass',
  'createViewModelKey',
  'defineViewModel',
  'KvtViewModelScope',
  'provideSingleton',
  'provideScoped',
  'provideTransient',
  'provideAsyncSingleton',
  'provideAsyncScoped',
  'provideAsyncTransient',
  'provideAlias',
  'provideValue'
])

const noLegacyApi: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow removed KVT prototype APIs and manual route ownership flags.' },
    schema: [],
    messages: {
      api: '{{name}} was removed from KVT 1.0.',
      route: 'KVT route owners and scopes are automatic; remove {{name}}.'
    }
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const dependency = sourceValue(node)
        if (!dependency?.startsWith('@kvt/')) return

        const declaration = node as Rule.Node & {
          readonly specifiers?: readonly Rule.Node[]
        }
        for (const specifier of declaration.specifiers ?? []) {
          const name = importSpecifierName(specifier)
          if (name && legacyApiNames.has(name)) {
            context.report({ node: specifier, messageId: 'api', data: { name } })
          }
        }
      },
      Property(node) {
        const property = propertyParts(node)
        if (property?.name === 'scope' && property.value === 'route') {
          context.report({ node, messageId: 'route', data: { name: "scope: 'route'" } })
        }
        if (property?.name === 'viewModelOwner' && property.value === true) {
          context.report({ node, messageId: 'route', data: { name: 'viewModelOwner: true' } })
        }
      }
    }
  }
}

export const rules = {
  'architecture-boundaries': architectureBoundaries,
  'error-model-location': errorModelLocation,
  'no-legacy-api': noLegacyApi
} satisfies ESLint.Plugin['rules']

const plugin: ESLint.Plugin = {
  meta: { name: '@kvt/eslint-plugin', version: '1.0.0' },
  rules
}

export const recommended: readonly Linter.Config[] = [
  {
    name: 'kvt/plugin',
    plugins: { kvt: plugin }
  },
  {
    name: 'kvt/recommended',
    files: ['**/src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'kvt/architecture-boundaries': 'error',
      'kvt/error-model-location': 'error',
      'kvt/no-legacy-api': 'error'
    }
  },
  {
    name: 'kvt/domain-host-boundary',
    files: ['**/src/domain/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error',
        { name: 'window', message: 'Domain code must not depend on a browser host.' },
        { name: 'document', message: 'Domain code must not depend on a browser host.' },
        { name: 'localStorage', message: 'Storage belongs behind a data-layer adapter.' },
        { name: 'sessionStorage', message: 'Storage belongs behind a data-layer adapter.' },
        { name: 'crypto', message: 'Host-specific ID generation belongs behind a data-layer adapter.' }
      ]
    }
  }
]

plugin.configs = { recommended: [...recommended] }

export default plugin

function normalize(value: string): string {
  return value.replaceAll('\\', '/')
}

function cleanLayer(filename: string): CleanLayer | undefined {
  for (const layer of ['domain', 'data', 'presentation', 'app'] as const) {
    if (filename.includes(`/src/${layer}/`)) return layer
  }
  return undefined
}

function domainLayer(filename: string): DomainLayer | undefined {
  for (const layer of ['model', 'repository', 'usecase'] as const) {
    if (filename.includes(`/src/domain/${layer}/`)) return layer
  }
  return undefined
}

function sourceValue(node: Rule.Node): string | undefined {
  const candidate = node as Rule.Node & {
    readonly source?: { readonly value?: unknown }
  }
  return typeof candidate.source?.value === 'string' ? candidate.source.value : undefined
}

function declarationName(node: Rule.Node): string | undefined {
  const candidate = node as Rule.Node & {
    readonly id?: { readonly name?: unknown }
  }
  return typeof candidate.id?.name === 'string' ? candidate.id.name : undefined
}

function importSpecifierName(node: Rule.Node): string | undefined {
  const candidate = node as Rule.Node & {
    readonly imported?: { readonly name?: unknown; readonly value?: unknown }
  }
  if (typeof candidate.imported?.name === 'string') return candidate.imported.name
  return typeof candidate.imported?.value === 'string' ? candidate.imported.value : undefined
}

function propertyParts(node: Rule.Node): { readonly name: string; readonly value: unknown } | undefined {
  const candidate = node as Rule.Node & {
    readonly computed?: boolean
    readonly key?: { readonly name?: unknown; readonly value?: unknown }
    readonly value?: { readonly value?: unknown }
  }
  if (candidate.computed) return undefined
  const name = typeof candidate.key?.name === 'string'
    ? candidate.key.name
    : typeof candidate.key?.value === 'string' ? candidate.key.value : undefined
  return name ? { name, value: candidate.value?.value } : undefined
}
