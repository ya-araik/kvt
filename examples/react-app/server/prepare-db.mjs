import { copyFile, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDirectory = dirname(fileURLToPath(import.meta.url))
const seedPath = resolve(serverDirectory, 'seed.json')
const databasePath = resolve(serverDirectory, '.data/db.json')
const reset = process.argv.includes('--reset')

await mkdir(dirname(databasePath), { recursive: true })

if (reset || !(await exists(databasePath))) {
  await copyFile(seedPath, databasePath)
  console.log(`${reset ? 'Reset' : 'Created'} ${databasePath}`)
}

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
