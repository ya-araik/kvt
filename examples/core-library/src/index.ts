import { bootstrapKvt } from '@kvt/core'
import { AddTodoUseCase } from './domain/usecase/add-todo-use-case.js'
import { ObserveTodosUseCase } from './domain/usecase/observe-todos-use-case.js'
import { todoModule } from './app/di/todo-module.js'

const runtime = await bootstrapKvt({ modules: [todoModule] })
const controller = new AbortController()
const context = { signal: controller.signal }

const addTodo = runtime.resolve(AddTodoUseCase)
const observeTodos = runtime.resolve(ObserveTodosUseCase)

await addTodo.execute({ title: 'Learn KVT ownership' }, context)
console.log(observeTodos.execute().value)

const shutdown = async (reason: string) => {
  controller.abort(reason)
  await runtime.shutdown({ reason })
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
