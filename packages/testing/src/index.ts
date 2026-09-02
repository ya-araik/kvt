import {
  bootstrapKvt,
  defineModule,
  type BootstrapKvtOptions,
  type KvtRuntime,
  type ModuleDefinition,
  type PluginDefinition,
  type OverridableProviderRegistration,
  type ProviderRegistration
} from '@kvt/core'
import { VirtualScheduler, type Flow, type Subscription } from '@kvt/flow'
import { createKvtQueryClient, type KvtQueryClient } from '@kvt/query'

export { VirtualScheduler }

export class TestRuntimeBuilder {
  readonly #modules: ModuleDefinition[] = []
  readonly #plugins: PluginDefinition[] = []
  readonly #overrides: ProviderRegistration[] = []
  #options: Omit<BootstrapKvtOptions, 'modules' | 'plugins'> = {}

  module(module: ModuleDefinition): this {
    this.#modules.push(module)
    return this
  }

  plugin(plugin: PluginDefinition): this {
    this.#plugins.push(plugin)
    return this
  }

  override(provider: OverridableProviderRegistration): this {
    this.#overrides.push(provider.override())
    return this
  }

  options(options: Omit<BootstrapKvtOptions, 'modules' | 'plugins'>): this {
    this.#options = options
    return this
  }

  async build(): Promise<KvtRuntime> {
    const modules = [...this.#modules]
    if (this.#overrides.length > 0) modules.push(defineModule({
      id: 'kvt-test-overrides', version: '1.0.0', providers: this.#overrides
    }))
    return bootstrapKvt({ ...this.#options, modules, plugins: this.#plugins })
  }
}

type TurbineEvent<T> =
  | { readonly type: 'item'; readonly value: T }
  | { readonly type: 'complete' }
  | { readonly type: 'error'; readonly error: unknown }

export class FlowTurbine<T> {
  readonly #events: TurbineEvent<T>[] = []
  readonly #waiters: Array<{ readonly accept: (event: TurbineEvent<T>) => void }> = []
  readonly #subscription: Subscription

  constructor(flow: Flow<T>, signal?: AbortSignal) {
    this.#subscription = flow.subscribe({
      next: (value) => this.#push({ type: 'item', value }),
      complete: () => this.#push({ type: 'complete' }),
      error: (error) => this.#push({ type: 'error', error })
    }, { ...(signal === undefined ? {} : { signal }) })
  }

  async awaitItem(timeoutMs = 1_000): Promise<T> {
    const event = await this.#next(timeoutMs)
    if (event.type === 'item') return event.value
    if (event.type === 'error') throw event.error
    throw new Error('Flow completed before the next item')
  }

  async awaitComplete(timeoutMs = 1_000): Promise<void> {
    const event = await this.#next(timeoutMs)
    if (event.type === 'complete') return
    if (event.type === 'error') throw event.error
    throw new Error('Expected completion but received an item')
  }

  async awaitError(timeoutMs = 1_000): Promise<unknown> {
    const event = await this.#next(timeoutMs)
    if (event.type === 'error') return event.error
    throw new Error(`Expected an error but received ${event.type}`)
  }

  expectNoEvents(): void {
    if (this.#events.length > 0) throw new Error(`Expected no Flow events; received ${this.#events[0]?.type}`)
  }

  cancel(): void {
    this.#subscription.cancel('test-cancelled')
  }

  async cancelAndIgnoreRemainingEvents(): Promise<void> {
    this.cancel()
    await this.#subscription.done.catch(() => undefined)
    this.#events.length = 0
  }

  #push(event: TurbineEvent<T>): void {
    const waiter = this.#waiters.shift()
    if (waiter) waiter.accept(event)
    else this.#events.push(event)
  }

  #next(timeoutMs: number): Promise<TurbineEvent<T>> {
    const event = this.#events.shift()
    if (event) return Promise.resolve(event)
    return new Promise<TurbineEvent<T>>((resolve, reject) => {
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        reject(new RangeError('Flow assertion timeout must be a non-negative finite number'))
        return
      }
      const waiter = { accept: (received: TurbineEvent<T>) => {
        clearTimeout(timeout)
        resolve(received)
      } }
      const timeout = setTimeout(() => {
        const index = this.#waiters.indexOf(waiter)
        if (index >= 0) this.#waiters.splice(index, 1)
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for Flow event`))
      }, timeoutMs)
      this.#waiters.push(waiter)
    })
  }
}

export function collectFlow<T>(flow: Flow<T>, signal?: AbortSignal): FlowTurbine<T> {
  return new FlowTurbine(flow, signal)
}

export function createTestQueryClient(runtime: KvtRuntime): KvtQueryClient {
  return createKvtQueryClient({ scope: runtime.rootScope, defaultStaleTimeMs: Infinity, defaultCacheTimeMs: Infinity })
}

export function assertRuntimeReleased(runtime: KvtRuntime): void {
  const inspection = runtime.inspect()
  if (runtime.state !== 'stopped' || inspection.rootScope.childCount !== 0 || inspection.rootScope.ownedResourceCount !== 0) {
    throw new Error(`Runtime retained resources: ${JSON.stringify(inspection.rootScope)}`)
  }
}

export async function verifyPluginContract(plugin: PluginDefinition): Promise<void> {
  const runtime = await bootstrapKvt({ plugins: [plugin] })
  const first = runtime.shutdown({ reason: 'plugin-contract' })
  const second = runtime.shutdown({ reason: 'plugin-contract-repeat' })
  if (first !== second) throw new Error('Plugin runtime shutdown is not idempotent')
  await first
  assertRuntimeReleased(runtime)
}
