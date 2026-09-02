import type { KvtRuntime } from '@kvt/core'
import type { DiagnosticEventBuffer } from '@kvt/devtools-protocol'
import { KvtDevtoolsOverlay } from '@kvt/devtools-react'
import { Bug, X } from 'lucide-react'
import { useState } from 'react'

export default function ShowcaseDevtools({
  runtime,
  events
}: {
  readonly runtime: KvtRuntime
  readonly events: DiagnosticEventBuffer
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="devtools-trigger"
        aria-label={open ? 'Закрыть KVT DevTools' : 'Открыть KVT DevTools'}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X aria-hidden="true" size={18} /> : <Bug aria-hidden="true" size={18} />}
        <span>KVT</span>
      </button>
      {open ? <KvtDevtoolsOverlay runtime={runtime} events={events} maxEvents={80} /> : null}
    </>
  )
}
