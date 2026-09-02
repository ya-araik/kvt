import { bootstrapKvt } from '@kvt/core'
import { KvtErrorBoundary, KvtProvider } from '@kvt/react'
import { createKvtBrowserRouter } from '@kvt/router-react'
import { createLocalStorageThemeAdapter, KvtThemeProvider } from '@kvt/theme-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { routes } from './app/navigation/routes.js'
import { todoModule } from './app/di/todo-module.js'
import './styles.css'

const runtime = await bootstrapKvt({ modules: [todoModule] })
const router = createKvtBrowserRouter({ runtime, routes })
const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <KvtProvider runtime={runtime}>
      <KvtThemeProvider
        target={document.documentElement}
        storage={createLocalStorageThemeAdapter(localStorage)}
      >
        <KvtErrorBoundary
          fallback={(error) => <main role="alert">The application failed: {String(error)}</main>}
        >
          <RouterProvider router={router} />
        </KvtErrorBoundary>
      </KvtThemeProvider>
    </KvtProvider>
  </StrictMode>
)
