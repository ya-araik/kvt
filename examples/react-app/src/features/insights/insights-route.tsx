import { useStateFlow, useViewModel } from '@kvt/react'
import { Activity, BarChart3, CheckCheck, Layers3, LoaderCircle, UsersRound } from 'lucide-react'
import { TodoInsightsViewModel } from './todo-insights-view-model.js'

export function Component() {
  const viewModel = useViewModel(TodoInsightsViewModel)
  const state = useStateFlow(viewModel.state)

  return (
    <main id="main-content" className="page-shell insights-page" tabIndex={-1}>
      <header className="page-heading">
        <div>
          <span className="eyebrow">Lazy KVT feature</span>
          <h1>Аналитика</h1>
          <p>
            Экран, ViewModel и DI-модуль загружаются только при первом переходе на этот маршрут.
          </p>
        </div>
        <span className="page-icon">
          <BarChart3 aria-hidden="true" size={24} />
        </span>
      </header>

      {state.fetching ? (
        <div className="inline-status">
          <LoaderCircle className="animate-spin" aria-hidden="true" size={17} />
          Обновляем аналитику…
        </div>
      ) : null}
      {state.stale ? (
        <div className="status-banner">
          <Activity aria-hidden="true" size={19} />
          <div>
            <strong>Аналитика рассчитана по кэшу</strong>
            <p>Она обновится, когда API снова будет доступен.</p>
          </div>
        </div>
      ) : null}

      <section className="insight-summary" aria-label="Основные показатели">
        <Metric icon={Layers3} label="Всего задач" value={state.total} detail="полный набор" />
        <Metric
          icon={CheckCheck}
          label="Выполнено"
          value={state.completed}
          detail={`${state.completionRate}% от всех`}
        />
        <Metric icon={Activity} label="В работе" value={state.active} detail="осталось завершить" />
      </section>

      <section className="chart-grid">
        <article className="chart-card completion-card">
          <div className="chart-heading">
            <div>
              <span className="eyebrow">Прогресс</span>
              <h2>Общее выполнение</h2>
            </div>
            <strong>{state.completionRate}%</strong>
          </div>
          <div
            className="completion-ring"
            style={{ '--completion': `${state.completionRate * 3.6}deg` } as React.CSSProperties}
          >
            <span>
              <strong>{state.completionRate}%</strong>
              <small>готово</small>
            </span>
          </div>
          <div className="legend">
            <span>
              <i className="legend-complete" />
              Выполнено · {state.completed}
            </span>
            <span>
              <i className="legend-active" />В работе · {state.active}
            </span>
          </div>
        </article>

        <article className="chart-card users-chart">
          <div className="chart-heading">
            <div>
              <span className="eyebrow">Команда</span>
              <h2>Задачи по исполнителям</h2>
            </div>
            <UsersRound aria-hidden="true" size={22} />
          </div>
          {state.status === 'loading' && state.users.length === 0 ? (
            <div className="chart-loading">
              <LoaderCircle className="animate-spin" size={22} />
              Считаем данные…
            </div>
          ) : (
            <ol className="user-bars">
              {state.users.map((user) => (
                <li key={user.id}>
                  <div>
                    <strong>{user.name}</strong>
                    <span>
                      {user.completed} из {user.total} · {user.completionRate}%
                    </span>
                  </div>
                  <div
                    className="progress-track"
                    role="img"
                    aria-label={`${user.name}: выполнено ${user.completionRate}%`}
                  >
                    <span style={{ width: `${user.completionRate}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>

      <aside className="architecture-note">
        <BarChart3 aria-hidden="true" size={20} />
        <p>
          <strong>Feature lifecycle.</strong> После выхода со страницы route owner закрывает
          ViewModel, feature scope выгружается, а root Query cache продолжает жить.
        </p>
      </aside>
    </main>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  detail
}: {
  readonly icon: typeof Activity
  readonly label: string
  readonly value: number
  readonly detail: string
}) {
  return (
    <article className="metric-card">
      <span>
        <Icon aria-hidden="true" size={20} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  )
}
