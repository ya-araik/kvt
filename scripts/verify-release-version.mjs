import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const expected = process.argv[2]
if (!expected) throw new Error('Expected version argument is required')
if (expected !== '1.0.0') throw new Error(`The first public release must be exactly 1.0.0, received ${expected}`)
const root = JSON.parse(await readFile('package.json', 'utf8'))
if (root.version !== expected) throw new Error(`Root version ${root.version} does not match release ${expected}`)
validateMetadata(root, 'root package')
for (const entry of await readdir('packages', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  try {
    const manifest = JSON.parse(await readFile(join('packages', entry.name, 'package.json'), 'utf8'))
    if (!manifest.private && manifest.version !== expected) {
      throw new Error(`${manifest.name} version ${manifest.version} does not match release ${expected}`)
    }
    if (!manifest.private) {
      validateMetadata(manifest, manifest.name)
      if (manifest.author !== 'Araik Gukasyan' || manifest.license !== 'MIT') {
        throw new Error(`${manifest.name} must retain the Araik Gukasyan MIT attribution`)
      }
      if (manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.provenance !== true) {
        throw new Error(`${manifest.name} must publish publicly with provenance`)
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
    throw error
  }
}
console.log(`All public package versions match ${expected}.`)

function validateMetadata(manifest, label) {
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  for (const [field, value] of Object.entries({ repository, homepage: manifest.homepage, bugs: manifest.bugs?.url })) {
    const publicUrl = typeof value === 'string' ? value.replace(/^git\+/, '') : value
    if (typeof publicUrl !== 'string' || !/^https:\/\//.test(publicUrl) || /(?:example\.com|your[-_/]|todo)/i.test(publicUrl)) {
      throw new Error(`${label} requires a real public ${field} URL before release`)
    }
  }
}
