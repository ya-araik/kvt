import { ViewModel } from '@kvt/core'
import { MutableStateFlow } from '@kvt/flow'
import type { TodoFeedState } from '../../domain/model/todo.js'
import type { UsersState } from '../../domain/model/user.js'
import { ObserveTodosUseCase } from '../../domain/usecase/observe-todos-use-case.js'
import { ObserveUsersUseCase } from '../../domain/usecase/observe-users-use-case.js'

export interface UserInsight {
  readonly id: string
  readonly name: string
  readonly total: number
  readonly completed: number
  readonly completionRate: number
}

export interface TodoInsightsState {
  readonly status: 'loading' | 'ready' | 'failure'
  readonly total: number
  readonly completed: number
  readonly active: number
  readonly completionRate: number
  readonly users: readonly UserInsight[]
  readonly stale: boolean
  readonly fetching: boolean
}

export class TodoInsightsViewModel extends ViewModel {
  readonly #state = new MutableStateFlow<TodoInsightsState>({
    status: 'loading',
    total: 0,
    completed: 0,
    active: 0,
    completionRate: 0,
    users: [],
    stale: false,
    fetching: false
  })
  readonly state = this.#state.asStateFlow()
  #todos: TodoFeedState | undefined
  #users: UsersState | undefined

  constructor(
    private readonly observeTodos: ObserveTodosUseCase,
    private readonly observeUsers: ObserveUsersUseCase
  ) {
    super()
  }

  protected override onStart(): void {
    this.viewModelScope.collect(
      this.observeTodos.execute({ page: 1, pageSize: 200, search: '', status: 'all' }),
      (state) => {
        this.#todos = state
        this.#recalculate()
      }
    )
    this.viewModelScope.collect(this.observeUsers.execute(), (state) => {
      this.#users = state
      this.#recalculate()
    })
  }

  #recalculate(): void {
    const feed = this.#todos
    const todos = feed?.page?.todos ?? []
    const users = this.#users?.users ?? []
    const completed = todos.filter((todo) => todo.completed).length
    const distribution = users
      .map((user): UserInsight => {
        const assigned = todos.filter((todo) => todo.userId === user.id)
        const userCompleted = assigned.filter((todo) => todo.completed).length
        return Object.freeze({
          id: user.id,
          name: user.name,
          total: assigned.length,
          completed: userCompleted,
          completionRate: percent(userCompleted, assigned.length)
        })
      })
      .filter((user) => user.total > 0)
      .sort((left, right) => right.total - left.total)

    this.#state.set(
      Object.freeze({
        status: feed?.status ?? 'loading',
        total: todos.length,
        completed,
        active: todos.length - completed,
        completionRate: percent(completed, todos.length),
        users: Object.freeze(distribution),
        stale: feed?.stale ?? false,
        fetching: feed?.fetching ?? false
      })
    )
  }
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 100)
}
