/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  mutate: [
    'packages/core/src/lifecycle.ts',
    'packages/core/src/runtime.ts',
    'packages/core/src/di/registry.ts',
    'packages/core/src/di/scope.ts',
    'packages/flow/src/shared-flow.ts',
    'packages/flow/src/state-flow.ts',
    'packages/react/src/hydration.ts'
  ],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.coverage.config.ts'
  },
  coverageAnalysis: 'perTest',
  mutator: {
    excludedMutations: ['StringLiteral']
  },
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'temp/mutation/mutation.json'
  },
  tempDirName: 'temp/stryker',
  concurrency: 4,
  incremental: true,
  incrementalFile: 'temp/mutation/incremental.json',
  thresholds: {
    high: 90,
    low: 80,
    break: 85
  }
}

export default config
