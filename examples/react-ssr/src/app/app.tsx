import { useKvtTheme } from '@kvt/theme-react'
import { NavLink, Outlet } from 'react-router'

export function App() {
  const theme = useKvtTheme()
  const nextColor = theme.preference.color === 'dark' ? 'light' : 'dark'
  return (
    <div className="min-h-screen bg-kvt-background font-kvt-sans text-kvt-on-background">
      <header className="border-b border-kvt-outline-variant bg-kvt-surface">
        <nav className="mx-auto flex max-w-2xl items-center gap-kvt-md px-kvt-md py-kvt-sm">
          <NavLink to="/" end>
            Todos
          </NavLink>
          <NavLink to="/about">About</NavLink>
          <button
            className="ml-auto rounded-kvt-md bg-kvt-secondary-container px-kvt-md py-kvt-xs text-kvt-on-secondary-container"
            onClick={() =>
              theme.setPreference({ color: nextColor, motion: theme.preference.motion })
            }
          >
            Use {nextColor}
          </button>
        </nav>
      </header>
      <Outlet />
    </div>
  )
}
