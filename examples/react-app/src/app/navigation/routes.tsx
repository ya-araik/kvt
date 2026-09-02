import { withKvtRoute } from '@kvt/router-react'
import { Navigate, type RouteObject } from 'react-router'
import { App } from '../app.js'
import { insightsFeature } from '../../features/insights/insights-feature.js'
import { TodoPage } from '../../presentation/view/todo-page.js'
import { RouteFallback } from './route-fallback.js'

export const routes: readonly RouteObject[] = [
  {
    path: '/',
    Component: App,
    HydrateFallback: RouteFallback,
    children: [
      { index: true, element: <Navigate replace to="/todos" /> },
      { path: 'todos', Component: TodoPage },
      withKvtRoute(
        {
          path: 'insights',
          HydrateFallback: RouteFallback,
          lazy: () => import('../../features/insights/insights-route.js')
        },
        { featureModule: insightsFeature, diagnostics: true, unload: 'on-route-exit' }
      ),
      {
        path: 'settings',
        HydrateFallback: RouteFallback,
        lazy: () => import('../../features/settings/settings-route.js')
      },
      { path: '*', element: <Navigate replace to="/todos" /> }
    ]
  }
]
