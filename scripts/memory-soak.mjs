import { bind, bootstrapKvt, createToken, defineModule, provide, ViewModel, ViewModelOwner } from '@kvt/core'
import { MutableStateFlow, derivedStateFlow } from '@kvt/flow'
import { createKvtQueryClient, createQueryKey } from '@kvt/query'

if (typeof globalThis.gc !== 'function') {
  throw new Error('The memory soak must run with node --expose-gc')
}

const cycles = 10_000
const sampleEvery = 1_000
let started = 0
let stopped = 0
let disposed = 0

class SoakViewModel extends ViewModel {
  #source

  constructor(source) {
    super()
    this.#source = source
  }

  onStart() {
    started++
    this.own(this.#source.subscribe(() => undefined))
    this.own({ dispose: () => { disposed++ } })
  }

  onStop() {
    stopped++
  }
}

const source = new MutableStateFlow(0)
const sourceToken = createToken('memory-soak-source')
const runtime = await bootstrapKvt({ modules: [defineModule({
  id: 'memory-soak', version: '1.0.0', providers: [
    provide(sourceToken).value(source),
    bind(SoakViewModel).inject(sourceToken).viewModel()
  ]
})] })
const heaps = []

for (let index = 1; index <= cycles; index++) {
  const owner = new ViewModelOwner(`soak-${index}`, runtime.rootScope)
  const lease = owner.acquire(SoakViewModel)
  await lease.commit()
  lease.dispose()
  await owner.shutdown({
    signal: new AbortController().signal,
    reason: 'memory-soak-cycle',
    deadline: undefined
  })
  if (runtime.rootScope.childCount !== 0 || source.subscriberCount !== 0) {
    throw new Error(`Resource leak after cycle ${index}: children=${runtime.rootScope.childCount}, subscribers=${source.subscriberCount}`)
  }
  if (index % sampleEvery === 0) {
    globalThis.gc()
    await new Promise((resolve) => setImmediate(resolve))
    globalThis.gc()
    heaps.push(process.memoryUsage().heapUsed)
  }
}

const derived = derivedStateFlow([source], (value) => value * 2)
for (let index = 0; index < cycles; index++) {
  const subscription = derived.subscribe(() => undefined)
  subscription.cancel()
  await subscription.done
}
if (source.subscriberCount !== 0) throw new Error(`Derived StateFlow retained ${source.subscriberCount} source subscriptions`)

const queryClient = createKvtQueryClient({ scope: runtime.rootScope })
for (let index = 0; index < 1_000; index++) {
  const query = queryClient.observe({
    key: createQueryKey('memory-soak-query', index),
    enabled: false,
    query: async () => index
  })
  const subscription = query.subscribe(() => undefined)
  subscription.cancel()
  await subscription.done
  query.dispose()
}

if (started !== cycles || stopped !== cycles || disposed !== cycles) {
  throw new Error(`Lifecycle mismatch: started=${started}, stopped=${stopped}, disposed=${disposed}, expected=${cycles}`)
}

const warmHeap = heaps[1] ?? heaps[0] ?? 0
const finalHeap = heaps.at(-1) ?? 0
const retainedGrowth = finalHeap - warmHeap
const maximumRetainedGrowth = 8 * 1024 * 1024
if (retainedGrowth > maximumRetainedGrowth) {
  throw new Error(`Retained heap grew by ${(retainedGrowth / 1024 / 1024).toFixed(2)} MiB; limit is 8 MiB`)
}

await runtime.shutdown({ reason: 'memory-soak-complete' })
const inspection = runtime.inspect()
if (inspection.rootScope.childCount !== 0 || inspection.rootScope.ownedResourceCount !== 0 || source.subscriberCount !== 0) {
  throw new Error(`Shutdown retained resources: ${JSON.stringify(inspection.rootScope)}`)
}

console.log(JSON.stringify({
  cycles,
  started,
  stopped,
  disposed,
  retainedHeapMiB: Number((retainedGrowth / 1024 / 1024).toFixed(2)),
  rootChildren: inspection.rootScope.childCount,
  rootResources: inspection.rootScope.ownedResourceCount,
  subscribers: source.subscriberCount
}, null, 2))
