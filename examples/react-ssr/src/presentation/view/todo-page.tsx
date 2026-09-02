import { useStateFlow, useViewModel } from '@kvt/react'
import { TodoListViewModel } from '../viewmodel/todo-list-view-model.js'

const messages = {
  'todo.error.emptyTitle': 'Enter a title first.',
  'todo.error.titleTooLong': 'The title is too long.',
  'todo.error.notFound': 'That todo no longer exists.',
  'todo.error.storageUnavailable': 'Todo storage is unavailable.'
} as const

export function TodoPage() {
  const viewModel = useViewModel(TodoListViewModel)
  const state = useStateFlow(viewModel.state)
  return (
    <main className="mx-auto max-w-2xl px-kvt-md py-kvt-xl">
      <h1 className="text-kvt-headline-lg text-kvt-on-background">Todo</h1>
      <p className="mt-kvt-xs text-kvt-body-md text-kvt-on-surface-variant">
        A small app showing KVT DI, use cases, ViewModel ownership and themes.
      </p>
      <form
        className="mt-kvt-lg flex gap-kvt-sm"
        onSubmit={(event) => {
          event.preventDefault()
          void viewModel.addTodo()
        }}
      >
        <input
          aria-label="Todo title"
          value={state.draft}
          onChange={(event) => viewModel.setDraft(event.target.value)}
          className="min-w-0 flex-1 rounded-kvt-md border border-kvt-outline bg-kvt-surface px-kvt-md py-kvt-sm text-kvt-on-surface outline-none focus:border-kvt-primary"
          placeholder="What needs doing?"
        />
        <button
          disabled={state.saving}
          className="rounded-kvt-md bg-kvt-primary px-kvt-lg py-kvt-sm text-kvt-on-primary disabled:opacity-50"
        >
          {state.saving ? 'Adding…' : 'Add'}
        </button>
      </form>
      {state.error && (
        <p
          role="alert"
          className="mt-kvt-sm rounded-kvt-md bg-kvt-error-container p-kvt-sm text-kvt-on-error-container"
        >
          {messages[state.error.messageKey]}
        </p>
      )}
      {state.todos.length === 0 ? (
        <p className="mt-kvt-xl text-kvt-on-surface-variant">No todos yet.</p>
      ) : (
        <ul className="mt-kvt-lg space-y-kvt-sm">
          {state.todos.map((todo) => (
            <li
              key={todo.id}
              className="flex items-center gap-kvt-sm rounded-kvt-lg bg-kvt-surface p-kvt-md shadow-kvt-1"
            >
              <input
                aria-label={`Toggle ${todo.title}`}
                type="checkbox"
                checked={todo.completed}
                onChange={() => void viewModel.toggleTodo(todo.id)}
              />
              <span
                className={`flex-1 text-kvt-on-surface ${todo.completed ? 'line-through opacity-60' : ''}`}
              >
                {todo.title}
              </span>
              <button className="text-kvt-error" onClick={() => void viewModel.removeTodo(todo.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
