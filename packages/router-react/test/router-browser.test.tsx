// @vitest-environment jsdom

import { ViewModel, bind, bootstrapKvt, defineModule } from '@kvt/core'
import { KvtProvider, useViewModel } from '@kvt/react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RouterProvider } from 'react-router'
import {
  createKvtBrowserRouter,
  createKvtMemoryRouter,
  disposeKvtRouter,
  useKvtRouteScope,
  withKvtRoute
} from '../src/index.js'

afterEach(() => cleanup())

describe('@kvt/router-react render boundaries', () => {
  it('creates a browser router and provides the feature scope to Component routes', async () => {
    history.replaceState(null, '', '/')
    const runtime = await bootstrapKvt()
    const feature = { id: 'browser-feature', version: '1.0.0', load: async () => defineModule({ id: 'browser-feature', version: '1.0.0' }) }
    function Feature() {
      const scope = useKvtRouteScope()
      return <span>{scope.id}</span>
    }
    const router = createKvtBrowserRouter({
      runtime,
      routes: [withKvtRoute({ path: '/', Component: Feature }, { featureModule: feature })]
    })
    const result = render(<KvtProvider runtime={runtime}><RouterProvider router={router} /></KvtProvider>)
    await waitFor(() => expect(screen.getByText('feature:browser-feature')).toBeTruthy())
    result.unmount()
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'test' })
  })

  it('creates route owners automatically and keys them by path params, not search params', async () => {
    let generation = 0
    const stopped: number[] = []
    class RouteViewModel extends ViewModel {
      readonly generation = ++generation
      protected override onStop(): void { stopped.push(this.generation) }
    }
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'route-view-model', version: '1.0.0', providers: [bind(RouteViewModel).viewModel()]
    })] })
    function Page() { return <span>vm-{useViewModel(RouteViewModel).generation}</span> }
    const router = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/items/one'],
      routes: [{ path: '/items/:itemId', Component: Page }]
    })
    render(<KvtProvider runtime={runtime}><RouterProvider router={router} /></KvtProvider>)
    await waitFor(() => expect(screen.getByText('vm-1')).toBeTruthy())
    await router.navigate('/items/one?sort=desc')
    expect(screen.getByText('vm-1')).toBeTruthy()
    expect(generation).toBe(1)
    await router.navigate('/items/two')
    await waitFor(() => expect(screen.getByText('vm-2')).toBeTruthy())
    await waitFor(() => expect(stopped).toContain(1))
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'test' })
  })

  it('wraps element and lazy Component render paths and requires route metadata for the hook', async () => {
    const runtime = await bootstrapKvt()
    function ScopeValue() { return <span>{useKvtRouteScope().id}</span> }
    expect(() => render(<ScopeValue />)).toThrow('requires a route with KVT feature metadata')
    cleanup()

    const feature = { id: 'render-feature', version: '1.0.0', load: async () => defineModule({ id: 'render-feature', version: '1.0.0' }) }
    const router = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/element'],
      routes: [
        withKvtRoute({ path: '/element', element: <ScopeValue /> }, { featureModule: feature }),
        withKvtRoute({ path: '/lazy', lazy: async () => ({ Component: ScopeValue }) }, { featureModule: feature })
      ]
    })
    const result = render(<KvtProvider runtime={runtime}><RouterProvider router={router} /></KvtProvider>)
    await waitFor(() => expect(screen.getByText('feature:render-feature')).toBeTruthy())
    await router.navigate('/lazy')
    await waitFor(() => expect(screen.getByText('feature:render-feature')).toBeTruthy())
    result.unmount()
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'test' })
  })
})
