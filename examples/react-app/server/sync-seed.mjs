import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = 'https://jsonplaceholder.typicode.com'
const serverDirectory = dirname(fileURLToPath(import.meta.url))
const seedPath = resolve(serverDirectory, 'seed.json')

const [todos, users] = await Promise.all([load('/todos'), load('/users')])
const seed = {
  todos: todos.map((todo) => ({
    id: String(todo.id),
    userId: String(todo.userId),
    title: String(todo.title),
    completed: Boolean(todo.completed)
  })),
  users: users.map((user) => ({
    id: String(user.id),
    name: String(user.name),
    username: String(user.username),
    email: String(user.email)
  }))
}

await writeFile(seedPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')
console.log(`Wrote ${seed.todos.length} todos and ${seed.users.length} users to ${seedPath}`)

async function load(path) {
  const response = await fetch(`${source}${path}`)
  if (!response.ok) throw new Error(`JSONPlaceholder ${path} returned ${response.status}`)
  const value = await response.json()
  if (!Array.isArray(value)) throw new TypeError(`JSONPlaceholder ${path} did not return an array`)
  return value
}
