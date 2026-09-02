import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('create-kvt CLI', () => {
  it('creates a project and validates its arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-kvt-'))
    directories.push(root)
    const originalArgv = process.argv
    const originalExitCode = process.exitCode
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      process.argv = ['node', 'create-kvt', join(root, 'app'), 'core']
      vi.resetModules()
      await import('../src/cli.ts?valid')
      expect(await readFile(join(root, 'app', 'src/index.ts'), 'utf8')).toContain('bootstrapKvt')

      process.argv = ['node', 'create-kvt']
      process.exitCode = undefined
      vi.resetModules()
      await import('../src/cli.ts?missing')
      expect(process.exitCode).toBe(2)

      process.argv = ['node', 'create-kvt', join(root, 'invalid'), 'desktop']
      process.exitCode = undefined
      vi.resetModules()
      await import('../src/cli.ts?invalid')
      expect(error).toHaveBeenCalledWith('Usage: create-kvt <directory> [core|spa|ssr]')
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Created'))
    } finally {
      process.argv = originalArgv
      process.exitCode = originalExitCode
      log.mockRestore()
      error.mockRestore()
    }
  })
})
