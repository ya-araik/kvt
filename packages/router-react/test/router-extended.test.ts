import { bootstrapKvt, defineModule, type DiagnosticEvent } from '@kvt/core'
import { describe, expect, it, vi } from 'vitest'
import {
  KVT_ROUTE_METADATA,
  createKvtMemoryRouter,
  createKvtStaticHandler,
  createKvtStaticRouter,
  disposeKvtRouter,
  withKvtRoute
} from '../src/index.js'

describe('@kvt/router-react data/static adapters', () => {
  it('preserves existing route handles and freezes only KVT metadata', () => {
    const route = withKvtRoute({ path: '/', handle: { breadcrumb: 'home' } }, { diagnostics: true })
    expect(route.handle).toMatchObject({ breadcrumb: 'home' })
    expect(Object.isFrozen((route.handle as Record<PropertyKey, unknown>)[KVT_ROUTE_METADATA])).toBe(true)
    const primitive = withKvtRoute({ path: '/', handle: 'legacy' }, { unload: 'keep-alive' })
    expect((primitive.handle as Record<PropertyKey, unknown>)[KVT_ROUTE_METADATA]).toEqual({ unload: 'keep-alive' })
  })

  it('prepares static loader features and creates a standard static router', async () => {
    const runtime = await bootstrapKvt()
    const feature = { id: 'static-feature', version: '1.0.0', load: async () => defineModule({ id: 'static-feature', version: '1.0.0' }) }
    const handler = createKvtStaticHandler({
      runtime,
      routes: [withKvtRoute({ id: 'root', path: '/', loader: () => ({ ready: true }), Component: () => null }, {
        featureModule: feature
      })]
    })
    const context = await handler.query(new Request('http://localhost/'))
    expect(context).not.toBeInstanceOf(Response)
    if (!(context instanceof Response)) {
      const router = createKvtStaticRouter(handler.dataRoutes, context)
      expect(router.state.loaderData).toEqual({ root: { ready: true } })
    }
    expect(runtime.inspect().features).toHaveLength(1)
    await disposeKvtRouter(handler)
    expect(runtime.inspect().features).toEqual([])
    await disposeKvtRouter({})
    await runtime.shutdown({ reason: 'test' })
  })

  it('wraps actions with success/failure diagnostics and preserves Response semantics', async () => {
    const events: DiagnosticEvent[] = []
    const runtime = await bootstrapKvt({ diagnostics: { emit: (event) => events.push(event) } })
    const feature = { id: 'action-feature', version: '1.0.0', load: async () => defineModule({ id: 'action-feature', version: '1.0.0' }) }
    const router = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/action'],
      routes: [withKvtRoute({
        id: 'action', path: '/action', loader: () => null,
        action: async ({ request }) => request.headers.get('x-fail') ? Promise.reject(new Error('action-failed')) : new Response('ok', { status: 201 }),
        Component: () => null
      }, { featureModule: feature, diagnostics: true })]
    })
    await router.navigate('/action', { formMethod: 'post', body: new FormData() })
    expect(events.some((event) => event.operation === 'action' && event.phase === 'success')).toBe(true)

    const request = new Request('http://localhost/action', { method: 'POST', headers: { 'x-fail': 'yes' } })
    const handler = createKvtStaticHandler({ runtime, routes: [withKvtRoute({
      id: 'failed-action', path: '/action', action: () => { throw new Error('action-failed') }, Component: () => null
    }, { featureModule: feature, diagnostics: true })] })
    const result = await handler.queryRoute(request, { routeId: 'failed-action' }).catch((error) => error)
    expect(result).toBeInstanceOf(Error)
    expect(events.some((event) => event.operation === 'action' && event.phase === 'failure')).toBe(true)
    await disposeKvtRouter(handler)
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'test' })
  })

  it('injects a no-op loader, wraps lazy action/component/element and detects manager loader conflicts', async () => {
    const runtime = await bootstrapKvt()
    const module = defineModule({ id: 'lazy-all', version: '1.0.0' })
    const load = vi.fn(async () => module)
    const feature = { id: 'lazy-all', version: '1.0.0', load }
    const router = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/'],
      routes: [
        { path: '/', Component: () => null },
        withKvtRoute({ id: 'automatic', path: '/automatic', Component: () => null }, { featureModule: feature }),
        withKvtRoute({
          id: 'lazy-all', path: '/lazy-all', lazy: async () => ({
            action: () => ({ action: true }),
            Component: () => null,
            element: null
          })
        }, { featureModule: feature })
      ]
    })
    await router.navigate('/automatic')
    expect(router.state.loaderData).toEqual({ automatic: null })
    await router.navigate('/lazy-all')
    expect(load).toHaveBeenCalled()

    const conflicting = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/'],
      routes: [
        { path: '/', Component: () => null },
        withKvtRoute({ path: '/one', Component: () => null }, { featureModule: feature }),
        withKvtRoute({ path: '/two', Component: () => null }, {
          featureModule: { ...feature, load: async () => module }
        })
      ]
    })
    await conflicting.navigate('/one')
    await expect(conflicting.navigate('/two')).rejects.toThrow('Conflicting loader')
    await disposeKvtRouter(conflicting)
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'test' })
  })
})
