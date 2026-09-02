import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { x as extractTar } from 'tar'
import { rollup } from 'rollup'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import webpack from 'webpack'

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packageRoot = join(repository, 'packages')
const packageDirectories = []
for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = join(packageRoot, entry.name)
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    if (!manifest.private) packageDirectories.push({ directory, name: manifest.name })
  } catch {
    // Empty directories left by a removed prototype are not packages.
  }
}

const temporary = await mkdtemp(join(tmpdir(), 'kvt-pack-'))
const fixtureModules = join(temporary, 'fixture', 'node_modules')

try {
  for (const packageDefinition of packageDirectories) {
    for (const requiredPath of ['dist/index.js', 'dist/index.js.map', 'dist/index.d.ts', 'dist/index.d.ts.map', 'README.md', 'LICENSE']) {
      await access(join(packageDefinition.directory, requiredPath))
    }
    const output = execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
      cwd: packageDefinition.directory,
      encoding: 'utf8'
    })
    const [manifest] = JSON.parse(output)
    const files = new Set(manifest.files.map((file) => file.path))
    for (const requiredPath of ['dist/index.js', 'dist/index.js.map', 'dist/index.d.ts', 'dist/index.d.ts.map', 'README.md', 'LICENSE']) {
      if (!files.has(requiredPath)) throw new Error(`${manifest.name}: ${requiredPath} is missing from npm package`)
    }
    const forbidden = manifest.files.find((file) => file.path.startsWith('src/') || file.path.startsWith('test/') || file.path.includes('node_modules'))
    if (forbidden) throw new Error(`${manifest.name}: unexpected packed file ${forbidden.path}`)
    const declaration = await readFile(join(packageDefinition.directory, 'dist/index.d.ts'), 'utf8')
    if (declaration.includes(repository) || declaration.includes('packages/')) throw new Error(`${manifest.name}: declaration leaks a workspace path`)
    const sourceMap = JSON.parse(await readFile(join(packageDefinition.directory, 'dist/index.js.map'), 'utf8'))
    if (!Array.isArray(sourceMap.sourcesContent) || sourceMap.sourcesContent.length === 0
      || sourceMap.sourcesContent.some((source) => typeof source !== 'string' || source.length === 0)) {
      throw new Error(`${manifest.name}: JavaScript source map must embed sourcesContent`)
    }

    const installDirectory = packageDefinition.name.startsWith('@kvt/')
      ? join(fixtureModules, '@kvt', packageDefinition.name.slice('@kvt/'.length))
      : join(fixtureModules, packageDefinition.name)
    await mkdir(dirname(installDirectory), { recursive: true })
    await extractTar({ file: join(temporary, manifest.filename), cwd: dirname(installDirectory) })
    await rename(join(dirname(installDirectory), 'package'), installDirectory)
    console.log(`${manifest.name}: ${manifest.entryCount} files, ${manifest.size} bytes packed`)
  }

  const externalPackages = [
    'react',
    'react-dom',
    'react-router',
    '@tanstack/query-core',
    '@opentelemetry/api',
    '@testing-library/react',
    '@testing-library/dom',
    '@playwright/test',
    '@eslint/js',
    '@types/node',
    '@types/react',
    '@types/react-dom',
    '@tailwindcss/vite',
    '@vitejs/plugin-react',
    'eslint',
    'eslint-config-prettier',
    'eslint-plugin-react-hooks',
    'eslint-plugin-react-refresh',
    'globals',
    'prettier',
    'tailwindcss',
    'typescript',
    'typescript-eslint',
    'vite',
    'vitest',
    'rollup',
    'webpack'
  ]
  for (const name of externalPackages) {
    const source = join(repository, 'node_modules', name)
    const destination = join(fixtureModules, name)
    await mkdir(dirname(destination), { recursive: true })
    await symlink(source, destination, 'junction').catch(() => undefined)
  }

  const imports = packageDirectories.map(({ name }) => `import(${JSON.stringify(name)})`).join(',')
  execFileSync(process.execPath, ['--input-type=module', '--eval', `await Promise.all([${imports}])`], {
    cwd: join(temporary, 'fixture'),
    stdio: 'inherit'
  })
  console.log('Packed ESM imports succeeded without KVT workspace symlinks.')

  for (const template of ['core', 'spa', 'ssr']) {
    const project = join(temporary, `template-${template}`)
    execFileSync(process.execPath, [join(fixtureModules, 'create-kvt', 'dist', 'cli.js'), project, template], {
      cwd: temporary,
      stdio: 'inherit'
    })
    await symlink(fixtureModules, join(project, 'node_modules'), 'junction')
    execFileSync(process.execPath, [join(fixtureModules, 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json', ...(template === 'core' ? [] : ['--noEmit'])], {
      cwd: project,
      stdio: 'inherit'
    })
    execFileSync(process.execPath, [join(fixtureModules, 'vitest', 'vitest.mjs'), 'run'], {
      cwd: project,
      stdio: 'inherit'
    })
    execFileSync(process.execPath, [join(fixtureModules, 'eslint', 'bin', 'eslint.js'), '.', '--max-warnings=0'], {
      cwd: project,
      stdio: 'inherit'
    })
    execFileSync(process.execPath, [join(fixtureModules, 'prettier', 'bin', 'prettier.cjs'), '--check', '.'], {
      cwd: project,
      stdio: 'inherit'
    })
    if (template !== 'core') {
      execFileSync(process.execPath, [join(fixtureModules, 'vite', 'bin', 'vite.js'), 'build'], {
        cwd: project,
        stdio: 'inherit'
      })
    }
    if (template === 'ssr') {
      execFileSync(process.execPath, [join(fixtureModules, 'vite', 'bin', 'vite.js'), 'build', '--ssr', 'src/server.tsx'], {
        cwd: project,
        stdio: 'inherit'
      })
    }
    if (template === 'spa' && process.env.KVT_PACKAGE_E2E === '1') {
      execFileSync(npm, ['run', 'test:e2e', '--', '--workers=1'], {
        cwd: project,
        stdio: 'inherit'
      })
    }
    console.log(`create-kvt ${template} template built from packed artifacts.`)
  }

  const bundlerFixture = join(temporary, 'bundler-fixture')
  await mkdir(bundlerFixture, { recursive: true })
  await symlink(fixtureModules, join(bundlerFixture, 'node_modules'), 'junction')
  const bundlerInput = join(bundlerFixture, 'input.mjs')
  await writeFile(bundlerInput, [
    "export { bootstrapKvt, createToken } from '@kvt/core'",
    "export { MutableStateFlow, flowOf } from '@kvt/flow'",
    "export { createKvtQueryClient } from '@kvt/query'",
    "export { createTheme } from '@kvt/theme-core'",
    "export { KvtProvider } from '@kvt/react'",
    "export { createKvtMemoryRouter } from '@kvt/router-react'"
  ].join('\n'), 'utf8')

  const rollupBundle = await rollup({
    input: bundlerInput,
    plugins: [nodeResolve({ browser: true }), commonjs()],
    onwarn(warning, defaultHandler) {
      if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message)
      if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return
      defaultHandler(warning)
    }
  })
  await rollupBundle.write({ file: join(bundlerFixture, 'rollup.mjs'), format: 'es', sourcemap: true })
  await rollupBundle.close()

  await new Promise((resolveBuild, rejectBuild) => {
    webpack({
      mode: 'production',
      context: bundlerFixture,
      entry: bundlerInput,
      target: ['web', 'es2022'],
      experiments: { outputModule: true },
      output: {
        path: join(bundlerFixture, 'webpack'),
        filename: 'bundle.mjs',
        module: true,
        clean: true
      },
      devtool: 'source-map',
      optimization: { minimize: false }
    }, (error, stats) => {
      if (error) return rejectBuild(error)
      if (stats?.hasErrors()) return rejectBuild(new Error(stats.toString({ all: false, errors: true, errorDetails: true })))
      resolveBuild(undefined)
    })
  })
  for (const outputFile of [join(bundlerFixture, 'rollup.mjs'), join(bundlerFixture, 'webpack', 'bundle.mjs')]) {
    const output = await readFile(outputFile, 'utf8')
    if (/from\s+["']@kvt\//u.test(output)) throw new Error(`${outputFile} left a packed KVT dependency unresolved`)
  }
  console.log('Packed consumer entrypoint bundled with Rollup and Webpack.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
