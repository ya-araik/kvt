import { access, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const generatorKinds = [
  'module', 'plugin', 'binding', 'provider', 'view-model', 'use-case', 'repository',
  'feature', 'route', 'theme-scheme', 'query-definition', 'test'
] as const

export type GeneratorKind = typeof generatorKinds[number]

export interface DoctorCheck {
  readonly name: string
  readonly status: 'pass' | 'warning' | 'failure'
  readonly message: string
}

export async function runDoctor(directory = process.cwd()): Promise<readonly DoctorCheck[]> {
  const checks: DoctorCheck[] = []
  const major = Number(process.versions.node.split('.')[0])
  checks.push({
    name: 'node-version',
    status: [20, 22, 24].includes(major) ? 'pass' : 'failure',
    message: `Node ${process.versions.node}; supported majors are 20, 22 and 24`
  })

  let packageJson: Record<string, unknown> = {}
  try {
    packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as Record<string, unknown>
    checks.push({ name: 'package-json', status: 'pass', message: 'package.json is readable' })
  } catch (error) {
    checks.push({ name: 'package-json', status: 'failure', message: `Cannot read package.json: ${String(error)}` })
  }
  checks.push({
    name: 'esm',
    status: packageJson.type === 'module' ? 'pass' : 'failure',
    message: packageJson.type === 'module' ? 'ESM package configured' : 'Set package.json type to module'
  })

  const dependencies = {
    ...asRecord(packageJson.dependencies),
    ...asRecord(packageJson.devDependencies),
    ...asRecord(packageJson.peerDependencies)
  }
  const versions = Object.entries(dependencies).filter(([name]) => name.startsWith('@kvt/'))
  const uniqueVersions = new Set(versions.map(([, version]) => String(version).replaceAll(/^[~^]/g, '')))
  checks.push({
    name: 'version-alignment',
    status: uniqueVersions.size <= 1 ? 'pass' : 'failure',
    message: uniqueVersions.size <= 1 ? 'KVT package versions are aligned' : `Mixed KVT versions: ${[...uniqueVersions].join(', ')}`
  })

  const typescriptVersion = String(dependencies.typescript ?? '')
  const typescriptMajorMinor = versionParts(typescriptVersion)
  checks.push({
    name: 'typescript-version',
    status: typescriptVersion.length === 0
      ? 'warning'
      : typescriptMajorMinor && (typescriptMajorMinor.major >= 6 || (typescriptMajorMinor.major === 5 && typescriptMajorMinor.minor >= 7))
        ? 'pass'
        : 'failure',
    message: typescriptVersion.length === 0 ? 'TypeScript is not declared' : `Declared TypeScript range: ${typescriptVersion}`
  })

  const reactVersion = String(dependencies.react ?? '')
  const reactMajor = versionParts(reactVersion)?.major
  if (reactVersion.length > 0) checks.push({
    name: 'react-version',
    status: reactMajor === 18 || reactMajor === 19 ? 'pass' : 'failure',
    message: `Declared React range: ${reactVersion}; supported majors are 18.3 and 19`
  })

  try {
    const tsconfig = JSON.parse(await readFile(join(directory, 'tsconfig.json'), 'utf8')) as { compilerOptions?: Record<string, unknown> }
    const module = tsconfig.compilerOptions?.module
    const resolution = tsconfig.compilerOptions?.moduleResolution
    checks.push({
      name: 'typescript-esm',
      status: module === 'NodeNext' && resolution === 'NodeNext' ? 'pass' : 'warning',
      message: 'Use module and moduleResolution NodeNext for published ESM libraries'
    })
  } catch {
    checks.push({ name: 'typescript-esm', status: 'warning', message: 'No root tsconfig.json was inspected' })
  }

  const sourceFiles = await findSourceFiles(join(directory, 'src')).catch(() => [])
  const decoratorPattern = /@(Module|Provides|Inject|Singleton|ViewModelProvider)\b/
  const decoratorFiles: string[] = []
  for (const path of sourceFiles) {
    if (decoratorPattern.test(await readFile(path, 'utf8'))) decoratorFiles.push(path)
  }
  checks.push({
    name: 'forbidden-decorators',
    status: decoratorFiles.length === 0 ? 'pass' : 'failure',
    message: decoratorFiles.length === 0 ? 'No legacy DI decorators found' : `Legacy decorators: ${decoratorFiles.join(', ')}`
  })

  const runtimeSources = await Promise.all(sourceFiles.map((path) => readFile(path, 'utf8')))
  const legacyDiPattern = /\b(?:provideSingleton|provideScoped|provideTransient|provideAsyncSingleton|provideAsyncScoped|provideAsyncTransient|createViewModelKey|defineViewModel)\b|\b(?:scope|viewModelOwner)\s*:\s*(?:'route'|true)/
  const legacyDiFiles = sourceFiles.filter((_, index) => legacyDiPattern.test(runtimeSources[index] ?? ''))
  checks.push({
    name: 'legacy-di-viewmodel-api',
    status: legacyDiFiles.length === 0 ? 'pass' : 'failure',
    message: legacyDiFiles.length === 0
      ? 'No legacy DI/ViewModel registration API found'
      : `Legacy DI/ViewModel API: ${legacyDiFiles.join(', ')}`
  })
  const viewModelBindings = runtimeSources.filter((source) => /class\s+\w+ViewModel\s+extends\s+ViewModel/.test(source))
  const hasViewModelModifier = runtimeSources.some((source) => /bind\(\w+ViewModel\)[\s\S]*?\.viewModel\(\)/.test(source))
  checks.push({
    name: 'view-model-bindings',
    status: viewModelBindings.length === 0 || hasViewModelModifier ? 'pass' : 'warning',
    message: viewModelBindings.length === 0 || hasViewModelModifier
      ? 'ViewModel registrations use .viewModel() where applicable'
      : 'ViewModel classes were found but no bind(...).viewModel() registration was detected'
  })
  const concreteClassTokenFiles = sourceFiles.filter((_, index) => {
    const source = runtimeSources[index] ?? ''
    const concreteClasses = [...source.matchAll(/(?:export\s+)?class\s+(\w+)/g)].map((match) => match[1])
    return concreteClasses.some((name) => name !== undefined && new RegExp(`createToken\\s*<\\s*${name}\\s*>`).test(source))
  })
  checks.push({
    name: 'redundant-class-token',
    status: concreteClassTokenFiles.length === 0 ? 'pass' : 'warning',
    message: concreteClassTokenFiles.length === 0
      ? 'No concrete classes are wrapped in redundant tokens'
      : `Use the class itself as DI identifier in: ${concreteClassTokenFiles.join(', ')}`
  })
  const incompatibleModifierFiles = sourceFiles.filter((_, index) => {
    const source = runtimeSources[index] ?? ''
    return /\.(?:singleton|scoped|transient)\(\)[\s\S]{0,120}\.viewModel\(\)|\.viewModel\(\)[\s\S]{0,120}\.(?:singleton|scoped|transient|eager)\(\)|\.transient\(\)[\s\S]{0,120}\.eager\(\)/.test(source)
  })
  checks.push({
    name: 'provider-modifier-chain',
    status: incompatibleModifierFiles.length === 0 ? 'pass' : 'failure',
    message: incompatibleModifierFiles.length === 0
      ? 'No incompatible provider modifier chains found'
      : `Incompatible provider modifier chains: ${incompatibleModifierFiles.join(', ')}`
  })
  const hasBootstrap = runtimeSources.some((source) => source.includes('bootstrapKvt('))
  const hasShutdown = runtimeSources.some((source) => /runtime\.shutdown\(|\.shutdown\(\{/.test(source))
  const hasBrowserProviderLifecycle = runtimeSources.some((source) => source.includes('KvtProvider'))
  checks.push({
    name: 'runtime-shutdown',
    status: !hasBootstrap || hasShutdown || hasBrowserProviderLifecycle ? 'pass' : 'warning',
    message: !hasBootstrap || hasShutdown || hasBrowserProviderLifecycle
      ? 'Runtime shutdown path, browser provider lifecycle or external runtime found'
      : 'bootstrapKvt is used but no runtime.shutdown path was detected'
  })

  const usesSsr = runtimeSources.some((source) => /renderTo(?:String|PipeableStream|ReadableStream)/.test(source))
  const usesTheme = runtimeSources.some((source) => source.includes('KvtThemeProvider'))
  const hasThemeBootstrap = runtimeSources.some((source) => source.includes('KvtThemeBootstrapScript')
    || source.includes('createThemePreHydrationScript'))
  checks.push({
    name: 'ssr-theme-bootstrap',
    status: !usesSsr || !usesTheme || hasThemeBootstrap ? 'pass' : 'warning',
    message: !usesSsr || !usesTheme || hasThemeBootstrap
      ? 'SSR/theme pre-hydration boundary is not missing'
      : 'SSR uses KvtThemeProvider without a pre-hydration theme script'
  })

  await inspectInstalledPackages(directory, dependencies, checks)
  return Object.freeze(checks)
}

export async function generateArtifact(kind: GeneratorKind, name: string, directory = process.cwd()): Promise<string> {
  if (!generatorKinds.includes(kind)) throw new TypeError(`Unknown generator: ${kind}`)
  const normalized = kebabCase(name)
  if (!normalized) throw new TypeError('Generator name must contain letters or numbers')
  const target = join(directory, 'src', ...generatorDirectory(kind))
  await mkdir(target, { recursive: true })
  const suffixes: Record<GeneratorKind, string> = {
    module: 'module', plugin: 'plugin', binding: 'binding', provider: 'provider', 'view-model': 'view-model',
    'use-case': 'use-case', repository: 'repository', feature: 'feature', route: 'route',
    'theme-scheme': 'theme', 'query-definition': 'query', test: 'test'
  }
  const path = join(target, `${normalized}.${suffixes[kind]}.ts`)
  const outputs = [{ path, source: template(kind, normalized) }, ...companionArtifacts(kind, normalized, directory)]
  for (const output of outputs) {
    try {
      await access(output.path)
      throw new Error(`Refusing to overwrite ${output.path}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Refusing')) throw error
    }
  }
  const written: string[] = []
  try {
    for (const output of outputs) {
      await mkdir(dirname(output.path), { recursive: true })
      await writeFile(output.path, output.source, { encoding: 'utf8', flag: 'wx' })
      written.push(output.path)
    }
  } catch (error) {
    await Promise.all(written.map((output) => rm(output, { force: true })))
    throw error
  }
  return path
}

function companionArtifacts(
  kind: GeneratorKind,
  name: string,
  directory: string
): readonly { readonly path: string; readonly source: string }[] {
  if (kind !== 'use-case') return []
  const symbol = pascalCase(name)
  return [{
    path: join(directory, 'src', 'domain', 'model', 'failure', `${name}-failure.ts`),
    source: `export type ${symbol}Failure = { readonly code: 'invalid-value' }\n`
  }]
}

function generatorDirectory(kind: GeneratorKind): readonly string[] {
  const directories: Record<GeneratorKind, readonly string[]> = {
    module: ['app', 'di'],
    plugin: ['app', 'plugin'],
    binding: ['app', 'di'],
    provider: ['app', 'di'],
    'view-model': ['presentation', 'viewmodel'],
    'use-case': ['domain', 'usecase'],
    repository: ['domain', 'repository'],
    feature: ['app', 'di'],
    route: ['app', 'navigation'],
    'theme-scheme': ['presentation', 'theme'],
    'query-definition': ['data', 'query'],
    test: ['__tests__']
  }
  return directories[kind]
}

function template(kind: GeneratorKind, name: string): string {
  const symbol = pascalCase(name)
  const templates: Record<GeneratorKind, string> = {
    module: `import { defineModule } from '@kvt/core'\n\nexport const ${camelCase(name)}Module = defineModule({\n  id: '${name}',\n  version: '1.0.0',\n  providers: []\n})\n`,
    plugin: `import { definePlugin } from '@kvt/core'\n\nexport const ${camelCase(name)}Plugin = definePlugin({\n  id: '${name}',\n  version: '1.0.0',\n  modules: []\n})\n`,
    binding: `import { bind } from '@kvt/core'\n\nexport abstract class ${symbol} {\n  abstract execute(): void\n}\n\nexport class Default${symbol} extends ${symbol} {\n  execute(): void {}\n}\n\nexport const ${camelCase(name)}Binding = bind(${symbol}).to(Default${symbol}).singleton()\n`,
    provider: `import { createToken, provide } from '@kvt/core'\n\nexport interface ${symbol}Config { readonly name: string }\nexport const ${camelCase(name)}Config = createToken<${symbol}Config>('${name}.config')\nexport const ${camelCase(name)}Provider = provide(${camelCase(name)}Config).value({ name: '${name}' })\n`,
    'view-model': `import { ViewModel } from '@kvt/core'\nimport { MutableStateFlow } from '@kvt/flow'\n\nexport class ${symbol}ViewModel extends ViewModel {\n  readonly #state = new MutableStateFlow({ ready: false })\n  readonly state = this.#state.asStateFlow()\n\n  protected override onStart(): void {\n    this.#state.set({ ready: true })\n  }\n}\n`,
    'use-case': `import { err, ok, type Result, type UseCase, type UseCaseContext } from '@kvt/core'\nimport type { ${symbol}Failure } from '../model/failure/${name}-failure.js'\n\nexport interface ${symbol}Input { readonly value: string }\n\nexport class ${symbol}UseCase implements UseCase<${symbol}Input, Result<void, ${symbol}Failure>> {\n  execute(input: ${symbol}Input, context: UseCaseContext): Result<void, ${symbol}Failure> {\n    context.signal.throwIfAborted()\n    return input.value.trim() ? ok() : err({ code: 'invalid-value' })\n  }\n}\n`,
    repository: `export abstract class ${symbol}Repository {\n  abstract load(signal: AbortSignal): Promise<void>\n}\n`,
    feature: `import type { FeatureDefinition } from '@kvt/core'\n\nexport const ${camelCase(name)}Feature: FeatureDefinition = {\n  id: '${name}',\n  version: '1.0.0',\n  load: async () => (await import('./${name}.module.js')).${camelCase(name)}Module\n}\n`,
    route: `import type { RouteObject } from 'react-router'\n\nexport const ${camelCase(name)}Route = {\n  path: '${name}',\n  lazy: () => import('./${name}.route-component.js')\n} satisfies RouteObject\n`,
    'theme-scheme': `import { createTheme } from '@kvt/theme-core'\n\nexport const ${camelCase(name)}Theme = createTheme({})\n`,
    'query-definition': `import { createQueryKey, type QueryDefinition } from '@kvt/query'\n\nexport const ${camelCase(name)}Query: QueryDefinition<unknown> = {\n  key: createQueryKey('${name}'),\n  query: async ({ signal }) => { signal.throwIfAborted(); return null }\n}\n`,
    test: `import { describe, expect, it } from 'vitest'\n\ndescribe('${name}', () => {\n  it('has a test', () => expect(true).toBe(true))\n})\n`
  }
  return templates[kind]
}

async function findSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await findSourceFiles(path))
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path)
  }
  return files
}

async function inspectInstalledPackages(
  directory: string,
  dependencies: Record<string, unknown>,
  checks: DoctorCheck[]
): Promise<void> {
  const scopeDirectory = join(directory, 'node_modules', '@kvt')
  let packageNames: string[]
  try {
    packageNames = (await readdir(scopeDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    checks.push({ name: 'installed-packages', status: 'warning', message: 'node_modules/@kvt is not installed; package checks skipped' })
    return
  }
  const coreLocations = new Set<string>()
  const rootCore = join(scopeDirectory, 'core', 'package.json')
  try { coreLocations.add(await realpath(rootCore)) } catch { /* core is optional for CLI-only consumers */ }
  let peerFailures = 0
  let exportFailures = 0
  for (const packageName of packageNames) {
    const packageDirectory = join(scopeDirectory, packageName)
    let manifest: Record<string, unknown>
    try { manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as Record<string, unknown> } catch { continue }
    if (!manifest.exports || typeof manifest.exports !== 'object') exportFailures++
    for (const peer of Object.keys(asRecord(manifest.peerDependencies))) {
      if (!Object.hasOwn(dependencies, peer)) peerFailures++
    }
    try { coreLocations.add(await realpath(join(packageDirectory, 'node_modules', '@kvt', 'core', 'package.json'))) } catch { /* hoisted */ }
  }
  checks.push({
    name: 'package-exports',
    status: exportFailures === 0 ? 'pass' : 'failure',
    message: exportFailures === 0 ? 'Installed KVT packages expose explicit exports' : `${exportFailures} installed KVT packages have no exports map`
  })
  checks.push({
    name: 'peer-dependencies',
    status: peerFailures === 0 ? 'pass' : 'failure',
    message: peerFailures === 0 ? 'Installed KVT peer dependencies are declared by the application' : `${peerFailures} KVT peer dependencies are not declared`
  })
  checks.push({
    name: 'duplicate-core',
    status: coreLocations.size <= 1 ? 'pass' : 'failure',
    message: coreLocations.size <= 1 ? 'No duplicate @kvt/core installation detected' : `Found ${coreLocations.size} physical @kvt/core installations`
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function kebabCase(value: string): string {
  return value.trim().replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').replaceAll(/[^A-Za-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').toLowerCase()
}
function versionParts(value: string): { readonly major: number; readonly minor: number } | undefined {
  const match = /(\d+)\.(\d+)/.exec(value)
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined
}
const pascalCase = (value: string): string => value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
const camelCase = (value: string): string => { const result = pascalCase(value); return result.charAt(0).toLowerCase() + result.slice(1) }

export function resolveProjectDirectory(path: string): string {
  return resolve(process.cwd(), path)
}
