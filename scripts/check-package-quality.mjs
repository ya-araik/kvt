import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = join(repository, 'packages')

for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = join(packageRoot, entry.name)
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  if (manifest.private) continue
  execFileSync(process.execPath, [join(repository, 'node_modules', 'publint', 'src', 'cli.js'), 'run', '--strict', '--pack=false', directory], {
    cwd: repository,
    stdio: 'inherit'
  })
  execFileSync(process.execPath, [join(repository, 'node_modules', '@arethetypeswrong', 'cli', 'dist', 'index.js'), '--pack', directory, '--profile', 'esm-only', '--quiet'], {
    cwd: repository,
    stdio: 'inherit'
  })
  console.log(`${manifest.name}: publint and AreTheTypesWrong passed`)
}
