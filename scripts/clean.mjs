import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

for (const root of ['packages', 'examples']) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) await rm(join(root, entry.name, 'dist'), { recursive: true, force: true })
  }
}
await rm('coverage', { recursive: true, force: true })
