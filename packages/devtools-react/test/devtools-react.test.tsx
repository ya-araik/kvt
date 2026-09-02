import { ViewModel, bind, bootstrapKvt, defineModule, definePlugin } from '@kvt/core'
import { DiagnosticEventBuffer } from '@kvt/devtools-protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KvtDevtoolsOverlay } from '../src/index.js'

describe('@kvt/devtools-react', () => {
  it('renders only inspection metadata and delegates explicit actions', async () => {
    const events = new DiagnosticEventBuffer()
    const runtime = await bootstrapKvt({ diagnostics: events })
    const feature = await runtime.loadFeature({
      id: 'users', version: '1.0.0', load: async () => defineModule({ id: 'users', version: '1.0.0' })
    })
    const retry = vi.fn()
    const invalidate = vi.fn()
    const result = render(<KvtDevtoolsOverlay
      runtime={runtime}
      events={events}
      onRetryFeature={retry}
      onInvalidateQueries={invalidate}
    />)
    expect(screen.getByLabelText('KVT developer tools').textContent).toContain('users@1.0.0')
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Invalidate queries' }))
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ id: 'users', version: '1.0.0' }))
    expect(invalidate).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('KVT developer tools').textContent).not.toContain('private')
    result.unmount()
    await feature.release()
    await runtime.shutdown({ reason: 'test' })
  })

  it('renders nested scope, plugin and ViewModel metadata without optional actions', async () => {
    const events = new DiagnosticEventBuffer()
    class InspectedViewModel extends ViewModel {}
    const runtime = await bootstrapKvt({
      diagnostics: events,
      modules: [defineModule({ id: 'app', version: '1.0.0', providers: [bind(InspectedViewModel).viewModel()] })],
      plugins: [definePlugin({ id: 'diagnostic-plugin', version: '1.0.0' })]
    })
    const child = runtime.rootScope.createChild({ id: 'child' })
    child.createChild({ id: 'grandchild' })
    const lease = runtime.rootViewModelOwner.acquire(InspectedViewModel)
    await lease.commit()
    const result = render(<KvtDevtoolsOverlay runtime={runtime} events={events} maxEvents={1} />)
    const panel = screen.getByLabelText('KVT developer tools')
    expect(panel.textContent).toContain('child [active]')
    expect(panel.textContent).toContain('InspectedViewModel running leases=1')
    expect(panel.textContent).toContain('diagnostic-plugin@1.0.0 running')
    expect(screen.queryByRole('button')).toBeNull()
    result.unmount()
    lease.dispose()
    await runtime.shutdown({ reason: 'test' })
  })
})
