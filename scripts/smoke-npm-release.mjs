import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const version = process.argv[2]
if (version !== '1.0.0') throw new Error('The 1.0 release smoke requires version 1.0.0')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const root = await mkdtemp(join(tmpdir(), 'kvt-npm-release-'))
try {
  for (const template of ['spa', 'ssr']) {
    const directory = resolve(root, template)
    retry(() => execFileSync(npm, ['exec', '--yes', `create-kvt@${version}`, '--', directory, template], { stdio: 'inherit' }))
    retry(() => execFileSync(npm, ['install', '--ignore-scripts'], { cwd: directory, stdio: 'inherit' }))
    execFileSync(npm, ['run', 'lint'], { cwd: directory, stdio: 'inherit' })
    execFileSync(npm, ['run', 'format:check'], { cwd: directory, stdio: 'inherit' })
    execFileSync(npm, ['run', 'build'], { cwd: directory, stdio: 'inherit' })
  }
  console.log(`Published KVT ${version} passed clean SPA and SSR npm installation smoke tests.`)
} finally {
  await rm(root, { recursive: true, force: true })
}

function retry(operation, attempts = 6) {
  let failure
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return operation() } catch (error) {
      failure = error
      if (attempt < attempts) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 5_000)
    }
  }
  throw failure
}
