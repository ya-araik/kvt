import type { KvtRuntime } from '@kvt/core'
import type { DiagnosticEventBuffer } from '@kvt/devtools-protocol'
import { useSyncExternalStore, type CSSProperties } from 'react'

export interface KvtDevtoolsOverlayProps {
  readonly runtime: KvtRuntime
  readonly events: DiagnosticEventBuffer
  readonly maxEvents?: number
  readonly onRetryFeature?: (feature: { readonly id: string; readonly version: string }) => void | Promise<void>
  readonly onInvalidateQueries?: () => void | Promise<void>
}

const panelStyle: CSSProperties = {
  position: 'fixed', right: 12, bottom: 12, zIndex: 2147483647, width: 420, maxHeight: '70vh',
  overflow: 'auto', padding: 12, borderRadius: 8, color: '#e8e8ec', background: '#17181c',
  border: '1px solid #3f4149', font: '12px/1.4 ui-monospace, monospace', boxShadow: '0 12px 36px rgb(0 0 0 / 0.35)'
}

export function KvtDevtoolsOverlay({
  runtime,
  events,
  maxEvents = 100,
  onRetryFeature,
  onInvalidateQueries
}: KvtDevtoolsOverlayProps) {
  const timeline = useSyncExternalStore(events.subscribe, events.snapshot, events.snapshot)
  const inspection = runtime.inspect()
  return <aside aria-label="KVT developer tools" style={panelStyle}>
    <header><strong>KVT {inspection.state}</strong></header>
    <section>
      <div>Root: {inspection.rootScope.state}</div>
      <div>Scopes: {inspection.rootScope.childCount}</div>
      <div>Owned resources: {inspection.rootScope.ownedResourceCount}</div>
      <div>ViewModels: {inspection.rootViewModelOwner.entries.length}</div>
    </section>
    <details><summary>Scope tree</summary><ScopeTree scope={inspection.rootScope} /></details>
    <details><summary>ViewModels ({inspection.rootViewModelOwner.entries.length})</summary>
      {inspection.rootViewModelOwner.entries.map((entry) => <div key={entry.key}>
        {entry.key} {entry.state} leases={entry.leases}
      </div>)}
    </details>
    <details open><summary>Modules ({inspection.modules.length})</summary>
      {inspection.modules.map((module) => <div key={module.id}>{module.id}@{module.version}</div>)}
    </details>
    <details><summary>Plugins ({inspection.plugins.length})</summary>
      {inspection.plugins.map((plugin) => <div key={plugin.id}>{plugin.id}@{plugin.version} {plugin.started ? 'running' : 'idle'}</div>)}
    </details>
    <details><summary>Features ({inspection.features.length})</summary>
      {inspection.features.map((feature) => <div key={`${feature.id}@${feature.version}`}>
        {feature.id}@{feature.version} refs={feature.references}{onRetryFeature
          ? <button type="button" onClick={() => void onRetryFeature(feature)}>retry</button>
          : null}
      </div>)}
    </details>
    {onInvalidateQueries ? <button type="button" onClick={() => void onInvalidateQueries()}>Invalidate queries</button> : null}
    <details open><summary>Timeline ({timeline.length})</summary>
      {timeline.slice(-maxEvents).reverse().map((event) => <div key={event.sequence}>
        {event.sequence} {event.subsystem}.{event.operation} [{event.phase}]
      </div>)}
    </details>
  </aside>
}

function ScopeTree({ scope }: { readonly scope: ReturnType<KvtRuntime['inspect']>['rootScope'] }) {
  return <div>
    <div>{scope.id} [{scope.state}] resources={scope.ownedResourceCount}</div>
    {scope.children.length > 0 ? <div style={{ paddingInlineStart: 12 }}>
      {scope.children.map((child) => <ScopeTree key={child.id} scope={child} />)}
    </div> : null}
  </div>
}
