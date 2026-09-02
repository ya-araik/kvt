import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = join(repository, 'packages')
const limits = new Map([
  ['@kvt/core', 15],
  ['@kvt/flow', 30],
  ['@kvt/react', 10],
  ['@kvt/router-react', 12],
  ['@kvt/theme-core', 15],
  ['@kvt/theme-react', 15],
  ['@kvt/theme-tailwind', 15],
  ['@kvt/query', 15],
  ['@kvt/otel', 15],
  ['@kvt/devtools-protocol', 15],
  ['@kvt/devtools-react', 15]
])

let failed = false
for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = join(packageRoot, entry.name)
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  const limit = limits.get(manifest.name)
  if (limit === undefined) continue
  const result = await build({
    entryPoints: [join(directory, 'dist', 'index.js')],
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external: ['@kvt/*', '@tanstack/*', '@opentelemetry/*', 'react', 'react/*', 'react-router', 'tailwindcss']
  })
  const bytes = gzipSync(result.outputFiles[0].contents, { level: 9 }).byteLength
  const kib = bytes / 1024
  console.log(`${manifest.name}: ${kib.toFixed(2)} KiB gzip / ${limit} KiB`)
  if (kib > limit) failed = true
}

if (failed) {
  console.error('One or more package bundle budgets were exceeded.')
  process.exitCode = 1
}
