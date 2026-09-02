import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ViewModel,
  bind,
  bootstrapKvt,
  defineModule
} from '@kvt/core'
import { MutableSharedFlow, MutableStateFlow } from '@kvt/flow'
import { StrictMode, Suspense } from 'react'
import {
  KvtProvider,
  KvtViewModelOwner,
  createHydrationState,
  createHydrationRegistry,
  parseHydrationState,
  serializeHydrationState,
  useSharedFlow,
  useStateFlow,
  useViewModel,
  type HydrationState
} from '../src/index.js'

afterEach(cleanup)

describe('@kvt/react', () => {
  it('observes StateFlow through a required external runtime', async () => {
    const runtime = await bootstrapKvt()
    const state = new MutableStateFlow(1)
    function Value() { return <span>{useStateFlow(state)}</span> }
    render(<KvtProvider runtime={runtime}><Value /></KvtProvider>)
    expect(screen.getByText('1')).toBeTruthy()
    state.set(2)
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy())
    await runtime.shutdown({ reason: 'test' })
  })

  it('owns browser page-exit wiring without shutting down a bfcache page', async () => {
    const persistedRuntime = await bootstrapKvt()
    const persisted = new Event('pagehide')
    Object.defineProperty(persisted, 'persisted', { value: true })
    const cachedPage = render(<KvtProvider runtime={persistedRuntime}><span>cached</span></KvtProvider>)
    window.dispatchEvent(persisted)
    await Promise.resolve()
    expect(persistedRuntime.state).toBe('running')
    cachedPage.unmount()
    await persistedRuntime.shutdown({ reason: 'test' })

    const runtime = await bootstrapKvt()
    render(<KvtProvider runtime={runtime}><span>active</span></KvtProvider>)
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(() => expect(runtime.state).toBe('stopped'))
  })

  it('starts one owner ViewModel across Strict Mode effect replay', async () => {
    const start = vi.fn()
    const stop = vi.fn()
    class TestViewModel extends ViewModel {
      readonly value = new MutableStateFlow('ready').asStateFlow()
      protected override onStart() { start() }
      protected override onStop() { stop() }
    }
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'view-model-test', version: '1.0.0', providers: [bind(TestViewModel).viewModel()]
    })] })
    function Value() {
      const viewModel = useViewModel(TestViewModel)
      return <span>{useStateFlow(viewModel.value)}</span>
    }
    const result = render(
      <StrictMode>
        <KvtProvider runtime={runtime}>
          <KvtViewModelOwner id="test-owner">
            <Value />
          </KvtViewModelOwner>
        </KvtProvider>
      </StrictMode>
    )
    await waitFor(() => expect(screen.getByText('ready')).toBeTruthy())
    expect(start).toHaveBeenCalledOnce()
    result.unmount()
    await waitFor(() => expect(stop).toHaveBeenCalledOnce())
    await runtime.shutdown({ reason: 'test' })
  })

  it('uses explicit keyed hydration and escapes HTML-significant content', () => {
    const hydration: HydrationState = {
      version: 1,
      states: { user: '</script><script>alert(1)</script>' }
    }
    const registry = createHydrationRegistry(hydration)
    expect(registry.read('user', String)).toContain('</script>')
    expect(serializeHydrationState(hydration)).not.toContain('</script>')
    expect(serializeHydrationState(hydration)).toContain('\\u003c')
  })

  it('rejects a runtime identity change without a provider remount', async () => {
    const first = await bootstrapKvt()
    const second = await bootstrapKvt()
    const result = render(<KvtProvider runtime={first}><span>first</span></KvtProvider>)
    expect(() => result.rerender(<KvtProvider runtime={second}><span>second</span></KvtProvider>))
      .toThrow('runtime identity changed')
    await Promise.all([
      first.shutdown({ reason: 'test' }),
      second.shutdown({ reason: 'test' })
    ])
  })

  it('does not subscribe SharedFlow callbacks from a suspended render', async () => {
    const runtime = await bootstrapKvt()
    const events = new MutableSharedFlow<number>()
    const never = new Promise<never>(() => undefined)
    function SuspendedConsumer() {
      useSharedFlow(events, () => undefined)
      throw never
    }
    render(
      <KvtProvider runtime={runtime}>
        <Suspense fallback={<span>pending</span>}><SuspendedConsumer /></Suspense>
      </KvtProvider>
    )
    expect(screen.getByText('pending')).toBeTruthy()
    expect(events.subscriberCount).toBe(0)
    await runtime.shutdown({ reason: 'test' })
  })

  it('aborts and cleans a ViewModel whose owner unmounts during start', async () => {
    const started = vi.fn()
    const stopped = vi.fn()
    let observedSignal: AbortSignal | undefined
    class SlowViewModel extends ViewModel {
      protected override onStart(signal: AbortSignal): Promise<void> {
        started()
        observedSignal = signal
        return new Promise((_resolve, reject) => {
          const abort = () => reject(signal.reason)
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
      }
      protected override onStop() { stopped() }
    }
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'slow-view-model', version: '1.0.0', providers: [bind(SlowViewModel).viewModel()]
    })] })
    function StartSlow() { useViewModel(SlowViewModel); return <>ready</> }
    const result = render(
      <KvtProvider runtime={runtime}>
        <KvtViewModelOwner id="slow-owner"><StartSlow /></KvtViewModelOwner>
      </KvtProvider>
    )
    await waitFor(() => expect(started).toHaveBeenCalledOnce())
    result.unmount()
    await waitFor(() => expect(observedSignal?.aborted).toBe(true))
    await waitFor(() => expect(stopped).toHaveBeenCalledOnce())
    expect(runtime.inspect().rootScope.childCount).toBe(0)
    await runtime.shutdown({ reason: 'test' })
  })

  it('validates hydration keys and recursively rejects non-JSON state', () => {
    const value = new MutableStateFlow({ nested: { invalid: undefined } })
    expect(() => createHydrationState([{
      key: 'invalid',
      flow: value,
      serialize: (entry) => entry
    }])).toThrow('not JSON serializable')
    expect(() => parseHydrationState('{"version":1,"states":{"__proto__":{}}}'))
      .toThrow('Invalid hydration state key')
    const valid = parseHydrationState('{"version":1,"states":{"counter":1}}')
    expect(createHydrationRegistry(valid).read('counter', Number)).toBe(1)
  })

  it('detects in-place StateFlow snapshot mutation in development', async () => {
    const runtime = await bootstrapKvt()
    const value = { count: 1 }
    const state = new MutableStateFlow(value)
    function Consumer({ marker }: { readonly marker: number }) {
      const snapshot = useStateFlow(state, { stateKey: 'counter' })
      return <span>{snapshot.count + marker}</span>
    }
    const result = render(<KvtProvider runtime={runtime}><Consumer marker={0} /></KvtProvider>)
    value.count = 2
    expect(() => result.rerender(<KvtProvider runtime={runtime}><Consumer marker={1} /></KvtProvider>))
      .toThrow('mutated without changing identity')
    await runtime.shutdown({ reason: 'test' })
  })
})
