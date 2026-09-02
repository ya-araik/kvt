import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateArtifact, generatorKinds, resolveProjectDirectory, runDoctor } from '../src/index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'kvt-cli-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('@kvt/cli', () => {
  it('generates composable feature artifacts without filename collisions', async () => {
    const directory = await temporaryDirectory()
    const modulePath = await generateArtifact('module', 'Users', directory)
    const featurePath = await generateArtifact('feature', 'Users', directory)
    const routePath = await generateArtifact('route', 'Users', directory)
    expect(new Set([modulePath, featurePath, routePath]).size).toBe(3)
    expect(modulePath).toBe(join(directory, 'src', 'app', 'di', 'users.module.ts'))
    expect(featurePath).toBe(join(directory, 'src', 'app', 'di', 'users.feature.ts'))
    expect(routePath).toBe(join(directory, 'src', 'app', 'navigation', 'users.route.ts'))
    expect(await readFile(featurePath, 'utf8')).toContain('./users.module.js')
    expect(await readFile(routePath, 'utf8')).toContain('satisfies RouteObject')
    expect(await readFile(routePath, 'utf8')).not.toContain("scope: 'route'")
    await expect(generateArtifact('module', 'Users', directory)).rejects.toThrow('Refusing to overwrite')
  })

  it('reports supported ESM and version configuration', async () => {
    const directory = await temporaryDirectory()
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      type: 'module',
      dependencies: { '@kvt/core': '1.0.0' },
      devDependencies: { typescript: '^6.0.0' }
    }))
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      module: 'NodeNext', moduleResolution: 'NodeNext'
    } }))
    const checks = await runDoctor(directory)
    expect(checks.filter((check) => check.status === 'failure')).toEqual([])
    expect(checks.find((check) => check.name === 'typescript-version')?.status).toBe('pass')
  })

  it('generates every supported artifact using normalized names', async () => {
    const directory = await temporaryDirectory()
    for (const kind of generatorKinds) {
      const path = await generateArtifact(kind, 'HTTP Users', directory)
      expect(path).toContain(kind === 'test' ? '__tests__' : 'http-users')
      expect(await readFile(path, 'utf8')).not.toHaveLength(0)
    }
    await expect(generateArtifact('unknown' as never, 'users', directory)).rejects.toThrow('Unknown generator')
    await expect(generateArtifact('module', '---', directory)).rejects.toThrow('must contain letters or numbers')
    expect(resolveProjectDirectory('nested')).toBe(join(process.cwd(), 'nested'))
  })

  it('places Clean Architecture artifacts into their canonical layers', async () => {
    const directory = await temporaryDirectory()
    await expect(generateArtifact('use-case', 'Add Todo', directory)).resolves.toBe(
      join(directory, 'src', 'domain', 'usecase', 'add-todo.use-case.ts')
    )
    expect(await readFile(
      join(directory, 'src', 'domain', 'model', 'failure', 'add-todo-failure.ts'),
      'utf8'
    )).toContain('type AddTodoFailure')
    expect(await readFile(
      join(directory, 'src', 'domain', 'usecase', 'add-todo.use-case.ts'),
      'utf8'
    )).toContain("../model/failure/add-todo-failure.js")
    await expect(generateArtifact('repository', 'Todo', directory)).resolves.toBe(
      join(directory, 'src', 'domain', 'repository', 'todo.repository.ts')
    )
    await expect(generateArtifact('view-model', 'Todo List', directory)).resolves.toBe(
      join(directory, 'src', 'presentation', 'viewmodel', 'todo-list.view-model.ts')
    )
    await expect(generateArtifact('query-definition', 'Todos', directory)).resolves.toBe(
      join(directory, 'src', 'data', 'query', 'todos.query.ts')
    )
  })

  it('reports actionable failures, warnings, decorators and missing runtime cleanup', async () => {
    const directory = await temporaryDirectory()
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      dependencies: {
        '@kvt/core': '^1.0.0', '@kvt/flow': '^2.0.0', react: '^17.0.0', typescript: '^5.6.0'
      }
    }))
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'ESNext' } }))
    await mkdir(join(directory, 'src', 'nested'), { recursive: true })
    await writeFile(join(directory, 'src', 'nested', 'app.tsx'), [
      '@Module()',
      'bootstrapKvt()',
      'renderToString(<KvtThemeProvider />)',
      'class ConcreteService {}',
      "createToken<ConcreteService>('service')",
      'bind(BadViewModel).singleton().viewModel()'
    ].join('\n'))
    const checks = await runDoctor(directory)
    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'esm', status: 'failure' }),
      expect.objectContaining({ name: 'version-alignment', status: 'failure' }),
      expect.objectContaining({ name: 'typescript-version', status: 'failure' }),
      expect.objectContaining({ name: 'react-version', status: 'failure' }),
      expect.objectContaining({ name: 'typescript-esm', status: 'warning' }),
      expect.objectContaining({ name: 'forbidden-decorators', status: 'failure' }),
      expect.objectContaining({ name: 'redundant-class-token', status: 'warning' }),
      expect.objectContaining({ name: 'provider-modifier-chain', status: 'failure' }),
      expect.objectContaining({ name: 'runtime-shutdown', status: 'warning' }),
      expect.objectContaining({ name: 'ssr-theme-bootstrap', status: 'warning' }),
      expect.objectContaining({ name: 'installed-packages', status: 'warning' })
    ]))
  })

  it('handles unreadable manifests and inspects installed package contracts', async () => {
    const missing = await temporaryDirectory()
    const missingChecks = await runDoctor(missing)
    expect(missingChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'package-json', status: 'failure' }),
      expect.objectContaining({ name: 'typescript-version', status: 'warning' }),
      expect.objectContaining({ name: 'typescript-esm', status: 'warning' })
    ]))

    const directory = await temporaryDirectory()
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      type: 'module', dependencies: { '@kvt/core': '1.0.0', '@kvt/demo': '1.0.0', react: '^19.0.0' }
    }))
    const scope = join(directory, 'node_modules', '@kvt')
    await mkdir(join(scope, 'core'), { recursive: true })
    await mkdir(join(scope, 'demo', 'node_modules', '@kvt'), { recursive: true })
    await mkdir(join(directory, 'another-core'), { recursive: true })
    await writeFile(join(scope, 'core', 'package.json'), JSON.stringify({ name: '@kvt/core', exports: { '.': './index.js' } }))
    await writeFile(join(directory, 'another-core', 'package.json'), JSON.stringify({ name: '@kvt/core' }))
    await symlink(join(directory, 'another-core'), join(scope, 'demo', 'node_modules', '@kvt', 'core'))
    await writeFile(join(scope, 'demo', 'package.json'), JSON.stringify({
      name: '@kvt/demo', peerDependencies: { missing: '^1.0.0' }
    }))
    const checks = await runDoctor(directory)
    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'package-exports', status: 'failure' }),
      expect.objectContaining({ name: 'peer-dependencies', status: 'failure' }),
      expect.objectContaining({ name: 'duplicate-core', status: 'failure' })
    ]))
  })

  it('executes doctor, generate and usage CLI branches', async () => {
    const directory = await temporaryDirectory()
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
    const originalArgv = process.argv
    const originalExitCode = process.exitCode
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      for (const arguments_ of [
        ['doctor', directory],
        ['generate', 'module'],
        ['generate', 'module', 'CLI User', directory],
        ['unknown'],
        []
      ]) {
        process.argv = ['node', 'kvt', ...arguments_]
        process.exitCode = undefined
        vi.resetModules()
        await import('../src/cli.ts')
      }
      expect(log).toHaveBeenCalled()
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage: kvt generate'))
    } finally {
      process.argv = originalArgv
      process.exitCode = originalExitCode
      log.mockRestore()
      error.mockRestore()
    }
  })
})
