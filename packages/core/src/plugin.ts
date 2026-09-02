import type { DiagnosticEvent } from './diagnostics.js'
import type { ShutdownContext } from './lifecycle.js'
import type { KvtScope } from './di/scope.js'
import type { ModuleDefinition, ModuleRequirement } from './di/module.js'
import { validateManifestIdentity, validateRequirements } from './di/module.js'

export interface PluginStartContext {
  readonly scope: KvtScope
  emitDiagnostic(event: Omit<DiagnosticEvent, 'protocolVersion' | 'sequence' | 'timestamp'>): void
}

export interface PluginDefinition {
  readonly id: string
  readonly version: string
  readonly requires: readonly ModuleRequirement[]
  readonly modules: readonly ModuleDefinition[]
  readonly start?: (context: PluginStartContext) => void | Promise<void>
  readonly shutdown?: (context: ShutdownContext) => void | Promise<void>
}

export interface DefinePluginOptions extends Omit<PluginDefinition, 'requires' | 'modules'> {
  readonly requires?: readonly ModuleRequirement[]
  readonly modules?: readonly ModuleDefinition[]
}

export function definePlugin(options: DefinePluginOptions): PluginDefinition {
  validateManifestIdentity(options.id, options.version, 'plugin')
  validateRequirements(options.requires ?? [], `plugin ${options.id}`)
  return Object.freeze({
    id: options.id,
    version: options.version,
    requires: Object.freeze((options.requires ?? []).map((requirement) => Object.freeze({ ...requirement }))),
    modules: Object.freeze([...(options.modules ?? [])]),
    ...(options.start === undefined ? {} : { start: options.start }),
    ...(options.shutdown === undefined ? {} : { shutdown: options.shutdown })
  })
}
