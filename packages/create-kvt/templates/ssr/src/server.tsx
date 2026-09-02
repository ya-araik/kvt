import { bootstrapKvt } from '@kvt/core'
import { createHydrationState, KvtProvider, serializeHydrationState } from '@kvt/react'
import { createKvtStaticHandler, createKvtStaticRouter, disposeKvtRouter } from '@kvt/router-react'
import { createThemePreHydrationScript, KvtThemeProvider } from '@kvt/theme-react'
import { renderToString } from 'react-dom/server'
import { StaticRouterProvider } from 'react-router'
import { routes } from './app/navigation/routes.js'
import { todoModule } from './app/di/todo-module.js'

export interface RenderTodoRequestOptions {
  readonly url: string
  readonly signal?: AbortSignal
  readonly cspNonce?: string
}

export async function renderTodoRequest({
  url,
  signal,
  cspNonce
}: RenderTodoRequestOptions): Promise<Response> {
  const runtime = await bootstrapKvt({ modules: [todoModule] })
  const handler = createKvtStaticHandler({ runtime, routes })
  try {
    const request = new Request(url, signal === undefined ? {} : { signal })
    const context = await handler.query(request)
    if (context instanceof Response) return context
    const router = createKvtStaticRouter(handler.dataRoutes, context)
    const hydration = createHydrationState([])
    const application = renderToString(
      <KvtProvider runtime={runtime} hydration={hydration} shutdownOnPageHide={false}>
        <KvtThemeProvider>
          <StaticRouterProvider router={router} context={context} />
        </KvtThemeProvider>
      </KvtProvider>
    )
    const nonce = cspNonce === undefined ? '' : ` nonce="${escapeAttribute(cspNonce)}"`
    const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script${nonce}>${createThemePreHydrationScript()}</script></head><body><div id="root">${application}</div><script id="kvt-hydration" type="application/json">${serializeHydrationState(hydration)}</script><script${nonce} type="module" src="/src/main.tsx"></script></body></html>`
    return new Response(document, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  } finally {
    await disposeKvtRouter(handler)
    await runtime.shutdown({ reason: signal?.aborted ? 'request-aborted' : 'request-complete' })
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
