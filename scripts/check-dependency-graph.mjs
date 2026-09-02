import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const packages = new Map()
for (const entry of await readdir('packages', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  try {
    const manifest = JSON.parse(await readFile(join('packages', entry.name, 'package.json'), 'utf8'))
    packages.set(manifest.name, manifest)
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
}

const edges = new Map([...packages.keys()].map((name) => [name, new Set()]))
for (const [name, manifest] of packages) {
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      if (packages.has(dependency)) edges.get(name).add(dependency)
    }
  }
}

const visiting = new Set()
const visited = new Set()
const visit = (name, path = []) => {
  if (visiting.has(name)) throw new Error(`Circular package dependency: ${[...path, name].join(' -> ')}`)
  if (visited.has(name)) return
  visiting.add(name)
  for (const dependency of edges.get(name)) visit(dependency, [...path, name])
  visiting.delete(name)
  visited.add(name)
}
for (const name of packages.keys()) visit(name)

const universal = ['@kvt/core', '@kvt/flow']
const forbidden = ['react', 'react-router', '@tanstack/query-core', '@opentelemetry/api', 'tailwindcss']
for (const name of universal) {
  const manifest = packages.get(name)
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest?.[field] ?? {})) {
      if (forbidden.includes(dependency)) throw new Error(`${name} must not depend on optional adapter ${dependency}`)
    }
  }
}

console.log(`Package dependency graph is acyclic (${packages.size} packages).`)
