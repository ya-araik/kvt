import { describe, expect, it } from 'vitest'
/* eslint-disable @typescript-eslint/no-explicit-any -- These tests deliberately bypass the public typestate API to verify runtime guards for plain JavaScript consumers. */
import {
  KvtError,
  ViewModel,
  bind,
  bootstrapKvt,
  createToken,
  defineModule,
  identifierDescription,
  provide,
  type ProviderRegistration
} from '../src/index.js'

function expectInvalidChain(operation: () => unknown): void {
  expect(operation).toThrow(expect.objectContaining({ code: 'KVT_DI_BINDING_CHAIN_INVALID' }))
}

describe('bind/provide runtime contract guards', () => {
  it('rejects every invalid repeated selector operation even when JavaScript bypasses typings', () => {
    abstract class Contract { abstract read(): string }
    class Implementation extends Contract { read(): string { return 'value' } }
    const value = createToken<string>('value')

    const factory = provide(value).using(() => 'value') as any
    expectInvalidChain(() => factory.inject(value))
    expectInvalidChain(() => factory.to(Implementation))
    expectInvalidChain(() => factory.toExisting(value))
    expectInvalidChain(() => factory.value('other'))
    expectInvalidChain(() => factory.using(() => 'other'))
    expectInvalidChain(() => factory.usingAsync(async () => 'other'))

    const implementation = bind(Contract).to(Implementation) as any
    expectInvalidChain(() => implementation.to(Implementation))
    expectInvalidChain(() => implementation.toExisting(value))

    const overridden = provide(value).value('value').override() as any
    expectInvalidChain(() => overridden.override())
  })

  it('rejects incompatible lifecycle and eager combinations at runtime', () => {
    class ExampleViewModel extends ViewModel {}
    class PlainClass {}
    const asyncViewModel = provide(ExampleViewModel).usingAsync(async () => new ExampleViewModel()) as any

    expectInvalidChain(() => (bind(ExampleViewModel).singleton() as any).viewModel())
    expectInvalidChain(() => (bind(ExampleViewModel).viewModel() as any).viewModel())
    expectInvalidChain(() => (bind(PlainClass) as any).viewModel())
    expectInvalidChain(() => asyncViewModel.viewModel())
    expectInvalidChain(() => (bind(ExampleViewModel).viewModel() as any).singleton())
    expectInvalidChain(() => (bind(ExampleViewModel).viewModel() as any).eager())
    expectInvalidChain(() => (bind(PlainClass).transient() as any).eager())
    expectInvalidChain(() => (bind(PlainClass).singleton().eager() as any).eager())
  })

  it('rejects invalid and incomplete module registrations with actionable codes', () => {
    const token = createToken<string>('incomplete-token')
    abstract class IncompleteContract { abstract read(): string }

    expect(() => defineModule({
      id: 'invalid-registration', version: '1.0.0', providers: [{} as ProviderRegistration]
    })).toThrow(expect.objectContaining({ code: 'KVT_DI_PROVIDER_REGISTRATION_INVALID' }))

    expect(() => defineModule({
      id: 'incomplete-token', version: '1.0.0', providers: [provide(token) as unknown as ProviderRegistration]
    })).toThrow(expect.objectContaining({ code: 'KVT_DI_BINDING_INCOMPLETE' }))

    expect(() => defineModule({
      id: 'incomplete-alias', version: '1.0.0',
      providers: [(provide(token) as any).toExisting(undefined)]
    })).toThrow(expect.objectContaining({ code: 'KVT_DI_BINDING_INCOMPLETE' }))

    expect(() => defineModule({
      id: 'incomplete-class-alias', version: '1.0.0',
      providers: [(bind(IncompleteContract) as any).toExisting(undefined)]
    })).toThrow(expect.objectContaining({ code: 'KVT_DI_BINDING_INCOMPLETE' }))
  })

  it('builds the implicit concrete-class factory path', async () => {
    class Dependency { readonly value = 'dependency' }
    class Consumer {
      constructor(readonly dependency: Dependency) {}
    }
    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'implicit-factory', version: '1.0.0',
      providers: [bind(Dependency), bind(Consumer).inject(Dependency)]
    })] })
    expect(runtime.resolve(Consumer).dependency).toBeInstanceOf(Dependency)
    await runtime.shutdown({ reason: 'test' })
  })
})

describe('ViewModel DI owner boundaries', () => {
  it('distinguishes missing, ordinary and invalid ViewModel providers', async () => {
    class MissingViewModel extends ViewModel {}
    class OrdinaryViewModel extends ViewModel {}
    class InvalidViewModel extends ViewModel {}
    class OtherViewModel extends ViewModel {}

    const runtime = await bootstrapKvt({ modules: [defineModule({
      id: 'view-model-provider-guards', version: '1.0.0', providers: [
        bind(OrdinaryViewModel),
        provide(InvalidViewModel).using(() => new OtherViewModel()).viewModel()
      ]
    })] })

    expect(() => runtime.rootScope.createViewModel(MissingViewModel))
      .toThrow(expect.objectContaining({ code: 'KVT_DI_PROVIDER_MISSING' }))
    expect(() => runtime.rootScope.createViewModel(OrdinaryViewModel))
      .toThrow(expect.objectContaining({ code: 'KVT_VIEW_MODEL_PROVIDER_REQUIRED' }))
    expect(() => runtime.rootScope.createViewModel(InvalidViewModel))
      .toThrow(expect.objectContaining({ code: 'KVT_VIEW_MODEL_PROVIDER_INVALID' }))
    await expect(runtime.rootScope.resolveAsync(InvalidViewModel))
      .rejects.toMatchObject({ code: 'KVT_VIEW_MODEL_OWNER_REQUIRED' })

    await runtime.shutdown({ reason: 'test' })
  })

  it('uses a stable fallback description for anonymous class identifiers', () => {
    const Anonymous = class {}
    Object.defineProperty(Anonymous, 'name', { value: '' })
    expect(identifierDescription(Anonymous)).toBe('<anonymous-class>')
  })
})

describe('provider factory validation', () => {
  it('reports the sync selector name for an invalid repeated using call', () => {
    const token = createToken<string>('factory-operation')
    try {
      ;(provide(token).using(() => 'value') as any).using(() => 'other')
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(KvtError)
      expect((error as KvtError).operation).toBe('using')
    }
  })

  it('reports the async selector name for an invalid repeated using call', () => {
    const token = createToken<string>('async-factory-operation')
    try {
      ;(provide(token).using(() => 'value') as any).usingAsync(async () => 'other')
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(KvtError)
      expect((error as KvtError).operation).toBe('usingAsync')
    }
  })
})
