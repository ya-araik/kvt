import { bootstrapKvt } from '@kvt/core'
import { describe, expect, it } from 'vitest'
import { AddTodoUseCase } from './domain/usecase/add-todo-use-case.js'
import { ObserveTodosUseCase } from './domain/usecase/observe-todos-use-case.js'
import { todoModule } from './app/di/todo-module.js'

describe('Todo application', () => {
  it('adds a validated todo through public use cases', async () => {
    const runtime = await bootstrapKvt({ modules: [todoModule] })
    const signal = new AbortController().signal
    try {
      const result = await runtime
        .resolve(AddTodoUseCase)
        .execute({ title: 'Ship Todo' }, { signal })
      expect(result.ok).toBe(true)
      expect(runtime.resolve(ObserveTodosUseCase).execute().value).toHaveLength(1)
    } finally {
      await runtime.shutdown({ reason: 'test-complete' })
    }
  })
})
