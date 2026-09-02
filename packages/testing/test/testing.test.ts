import { createToken, defineModule, definePlugin, provide } from '@kvt/core'
import { Flow, callbackFlow, flowOf } from '@kvt/flow'
import { describe, expect, it } from 'vitest'
import {
  TestRuntimeBuilder,
  assertRuntimeReleased,
  collectFlow,
  createTestQueryClient,
  verifyPluginContract
} from '../src/index.js'

describe('@kvt/testing', () => {
  it('applies explicit DI overrides and verifies release ownership', async () => {
    const token = createToken<string>('value')
    const runtime = await new TestRuntimeBuilder()
      .module(defineModule({ id: 'base', version: '1.0.0', providers: [provide(token).value('base')] }))
      .override(provide(token).value('test'))
      .build()
    expect(runtime.resolve(token)).toBe('test')
    await runtime.shutdown({ reason: 'test' })
    expect(() => assertRuntimeReleased(runtime)).not.toThrow()
  })

  it('collects items, completion and errors without retaining timed-out waiters', async () => {
    const turbine = collectFlow(flowOf(1, 2))
    expect(await turbine.awaitItem()).toBe(1)
    expect(await turbine.awaitItem()).toBe(2)
    await turbine.awaitComplete()

    const failing = collectFlow(new Flow<number>(() => { throw new Error('failure') }))
    await expect(failing.awaitError()).resolves.toMatchObject({ message: 'failure' })

    const silent = collectFlow(callbackFlow(() => undefined))
    await expect(silent.awaitItem(1)).rejects.toThrow('Timed out')
    await silent.cancelAndIgnoreRemainingEvents()
  })

  it('supports plugins, bootstrap options and a scope-owned query test client', async () => {
    const diagnostics: unknown[] = []
    const started: string[] = []
    const runtime = await new TestRuntimeBuilder()
      .plugin(definePlugin({ id: 'test-plugin', version: '1.0.0', start: () => { started.push('yes') } }))
      .options({ diagnostics: { emit: (event) => diagnostics.push(event) } })
      .build()
    const query = createTestQueryClient(runtime)
    query.setData(['test'], 42)
    expect(query.getData(['test'])).toBe(42)
    expect(started).toEqual(['yes'])
    expect(diagnostics.length).toBeGreaterThan(0)
    await runtime.shutdown({ reason: 'test' })
  })

  it('covers all Turbine terminal assertions and validation failures', async () => {
    const item = collectFlow(flowOf(1))
    await expect(item.awaitComplete()).rejects.toThrow('received an item')

    const complete = collectFlow(flowOf<number>())
    await expect(complete.awaitItem()).rejects.toThrow('completed before')

    const failure = collectFlow(new Flow<never>(() => { throw new Error('boom') }))
    await expect(failure.awaitItem()).rejects.toThrow('boom')

    const completeInsteadOfError = collectFlow(flowOf<number>())
    await expect(completeInsteadOfError.awaitError()).rejects.toThrow('received complete')

    const valueInsteadOfError = collectFlow(flowOf(1))
    await expect(valueInsteadOfError.awaitError()).rejects.toThrow('received item')

    const buffered = collectFlow(flowOf(1))
    await Promise.resolve()
    await Promise.resolve()
    expect(() => buffered.expectNoEvents()).toThrow('received item')

    const silent = collectFlow(callbackFlow(() => undefined))
    await expect(silent.awaitItem(-1)).rejects.toThrow(RangeError)
    await silent.cancelAndIgnoreRemainingEvents()
  })

  it('detects retained runtimes and verifies plugin shutdown idempotency', async () => {
    const active = await new TestRuntimeBuilder().build()
    expect(() => assertRuntimeReleased(active)).toThrow('Runtime retained resources')
    await active.shutdown({ reason: 'test' })

    const stopped = definePlugin({ id: 'contract', version: '1.0.0' })
    await expect(verifyPluginContract(stopped)).resolves.toBeUndefined()
  })
})
