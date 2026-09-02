import { useSharedFlow, useStateFlow, useViewModel } from '@kvt/react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  CloudOff,
  Inbox,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Todo } from '../../domain/model/todo.js'
import type { TodoUiEvent } from '../model/todo-list-state.js'
import { TodoListViewModel } from '../viewmodel/todo-list-view-model.js'

const messages = {
  'todo.error.emptyTitle': 'Введите название задачи.',
  'todo.error.titleTooLong': 'Название не должно быть длиннее 200 символов.',
  'todo.error.notFound': 'Задача уже удалена или не существует.',
  'todo.error.networkUnavailable': 'API недоступен. Проверьте локальный сервер.',
  'todo.error.invalidResponse': 'Сервер вернул данные неизвестного формата.',
  'todo.error.storageUnavailable': 'Локальное хранилище недоступно.',
  'todo.error.unexpectedResponse': 'Сервер не смог выполнить запрос.'
} as const

export function TodoPage() {
  const viewModel = useViewModel(TodoListViewModel)
  const state = useStateFlow(viewModel.state)
  const [toast, setToast] = useState<string>()
  const [deleteCandidate, setDeleteCandidate] = useState<Todo>()
  const users = useMemo(() => new Map(state.users.map((user) => [user.id, user])), [state.users])
  useSharedFlow(viewModel.events, (event) => {
    setToast(toastMessage(event))
    window.setTimeout(() => setToast(undefined), 3200)
  })

  const completedOnPage = state.todos.filter((todo) => todo.completed).length
  const activeOnPage = state.todos.length - completedOnPage
  const isOffline = state.connection !== 'online'

  return (
    <main id="main-content" className="page-shell" tabIndex={-1}>
      <header className="page-heading">
        <div>
          <span className="eyebrow">Рабочее пространство</span>
          <h1>Мои задачи</h1>
          <p>Данные загружаются постранично и сохраняются локально для offline-просмотра.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={state.refreshing}
          onClick={() => void viewModel.refresh()}
        >
          <RefreshCw
            className={state.refreshing ? 'animate-spin' : ''}
            aria-hidden="true"
            size={18}
          />
          {state.refreshing ? 'Обновляем…' : 'Обновить'}
        </button>
      </header>

      {isOffline || state.stale ? (
        <div className="status-banner" role="status">
          <CloudOff aria-hidden="true" size={20} />
          <div>
            <strong>
              {isOffline
                ? 'Offline-режим: изменения сохраняются локально'
                : 'Показаны сохранённые данные'}
            </strong>
            <p>
              {isOffline
                ? 'Очередь автоматически синхронизируется после восстановления соединения.'
                : 'Актуальная версия загружается с сервера в фоне.'}
            </p>
          </div>
        </div>
      ) : null}

      {state.error ? (
        <div className="error-banner" role="alert">
          <AlertTriangle aria-hidden="true" size={20} />
          <span>{messages[state.error.messageKey]}</span>
          <button
            type="button"
            aria-label="Закрыть сообщение"
            onClick={() => viewModel.clearError()}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      ) : null}

      <section aria-label="Сводка" className="summary-grid">
        <SummaryCard
          label="Найдено"
          value={state.totalItems}
          note="по текущим фильтрам"
          tone="primary"
        />
        <SummaryCard
          label="Активных на странице"
          value={activeOnPage}
          note={`из ${state.todos.length}`}
          tone="secondary"
        />
        <SummaryCard
          label="Готово на странице"
          value={completedOnPage}
          note="можно двигаться дальше"
          tone="tertiary"
        />
      </section>

      <section className="create-card" aria-labelledby="create-title">
        <div>
          <span className="eyebrow">Быстрое добавление</span>
          <h2 id="create-title">Новая задача</h2>
        </div>
        <form
          className="create-form"
          onSubmit={(event) => {
            event.preventDefault()
            void viewModel.addTodo()
          }}
        >
          <label className="field grow-field">
            <span>Что нужно сделать</span>
            <input
              value={state.draft}
              maxLength={200}
              placeholder="Например, подготовить релиз"
              onChange={(event) => viewModel.setDraft(event.target.value)}
            />
          </label>
          <label className="field user-field">
            <span>Исполнитель</span>
            <select
              value={state.draftUserId ?? ''}
              disabled={state.users.length === 0}
              onChange={(event) => viewModel.setDraftUser(event.target.value)}
            >
              {state.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button create-button" disabled={state.saving}>
            {state.saving ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" size={19} />
            ) : (
              <CirclePlus aria-hidden="true" size={19} />
            )}
            {state.saving ? 'Добавляем…' : 'Добавить'}
          </button>
        </form>
      </section>

      <section className="todo-card" aria-labelledby="todo-list-title">
        <div className="todo-toolbar">
          <div>
            <span className="eyebrow">Список</span>
            <h2 id="todo-list-title">Задачи</h2>
          </div>
          <div className="filter-tabs" aria-label="Статус задачи">
            {(['all', 'active', 'completed'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={state.statusFilter === filter}
                onClick={() => viewModel.setStatusFilter(filter)}
              >
                {{ all: 'Все', active: 'Активные', completed: 'Готовые' }[filter]}
              </button>
            ))}
          </div>
        </div>

        <div className="query-controls">
          <label className="search-field">
            <Search aria-hidden="true" size={18} />
            <span className="sr-only">Поиск по названию</span>
            <input
              type="search"
              value={state.searchDraft}
              placeholder="Поиск по названию…"
              onChange={(event) => viewModel.searchChanged(event.target.value)}
            />
            {state.fetching ? (
              <LoaderCircle className="animate-spin" aria-label="Загрузка" size={17} />
            ) : null}
          </label>
          <label className="select-field">
            <UserRound aria-hidden="true" size={18} />
            <span className="sr-only">Фильтр по исполнителю</span>
            <select
              value={state.userFilter ?? ''}
              onChange={(event) => viewModel.setUserFilter(event.target.value || undefined)}
            >
              <option value="">Все исполнители</option>
              {state.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {state.status === 'loading' && state.todos.length === 0 ? (
          <TodoSkeleton />
        ) : state.status === 'failure' && state.todos.length === 0 ? (
          <InitialError onRetry={() => void viewModel.refresh()} />
        ) : state.todos.length === 0 ? (
          <EmptyState
            filtered={
              state.appliedSearch.length > 0 ||
              state.statusFilter !== 'all' ||
              state.userFilter !== undefined
            }
          />
        ) : (
          <ul className="todo-list" aria-busy={state.fetching}>
            {state.todos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                userName={users.get(todo.userId)?.name ?? `Пользователь ${todo.userId}`}
                editing={state.editing?.id === todo.id ? state.editing.title : undefined}
                pending={state.pendingIds.includes(todo.id)}
                onBeginEdit={() => viewModel.beginEdit(todo)}
                onEdit={(title) => viewModel.editChanged(title)}
                onCancelEdit={() => viewModel.cancelEdit()}
                onSave={() => void viewModel.saveEdit()}
                onToggle={() => void viewModel.toggleTodo(todo)}
                onDelete={() => setDeleteCandidate(todo)}
              />
            ))}
          </ul>
        )}

        <footer className="pagination">
          <span>
            Страница {state.page} из {state.totalPages}
          </span>
          <div>
            <button
              type="button"
              className="icon-button"
              aria-label="Предыдущая страница"
              disabled={state.page <= 1 || state.fetching}
              onClick={() => viewModel.setPage(state.page - 1)}
            >
              <ChevronLeft aria-hidden="true" size={19} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Следующая страница"
              disabled={state.page >= state.totalPages || state.fetching}
              onClick={() => viewModel.setPage(state.page + 1)}
            >
              <ChevronRight aria-hidden="true" size={19} />
            </button>
          </div>
        </footer>
      </section>

      {toast ? (
        <div className="toast" role="status">
          <Check aria-hidden="true" size={18} />
          {toast}
        </div>
      ) : null}
      {deleteCandidate ? (
        <ConfirmDialog
          todo={deleteCandidate}
          onCancel={() => setDeleteCandidate(undefined)}
          onConfirm={() => {
            setDeleteCandidate(undefined)
            void viewModel.removeTodo(deleteCandidate)
          }}
        />
      ) : null}
    </main>
  )
}

function SummaryCard({
  label,
  value,
  note,
  tone
}: {
  readonly label: string
  readonly value: number
  readonly note: string
  readonly tone: 'primary' | 'secondary' | 'tertiary'
}) {
  return (
    <article className={`summary-card summary-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function TodoRow({
  todo,
  userName,
  editing,
  pending,
  onBeginEdit,
  onEdit,
  onCancelEdit,
  onSave,
  onToggle,
  onDelete
}: {
  readonly todo: Todo
  readonly userName: string
  readonly editing: string | undefined
  readonly pending: boolean
  readonly onBeginEdit: () => void
  readonly onEdit: (title: string) => void
  readonly onCancelEdit: () => void
  readonly onSave: () => void
  readonly onToggle: () => void
  readonly onDelete: () => void
}) {
  return (
    <li className={`todo-row${todo.completed ? ' is-completed' : ''}`}>
      <label className="todo-checkbox">
        <input
          type="checkbox"
          checked={todo.completed}
          disabled={pending}
          aria-label={`Отметить задачу «${todo.title}»`}
          onChange={onToggle}
        />
        <span>
          <Check aria-hidden="true" size={15} />
        </span>
      </label>
      <div className="todo-copy">
        {editing === undefined ? (
          <>
            <strong>{todo.title}</strong>
            <span>
              <UserRound aria-hidden="true" size={14} />
              {userName}
            </span>
          </>
        ) : (
          <form
            className="inline-editor"
            onSubmit={(event) => {
              event.preventDefault()
              onSave()
            }}
          >
            <input
              autoFocus
              aria-label="Новое название задачи"
              value={editing}
              maxLength={200}
              onChange={(event) => onEdit(event.target.value)}
            />
            <button className="icon-button" type="submit" aria-label="Сохранить">
              <Check aria-hidden="true" size={17} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Отменить"
              onClick={onCancelEdit}
            >
              <X aria-hidden="true" size={17} />
            </button>
          </form>
        )}
      </div>
      {editing === undefined ? (
        <div className="todo-actions">
          {pending ? (
            <LoaderCircle className="animate-spin" aria-label="Сохраняем" size={18} />
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label={`Редактировать «${todo.title}»`}
            disabled={pending}
            onClick={onBeginEdit}
          >
            <Pencil aria-hidden="true" size={17} />
          </button>
          <button
            type="button"
            className="icon-button danger-button"
            aria-label={`Удалить «${todo.title}»`}
            disabled={pending}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" size={17} />
          </button>
        </div>
      ) : null}
    </li>
  )
}

function TodoSkeleton() {
  return (
    <div className="skeleton-list" aria-label="Загружаем задачи">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span />
          <div>
            <b />
            <i />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ filtered }: { readonly filtered: boolean }) {
  return (
    <div className="empty-state">
      <span>
        <Inbox aria-hidden="true" size={28} />
      </span>
      <h3>{filtered ? 'Ничего не найдено' : 'Пока нет задач'}</h3>
      <p>
        {filtered
          ? 'Попробуйте изменить поиск или фильтры.'
          : 'Добавьте первую задачу с помощью формы выше.'}
      </p>
    </div>
  )
}

function InitialError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <span>
        <CloudOff aria-hidden="true" size={28} />
      </span>
      <h3>Не удалось загрузить задачи</h3>
      <p>Запустите локальный API командой npm run dev и попробуйте снова.</p>
      <button type="button" className="secondary-button" onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={17} />
        Повторить
      </button>
    </div>
  )
}

function ConfirmDialog({
  todo,
  onCancel,
  onConfirm
}: {
  readonly todo: Todo
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
      >
        <span className="dialog-icon">
          <Trash2 aria-hidden="true" size={22} />
        </span>
        <h2 id="delete-title">Удалить задачу?</h2>
        <p id="delete-description">
          «{todo.title}» будет удалена с локального API. Это действие нельзя отменить.
        </p>
        <div>
          <button type="button" className="secondary-button" autoFocus onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="danger-filled-button" onClick={onConfirm}>
            <Trash2 aria-hidden="true" size={17} />
            Удалить
          </button>
        </div>
      </section>
    </div>
  )
}

function toastMessage(event: TodoUiEvent): string {
  if (event.type === 'created') return `Задача «${event.title}» добавлена`
  if (event.type === 'updated') return `Задача «${event.title}» обновлена`
  return `Задача «${event.title}» удалена`
}
