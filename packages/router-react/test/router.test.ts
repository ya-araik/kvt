import { bootstrapKvt, defineModule, type DiagnosticEvent } from '@kvt/core'
import { describe, expect, it, vi } from 'vitest'
import { createKvtMemoryRouter, disposeKvtRouter, withKvtRoute } from '../src/index.js'

describe('@kvt/router-react', () => {
  it('prepares a feature before a loader and preserves loader data', async () => {
    const runtime = await bootstrapKvt()
    const load = vi.fn(async () => defineModule({ id: 'feature', version: '1.0.0' }))
    const loader = vi.fn(() => {
      expect(runtime.inspect().features.map((feature) => feature.id)).toContain('feature')
      return { ready: true }
    })
    const router = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/'],
      routes: [
        { path: '/', Component: () => null },
        withKvtRoute({ id: 'feature', path: '/feature', loader, Component: () => null }, {
          featureModule: { id: 'feature', version: '1.0.0', load }
        })
      ]
    })
    await router.navigate('/feature')
    expect(router.state.loaderData).toEqual({ feature: { ready: true } })
    expect(loader).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledOnce()
    await disposeKvtRouter(router)
    expect(runtime.inspect().features).toEqual([])
    await runtime.shutdown({ reason: 'test' })
  })

  it('does not install an aborted navigation feature', async () => {
    const runtime = await bootstrapKvt()
    let observedAbort = false
    const router = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/'],
      routes: [
        { path: '/', Component: () => null },
        withKvtRoute({ path: '/slow', loader: () => null, Component: () => null }, {
          featureModule: {
            id: 'slow', version: '1.0.0',
            load: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => {
              observedAbort = true
              reject(signal.reason)
            }, { once: true }))
          }
        })
      ]
    })
    const slow = router.navigate('/slow')
    await router.navigate('/')
    await slow.catch(() => undefined)
    expect(observedAbort).toBe(true)
    expect(runtime.inspect().features).toEqual([])
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'test' })
  })

  it('unloads a feature after the last matching route exits', async () => {
    const runtime = await bootstrapKvt()
    const load = vi.fn(async () => defineModule({ id: 'temporary', version: '1.0.0' }))
    const router = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/'],
      routes: [
        { path: '/', Component: () => null },
        withKvtRoute({ path: '/temporary', Component: () => null }, {
          featureModule: { id: 'temporary', version: '1.0.0', load }
        })
      ]
    })
    await router.navigate('/temporary')
    expect(runtime.inspect().features).toHaveLength(1)
    await router.navigate('/')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.inspect().features).toEqual([])
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'test' })
  })

  it('preserves lazy route loaders and reloads an unloaded feature on revisit', async () => {
    const runtime = await bootstrapKvt()
    const load = vi.fn(async () => defineModule({ id: 'lazy-feature', version: '1.0.0' }))
    const lazyLoader = vi.fn(() => ({ source: 'lazy' }))
    const router = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/'],
      routes: [
        { path: '/', Component: () => null },
        withKvtRoute({
          id: 'lazy',
          path: '/lazy',
          lazy: async () => ({ loader: lazyLoader, Component: () => null })
        }, { featureModule: { id: 'lazy-feature', version: '1.0.0', load } })
      ]
    })
    await router.navigate('/lazy')
    expect(router.state.loaderData).toEqual({ lazy: { source: 'lazy' } })
    await router.navigate('/')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.inspect().features).toEqual([])
    await router.navigate('/lazy')
    expect(runtime.inspect().features).toHaveLength(1)
    expect(load).toHaveBeenCalledTimes(2)
    expect(lazyLoader).toHaveBeenCalledTimes(2)
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'test' })
  })

  it('emits redacted loader diagnostics and preserves thrown values', async () => {
    const events: DiagnosticEvent[] = []
    const runtime = await bootstrapKvt({ diagnostics: { emit: (event) => events.push(event) } })
    const failure = new Error('private-denied')
    const router = createKvtMemoryRouter({
      runtime,
      initialEntries: ['/'],
      routes: [
        { path: '/', Component: () => null },
        withKvtRoute({ id: 'failure', path: '/failure', loader: () => { throw failure }, Component: () => null }, {
          featureModule: { id: 'diagnostics', version: '1.0.0', load: async () => defineModule({ id: 'diagnostics', version: '1.0.0' }) },
          diagnostics: true
        })
      ]
    })
    await router.navigate('/failure')
    expect(router.state.errors?.failure).toBe(failure)
    expect(events.filter((event) => event.subsystem === 'router').map((event) => [event.operation, event.phase]))
      .toEqual([['loader', 'start'], ['loader', 'failure']])
    expect(JSON.stringify(events)).not.toContain('private-denied')
    await disposeKvtRouter(router)
    await runtime.shutdown({ reason: 'test' })
  })
})
