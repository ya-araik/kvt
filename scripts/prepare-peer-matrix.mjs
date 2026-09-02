import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const peerPackages = ['react', 'react-dom', 'react-router', '@types/react', '@types/react-dom']
for (const root of ['packages', 'examples']) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const dependency of peerPackages) {
      await rm(join(root, entry.name, 'node_modules', dependency), { recursive: true, force: true })
    }
  }
}
console.log('Nested renderer peers removed; compatibility tests will use the root peer set.')
