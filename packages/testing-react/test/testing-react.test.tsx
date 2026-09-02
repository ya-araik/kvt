import { bootstrapKvt } from '@kvt/core'
import { createHydrationState } from '@kvt/react'
import { MutableStateFlow } from '@kvt/flow'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createKvtStaticTestRouter,
  renderKvt,
  renderKvtRouter
} from '../src/index.js'

describe('@kvt/testing-react', () => {
  it('renders a strict provider harness with an external runtime', async () => {
    const runtime = await bootstrapKvt()
    const result = renderKvt(<span>ready</span>, { runtime })
    expect(screen.getByText('ready')).toBeTruthy()
    result.unmount()
    await runtime.shutdown({ reason: 'test' })
  })

  it('owns memory and static router harness cleanup explicitly', async () => {
    const runtime = await bootstrapKvt()
    const routes = [{ path: '/', Component: () => <span>route</span> }]
    const rendered = renderKvtRouter({ runtime, routes, initialEntries: ['/'] })
    expect(await screen.findByText('route')).toBeTruthy()
    await rendered.disposeRouter()
    rendered.unmount()
    const server = await createKvtStaticTestRouter({ runtime, routes })
    expect(server.type).toBe('router')
    await server.dispose()
    await runtime.shutdown({ reason: 'test' })
  })

  it('supports non-strict hydrated rendering and static responses', async () => {
    const runtime = await bootstrapKvt()
    const hydration = createHydrationState([{
      key: 'answer', flow: new MutableStateFlow(42), serialize: (value) => value
    }])
    const rendered = renderKvt(<span>hydrated</span>, { runtime, hydration, strict: false })
    expect(screen.getByText('hydrated')).toBeTruthy()
    rendered.unmount()

    const server = await createKvtStaticTestRouter({
      runtime,
      routes: [{ path: '/', loader: () => new Response(null, { status: 302, headers: { location: '/next' } }) }],
      url: 'http://localhost/',
      requestInit: { method: 'GET' }
    })
    expect(server.type).toBe('response')
    if (server.type === 'response') expect(server.response.status).toBe(302)
    await server.dispose()
    await runtime.shutdown({ reason: 'test' })
  })
})
