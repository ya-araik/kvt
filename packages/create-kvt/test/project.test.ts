import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject } from '../src/project.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-kvt-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('create-kvt golden Todo projects', () => {
  it.each(['core', 'spa', 'ssr'] as const)('copies the %s template from real files', async (template) => {
    const directory = await temporaryDirectory()
    const target = join(directory, `${template}-todo`)
    await createProject(target, template, { kvtVersion: '9.8.7', packageManager: 'npm' })
    const manifest = await readFile(join(target, 'package.json'), 'utf8')
    const module = await readFile(join(target, 'src/app/di/todo-module.ts'), 'utf8')
    const eslint = await readFile(join(target, 'eslint.config.js'), 'utf8')
    const prettier = await readFile(join(target, 'prettier.config.mjs'), 'utf8')
    expect(manifest).toContain(`"name": "${template}-todo"`)
    expect(manifest).toContain('9.8.7')
    expect(manifest).toContain('"lint": "eslint . --max-warnings=0"')
    expect(manifest).toContain('"format:check": "prettier --check ."')
    expect(module).toContain('bind(TodoRepository)')
    expect(module).not.toContain('provideSingleton')
    expect(eslint).toContain("from '@kvt/eslint-plugin'")
    expect(eslint).toContain('kvt.configs.recommended')
    expect(prettier).toContain('singleQuote: true')
  })

  it('layers the SPA Todo architecture under the SSR request files', async () => {
    const directory = await temporaryDirectory()
    const target = join(directory, 'ssr-todo')
    await createProject(target, 'ssr')
    expect(await readFile(join(target, 'src/presentation/view/todo-page.tsx'), 'utf8')).toContain('useViewModel(TodoListViewModel)')
    expect(await readFile(join(target, 'src/domain/usecase/add-todo-use-case.ts'), 'utf8')).toContain('class AddTodoUseCase')
    expect(await readFile(join(target, 'src/domain/repository/todo-repository.ts'), 'utf8')).toContain('abstract class TodoRepository')
    expect(await readFile(join(target, 'src/domain/model/todo.ts'), 'utf8')).toContain('interface Todo')
    expect(await readFile(join(target, 'src/domain/model/failure/todo-use-case-failures.ts'), 'utf8')).toContain('type AddTodoFailure')
    expect(await readFile(join(target, 'src/server.tsx'), 'utf8')).toContain("reason: signal?.aborted ? 'request-aborted' : 'request-complete'")
  })

  it('never overwrites a non-empty destination', async () => {
    const directory = await temporaryDirectory()
    await writeFile(join(directory, 'occupied.txt'), 'owned by the user')
    await expect(createProject(directory, 'core')).rejects.toThrow('non-empty directory')
  })
})
