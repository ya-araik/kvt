import { ViewModel, bind, bootstrapKvt, defineModule } from '@kvt/core'
import { MutableSharedFlow, MutableStateFlow } from '@kvt/flow'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import {
  KvtErrorBoundary,
  KvtProvider,
  KvtSuspenseBoundary,
  KvtViewModelOwner,
  createHydrationState,
  runKvtTransition,
  useKvtRuntime,
  useSharedFlow,
  useStateFlow,
  useViewModel
} from '../src/index.js'

afterEach(() => cleanup())

describe('@kvt/react extended adapter', () => {
  it('requires a provider and a running external runtime', async () => {
    function RuntimeConsumer() { return <span>{useKvtRuntime().state}</span> }
    expect(() => render(<RuntimeConsumer />)).toThrow('KVT hooks require a KvtProvider')
    const runtime = await bootstrapKvt()
    await runtime.shutdown({ reason: 'test' })
    expect(() => render(<KvtProvider runtime={runtime}><span>no</span></KvtProvider>)).toThrow('requires a running runtime')
  })

  it('selects StateFlow values with custom equality and suppresses unrelated renders', async () => {
    const runtime = await bootstrapKvt()
    const state = new MutableStateFlow({ count: 1, label: 'first' })
    const renders = vi.fn()
    function Consumer() {
      renders()
      const count = useStateFlow(state, { selector: (value) => value.count, equality: (left, right) => left === right })
      return <span>{count}</span>
    }
    render(<KvtProvider runtime={runtime}><Consumer /></KvtProvider>)
    const initial = renders.mock.calls.length
    state.set({ count: 1, label: 'second' })
    await Promise.resolve()
    expect(renders).toHaveBeenCalledTimes(initial)
    state.set({ count: 2, label: 'second' })
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy())
    await runtime.shutdown({ reason: 'test' })
  })

  it('reads matching hydration with a deserializer and reports mismatches by key', async () => {
    const runtime = await bootstrapKvt()
    const state = new MutableStateFlow(2)
    const matching = createHydrationState([{ key: 'counter', flow: state, serialize: (value) => String(value) }])
    function Consumer() {
      return <span>{useStateFlow(state, { stateKey: 'counter', deserialize: (value) => Number(value) })}</span>
    }
    const result = render(<KvtProvider runtime={runtime} hydration={matching}><Consumer /></KvtProvider>)
    expect(screen.getByText('2')).toBeTruthy()
    result.unmount()

    const mismatch = { version: 1 as const, states: { counter: 3 } }
    expect(() => render(<KvtProvider runtime={runtime} hydration={mismatch}><Consumer /></KvtProvider>))
      .toThrow('hydration mismatch for StateFlow key "counter"')
    await runtime.shutdown({ reason: 'test' })
  })

  it('keeps the latest committed SharedFlow handler and removes the subscription on unmount', async () => {
    const runtime = await bootstrapKvt()
    const events = new MutableSharedFlow<number>()
    const calls: string[] = []
    function Consumer({ prefix }: { prefix: string }) {
      useSharedFlow(events, (value) => { calls.push(`${prefix}:${value}`) })
      return null
    }
    const result = render(<KvtProvider runtime={runtime}><Consumer prefix="first" /></KvtProvider>)
    expect(events.subscriberCount).toBe(1)
    result.rerender(<KvtProvider runtime={runtime}><Consumer prefix="second" /></KvtProvider>)
    await events.emit(1)
    expect(calls).toEqual(['second:1'])
    result.unmount()
    await waitFor(() => expect(events.subscriberCount).toBe(0))
    await runtime.shutdown({ reason: 'test' })
  })

  it('renders static and functional error fallbacks and allows reset', () => {
    const onError = vi.fn()
    function Broken({ fail }: { fail: boolean }) { if (fail) throw new Error('broken'); return <span>healthy</span> }
    function Harness() {
      const [fail, setFail] = useState(true)
      return <KvtErrorBoundary onError={onError} fallback={(_error, reset) => <button onClick={() => { setFail(false); reset() }}>recover</button>}>
        <Broken fail={fail} />
      </KvtErrorBoundary>
    }
    render(<Harness />)
    expect(screen.getByText('recover')).toBeTruthy()
    expect(onError).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('recover'))
    expect(screen.getByText('healthy')).toBeTruthy()

    cleanup()
    expect(() => render(<KvtErrorBoundary fallback={<span>static</span>}><Broken fail /></KvtErrorBoundary>)).not.toThrow()
    expect(screen.getByText('static')).toBeTruthy()
  })

  it('wraps Suspense and transition helpers without owning resources', async () => {
    const pending = new Promise<never>(() => undefined)
    function Suspended() { throw pending }
    render(<KvtSuspenseBoundary fallback={<span>loading</span>}><Suspended /></KvtSuspenseBoundary>)
    expect(screen.getByText('loading')).toBeTruthy()
    const operation = vi.fn()
    runKvtTransition(operation)
    expect(operation).toHaveBeenCalledOnce()
  })

  it('throws for undefined ViewModels and surfaces failed owner startup through an error boundary', async () => {
    const runtime = await bootstrapKvt()
    class MissingViewModel extends ViewModel {}
    function Missing() { useViewModel(MissingViewModel); return null }
    expect(() => render(<KvtProvider runtime={runtime}><Missing /></KvtProvider>)).toThrow('No provider registered')
    await runtime.shutdown({ reason: 'missing-complete' })

    class BrokenViewModel extends ViewModel {
      protected override onStart() { throw new Error('view-model failed') }
    }
    const brokenRuntime = await bootstrapKvt({ modules: [defineModule({
      id: 'broken', version: '1.0.0', providers: [bind(BrokenViewModel).viewModel()]
    })] })
    const report = vi.spyOn(brokenRuntime, 'reportError')
    function BrokenConsumer() { useViewModel(BrokenViewModel); return <span>ready</span> }
    render(<KvtErrorBoundary fallback={<span>failed-boundary</span>}>
      <KvtProvider runtime={brokenRuntime}>
        <KvtViewModelOwner id="broken"><BrokenConsumer /></KvtViewModelOwner>
      </KvtProvider>
    </KvtErrorBoundary>)
    await waitFor(() => expect(screen.getByText('failed-boundary')).toBeTruthy())
    expect(report).not.toHaveBeenCalledWith(expect.anything(), 'owner-start-rollback', expect.anything())
    await brokenRuntime.shutdown({ reason: 'test' })
  })

  it('uses an explicit owner scope and exposes a committed shared ViewModel to consumers', async () => {
    class ValueViewModel extends ViewModel { readonly state = new MutableStateFlow('ready') }
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'explicit-owner', version: '1.0.0', providers: [bind(ValueViewModel).viewModel()]
    })] })
    const explicit = runtime.rootScope.createChild({ id: 'explicit' })
    function Consumer() { return <span>{useStateFlow(useViewModel(ValueViewModel).state)}</span> }
    const result = render(<KvtProvider runtime={runtime}>
      <KvtViewModelOwner id="explicit-owner" scope={explicit}>
        <Consumer />
      </KvtViewModelOwner>
    </KvtProvider>)
    await waitFor(() => expect(screen.getByText('ready')).toBeTruthy())
    result.unmount()
    await waitFor(() => expect(explicit.childCount).toBe(0))
    await runtime.shutdown({ reason: 'test' })
  })

  it('supports keyed instances inside one owner', async () => {
    class ValueViewModel extends ViewModel {}
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'keyed-owner', version: '1.0.0', providers: [bind(ValueViewModel).viewModel()]
    })] })
    const values: ValueViewModel[] = []
    function Consumer() {
      values.push(useViewModel(ValueViewModel, { key: 'first' }), useViewModel(ValueViewModel, { key: 'second' }))
      return null
    }
    render(<KvtProvider runtime={runtime}><KvtViewModelOwner id="keyed"><Consumer /></KvtViewModelOwner></KvtProvider>)
    expect(values[0]).not.toBe(values[1])
    await runtime.shutdown({ reason: 'test' })
  })
})
