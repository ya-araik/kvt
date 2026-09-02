import { defineConfig } from 'vitest/config'

const strictCoverage = process.env.COVERAGE_STRICT === '1'

const nodeTests = [
  'packages/cli/test/**/*.test.ts',
  'packages/create-kvt/test/**/*.test.ts',
  'packages/core/test/**/*.test.ts',
  'packages/devtools-protocol/test/**/*.test.ts',
  'packages/flow/test/**/*.test.ts',
  'packages/otel/test/**/*.test.ts',
  'packages/query/test/**/*.test.ts',
  'packages/router-react/test/**/*.test.ts',
  'packages/testing/test/**/*.test.ts',
  'packages/theme-core/test/**/*.test.ts',
  'packages/theme-tailwind/test/**/*.test.ts'
]

const browserTests = [
  'packages/devtools-react/test/**/*.test.tsx',
  'packages/react/test/**/*.test.ts',
  'packages/react/test/**/*.test.tsx',
  'packages/router-react/test/**/*.test.tsx',
  'packages/testing-react/test/**/*.test.tsx',
  'packages/theme-react/test/**/*.test.tsx'
]

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: nodeTests
        }
      },
      {
        test: {
          name: 'browser',
          environment: 'jsdom',
          include: browserTests
        }
      }
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        'packages/{core,flow,react}/src/index.ts',
        'packages/create-kvt/src/index.ts'
      ],
      reporter: ['text-summary', 'json-summary', 'json'],
      reportsDirectory: 'temp/coverage',
      ...(strictCoverage ? {
        thresholds: {
          statements: 90,
          functions: 90,
          lines: 90,
          branches: 85,
          'packages/core/src/{lifecycle,runtime}.ts': { branches: 100 },
          'packages/core/src/di/**/*.ts': { branches: 100 },
          'packages/flow/src/{shared-flow,state-flow,subscription}.ts': { branches: 100 },
          'packages/react/src/hydration.ts': { branches: 100 }
        }
      } : {})
    }
  }
})
