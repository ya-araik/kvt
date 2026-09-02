import { performance } from 'node:perf_hooks'
import { readFile } from 'node:fs/promises'
import {
  bootstrapKvt,
  createToken,
  defineModule,
  provide
} from '@kvt/core'
import { MutableStateFlow } from '@kvt/flow'

const baseline = JSON.parse(await readFile(new URL('../benchmarks/baseline.json', import.meta.url), 'utf8'))
const results = {
  stateFlowWritesPerSecond: await bestOf(3, () => stateFlowWrites(500_000)),
  transientResolutionsPerSecond: await bestOf(3, () => transientResolutions(100_000)),
  runtimeCyclesPerSecond: await bestOf(3, () => runtimeCycles(500))
}

let failed = false
for (const [name, measured] of Object.entries(results)) {
  const expected = baseline[name]
  if (!Number.isFinite(expected) || expected <= 0) throw new Error(`Invalid benchmark baseline for ${name}`)
  const minimum = expected * 0.9
  console.log(`${name}: ${Math.round(measured).toLocaleString('en-US')} ops/s; gate ${Math.round(minimum).toLocaleString('en-US')} ops/s`)
  if (measured < minimum) failed = true
}
if (failed) throw new Error('A benchmark regressed by more than 10% from the committed baseline')

async function bestOf(attempts, run) {
  const samples = []
  for (let attempt = 0; attempt < attempts; attempt++) samples.push(await run())
  return Math.max(...samples)
}

function stateFlowWrites(iterations) {
  const state = new MutableStateFlow(0)
  let observed = 0
  const subscription = state.subscribe((value) => { observed = value }, { emitCurrent: false })
  const start = performance.now()
  for (let index = 1; index <= iterations; index++) state.set(index)
  const duration = performance.now() - start
  subscription.cancel()
  if (observed !== iterations) throw new Error('StateFlow benchmark lost an update')
  return iterations / (duration / 1_000)
}

async function transientResolutions(iterations) {
  const token = createToken('benchmark-transient')
  const runtime = await bootstrapKvt({ modules: [defineModule({
    id: 'benchmark',
    version: '1.0.0',
    providers: [provide(token).using(() => Object.freeze({ value: 1 })).transient()]
  })] })
  const start = performance.now()
  for (let index = 0; index < iterations; index++) runtime.resolve(token)
  const duration = performance.now() - start
  await runtime.shutdown({ reason: 'benchmark' })
  return iterations / (duration / 1_000)
}

async function runtimeCycles(iterations) {
  const start = performance.now()
  for (let index = 0; index < iterations; index++) {
    const runtime = await bootstrapKvt()
    await runtime.shutdown({ reason: 'benchmark' })
  }
  return iterations / ((performance.now() - start) / 1_000)
}
