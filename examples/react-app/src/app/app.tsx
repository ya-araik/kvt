import { BarChart3, CheckCircle2, ListTodo, Palette, Settings2 } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { useAppTheme } from './theme/app-theme-context.js'
import { getAppThemeScheme } from './theme/theme-schemes.js'

const navigation = [
  { to: '/todos', label: 'Задачи', icon: ListTodo },
  { to: '/insights', label: 'Аналитика', icon: BarChart3 },
  { to: '/settings', label: 'Настройки', icon: Settings2 }
] as const

export function App() {
  const theme = useAppTheme()
  const selectedScheme = getAppThemeScheme(theme.schemeId)

  return (
    <div className="min-h-screen bg-kvt-background font-kvt-sans text-kvt-on-background">
      <a className="skip-link" href="#main-content">
        Перейти к содержимому
      </a>
      <aside className="app-sidebar">
        <div className="flex items-center gap-kvt-sm px-kvt-sm">
          <span className="grid size-10 place-items-center rounded-kvt-md bg-kvt-primary text-kvt-on-primary shadow-kvt-2">
            <CheckCircle2 aria-hidden="true" size={22} />
          </span>
          <div>
            <strong className="block text-kvt-title-lg">KVT Tasks</strong>
            <span className="text-kvt-label-sm text-kvt-on-surface-variant">Todo showcase</span>
          </div>
        </div>
        <nav aria-label="Основная навигация" className="mt-kvt-xl space-y-kvt-xs">
          {navigation.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <NavLink
          to="/settings"
          className="mt-auto flex items-center gap-kvt-sm rounded-kvt-md border border-kvt-outline-variant bg-kvt-surface-variant p-kvt-sm text-kvt-body-md text-kvt-on-surface-variant transition hover:border-kvt-outline"
        >
          <Palette aria-hidden="true" size={18} />
          <span className="min-w-0">
            <span className="block text-kvt-label-lg text-kvt-on-surface">
              {selectedScheme.label}
            </span>
            <span className="block truncate">Тема · {theme.resolvedMotion}</span>
          </span>
          <span
            aria-hidden="true"
            className="ml-auto size-3 rounded-kvt-full bg-kvt-primary shadow-kvt-1"
          />
        </NavLink>
      </aside>

      <header className="mobile-header">
        <div className="flex items-center gap-kvt-sm">
          <span className="grid size-9 place-items-center rounded-kvt-md bg-kvt-primary text-kvt-on-primary">
            <CheckCircle2 aria-hidden="true" size={20} />
          </span>
          <strong>KVT Tasks</strong>
        </div>
        <NavLink aria-label="Открыть настройки" to="/settings" className="icon-button">
          <Settings2 aria-hidden="true" size={20} />
        </NavLink>
      </header>

      <div className="app-content">
        <Outlet />
      </div>

      <nav aria-label="Мобильная навигация" className="mobile-navigation">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `mobile-nav-item${isActive ? ' is-active' : ''}`}
          >
            <item.icon aria-hidden="true" size={20} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function NavItem({ to, label, icon: Icon }: (typeof navigation)[number]) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `sidebar-nav-item${isActive ? ' is-active' : ''}`}
    >
      <Icon aria-hidden="true" size={20} />
      <span>{label}</span>
    </NavLink>
  )
}
