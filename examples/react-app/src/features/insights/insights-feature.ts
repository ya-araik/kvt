import type { FeatureDefinition } from '@kvt/core'

export const insightsFeature: FeatureDefinition = {
  id: 'todo-insights',
  version: '1.0.0',
  load: async () => (await import('./insights-module.js')).insightsModule,
  retry: { attempts: 2, delayMs: 250 }
}
