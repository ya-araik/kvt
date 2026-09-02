import { KvtProvider } from '@kvt/react'
import { createKvtMemoryRouter, disposeKvtRouter, withKvtRoute } from '@kvt/router-react'
import { assertRuntimeReleased, TestRuntimeBuilder } from '@kvt/testing'
import { render, screen, waitFor } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { StrictMode } from 'react'
import { RouterProvider, type RouteObject } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShowcaseDatabase } from '../data/local/showcase-database.js'
import { insightsFeature } from '../features/insights/insights-feature.js'
import { appModule } from './di/app-module.js'
import { browserDataPlugin } from './di/browser-data-plugin.js'

afterEach(() => vi.restoreAllMocks())

describe('KVT router integration', () => {
  it('survives Strict Mode, unloads the lazy feature and keeps a plain lazy route feature-free', async () => {
    const database = new ShowcaseDatabase()
    await database.clear()
    await database.shutdown({
      signal: new AbortController().signal,
      reason: 'clear',
      deadline: undefined
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((input) => {
        const url = String(input)
        if (url.includes('/users'))
          return Promise.resolve(
            jsonResponse([
              { id: '1', name: 'Leanne Graham', username: 'Bret', email: 'leanne@example.test' }
            ])
          )
        return Promise.resolve(
          jsonResponse({
            first: 1,
            prev: null,
            next: null,
            last: 1,
            pages: 1,
            items: 2,
            data: [
              { id: '1', userId: '1', title: 'Первая', completed: true },
              { id: '2', userId: '1', title: 'Вторая', completed: false }
            ]
          })
        )
      })
    )
    const runtime = await new TestRuntimeBuilder()
      .module(appModule)
      .plugin(browserDataPlugin)
      .build()
    const testRoutes: readonly RouteObject[] = [
      withKvtRoute(
        { path: '/insights', lazy: () => import('../features/insights/insights-route.js') },
        { featureModule: insightsFeature, diagnostics: true, unload: 'on-route-exit' }
      ),
      { path: '/plain', lazy: async () => ({ Component: () => <main>Обычный lazy route</main> }) }
    ]
    const router = createKvtMemoryRouter({
      runtime,
      routes: testRoutes,
      initialEntries: ['/insights']
    })
    const view = render(
      <StrictMode>
        <KvtProvider runtime={runtime}>
          <RouterProvider router={router} />
        </KvtProvider>
      </StrictMode>
    )

    expect(await screen.findByRole('heading', { name: 'Аналитика' })).toBeTruthy()
    expect(runtime.inspect().features.map((feature) => feature.id)).toEqual(['todo-insights'])

    await router.navigate('/plain')
    expect(await screen.findByText('Обычный lazy route')).toBeTruthy()
    await waitFor(() => expect(runtime.inspect().features).toHaveLength(0))

    view.unmount()
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'router-test' })
    assertRuntimeReleased(runtime)
  })
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
