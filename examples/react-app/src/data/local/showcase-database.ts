import type { ShutdownContext } from '@kvt/core'
import { openDB, type IDBPDatabase } from 'idb'

export const TODO_PAGES_STORE = 'todo-pages'
export const USERS_STORE = 'users'
export const TODO_OUTBOX_STORE = 'todo-outbox'

const DATABASE_NAME = 'kvt-todo-showcase'
const DATABASE_VERSION = 2

export class ShowcaseDatabase {
  #database: Promise<IDBPDatabase> | undefined

  get(): Promise<IDBPDatabase> {
    this.#database ??= openDB(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(TODO_PAGES_STORE))
          database.createObjectStore(TODO_PAGES_STORE)
        if (!database.objectStoreNames.contains(USERS_STORE))
          database.createObjectStore(USERS_STORE)
        if (!database.objectStoreNames.contains(TODO_OUTBOX_STORE))
          database.createObjectStore(TODO_OUTBOX_STORE)
      }
    })
    return this.#database
  }

  async clear(): Promise<void> {
    const database = await this.get()
    await Promise.all([
      database.clear(TODO_PAGES_STORE),
      database.clear(USERS_STORE),
      database.clear(TODO_OUTBOX_STORE)
    ])
  }

  async shutdown(_context: ShutdownContext): Promise<void> {
    const database = await this.#database
    database?.close()
    this.#database = undefined
  }
}
