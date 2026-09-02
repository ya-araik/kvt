import { ESLint } from 'eslint'
import { join } from 'node:path'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import kvt, { recommended } from '../src/index.js'

const fixtureRoot = join(process.cwd(), 'fixture')

function fixture(path: string): string {
  return join(fixtureRoot, path)
}

async function lint(code: string, filename: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser }
      },
      ...recommended
    ]
  })
  const [result] = await eslint.lintText(code, { filePath: filename })
  return result?.messages ?? []
}

describe('@kvt/eslint-plugin', () => {
  it('exports a self-contained recommended flat config', () => {
    expect(kvt.meta?.name).toBe('@kvt/eslint-plugin')
    expect(kvt.configs?.recommended).toEqual([...recommended])
  })

  it('rejects dependencies that point out of the domain', async () => {
    const messages = await lint(
      "import { MemoryTodoRepository } from '../../data/repository/memory-todo-repository.js'",
      fixture('src/domain/usecase/add-todo-use-case.ts')
    )
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'kvt/architecture-boundaries', messageId: 'outward' })
    ]))
  })

  it('rejects repository bypasses from presentation', async () => {
    const messages = await lint(
      "import { TodoRepository } from '../../domain/repository/todo-repository.js'",
      fixture('src/presentation/viewmodel/todo-view-model.ts')
    )
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'kvt/architecture-boundaries', messageId: 'repositoryBypass' })
    ]))
  })

  it('enforces domain and UI error model locations', async () => {
    const domainMessages = await lint(
      "export type AddTodoFailure = { code: 'invalid' }",
      fixture('src/domain/usecase/add-todo-use-case.ts')
    )
    const presentationMessages = await lint(
      'export interface TodoUiError { messageKey: string }',
      fixture('src/presentation/viewmodel/todo-view-model.ts')
    )
    expect(domainMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'kvt/error-model-location', messageId: 'domain' })
    ]))
    expect(presentationMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'kvt/error-model-location', messageId: 'presentation' })
    ]))
  })

  it('allows the canonical model, port, use-case and adapter flow', async () => {
    await expect(lint(
      "import type { Todo } from '../model/todo.js'\nexport abstract class TodoRepository { abstract load(): Todo }",
      fixture('src/domain/repository/todo-repository.ts')
    )).resolves.toEqual([])
    await expect(lint(
      "import { TodoRepository } from '../repository/todo-repository.js'\nexport class AddTodoUseCase { constructor(readonly repository: TodoRepository) {} }",
      fixture('src/domain/usecase/add-todo-use-case.ts')
    )).resolves.toEqual([])
    await expect(lint(
      "import { TodoRepository } from '../../domain/repository/todo-repository.js'\nexport class MemoryTodoRepository extends TodoRepository {}",
      fixture('src/data/repository/memory-todo-repository.ts')
    )).resolves.toEqual([])
  })

  it('rejects removed APIs, manual route owners and host globals', async () => {
    const messages = await lint(
      "import { provideSingleton } from '@kvt/core'\nconst route = { scope: 'route', viewModelOwner: true }\ncrypto.randomUUID()",
      fixture('src/domain/usecase/legacy-use-case.ts')
    )
    expect(messages.map((message) => message.ruleId)).toEqual(expect.arrayContaining([
      'kvt/no-legacy-api',
      'no-restricted-globals'
    ]))
    expect(messages.filter((message) => message.ruleId === 'kvt/no-legacy-api')).toHaveLength(3)
  })

  it('does not treat an unrelated package export as a removed KVT API', async () => {
    await expect(lint(
      "import { provideSingleton } from 'another-framework'",
      fixture('src/app/main.ts')
    )).resolves.toEqual([])
  })
})
