import { bootstrapKvt } from '@kvt/core'
import { DiagnosticEventBuffer } from '@kvt/devtools-protocol'
import { KvtErrorBoundary, KvtProvider } from '@kvt/react'
import { createKvtBrowserRouter } from '@kvt/router-react'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { appModule } from './app/di/app-module.js'
import { browserDataPlugin } from './app/di/browser-data-plugin.js'
import { FatalError } from './app/fatal-error.js'
import { RouteFallback } from './app/navigation/route-fallback.js'
import { routes } from './app/navigation/routes.js'
import { AppThemeProvider } from './app/theme/app-theme-provider.js'
import './styles.css'

const diagnostics = new DiagnosticEventBuffer(1_000)
const runtime = await bootstrapKvt({
  modules: [appModule],
  plugins: [browserDataPlugin],
  diagnostics
})
const router = createKvtBrowserRouter({ runtime, routes })
const Devtools = import.meta.env.DEV
  ? lazy(() => import('./app/devtools/showcase-devtools.js'))
  : undefined
const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <KvtProvider runtime={runtime}>
      <AppThemeProvider>
        <KvtErrorBoundary fallback={(error) => <FatalError error={error} />}>
          <Suspense fallback={<RouteFallback />}>
            <RouterProvider router={router} />
          </Suspense>
          {Devtools ? (
            <Suspense fallback={null}>
              <Devtools runtime={runtime} events={diagnostics} />
            </Suspense>
          ) : null}
        </KvtErrorBoundary>
      </AppThemeProvider>
    </KvtProvider>
  </StrictMode>
)
