import type { KvtRuntime } from '@kvt/core'
import { KvtProvider, type HydrationState } from '@kvt/react'
import {
  createKvtMemoryRouter,
  createKvtStaticHandler,
  createKvtStaticRouter,
  disposeKvtRouter
} from '@kvt/router-react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { StrictMode, type ReactElement } from 'react'
import { RouterProvider, type RouteObject } from 'react-router'

export interface RenderKvtOptions extends Omit<RenderOptions, 'wrapper'> {
  readonly runtime: KvtRuntime
  readonly hydration?: HydrationState
  readonly strict?: boolean
}

export function renderKvt(element: ReactElement, options: RenderKvtOptions): RenderResult {
  const { runtime, hydration, strict = true, ...renderOptions } = options
  const tree = <KvtProvider runtime={runtime} {...(hydration === undefined ? {} : { hydration })}>{element}</KvtProvider>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree, renderOptions)
}

export function renderKvtRouter(options: {
  readonly runtime: KvtRuntime
  readonly routes: readonly RouteObject[]
  readonly initialEntries?: readonly string[]
}): RenderResult & { readonly disposeRouter: () => Promise<void> } {
  const router = createKvtMemoryRouter({
    runtime: options.runtime,
    routes: options.routes,
    ...(options.initialEntries === undefined ? {} : { initialEntries: [...options.initialEntries] })
  })
  const result = renderKvt(<RouterProvider router={router} />, { runtime: options.runtime })
  return Object.assign(result, { disposeRouter: () => disposeKvtRouter(router) })
}

export async function createKvtStaticTestRouter(options: {
  readonly runtime: KvtRuntime
  readonly routes: readonly RouteObject[]
  readonly url?: string
  readonly requestInit?: RequestInit
}): Promise<
  | { readonly type: 'response'; readonly response: Response; dispose(): Promise<void> }
  | {
    readonly type: 'router'
    readonly router: ReturnType<typeof createKvtStaticRouter>
    readonly context: Exclude<Awaited<ReturnType<ReturnType<typeof createKvtStaticHandler>['query']>>, Response>
    dispose(): Promise<void>
  }
> {
  const handler = createKvtStaticHandler({ runtime: options.runtime, routes: options.routes })
  const context = await handler.query(new Request(options.url ?? 'http://localhost/', options.requestInit))
  if (context instanceof Response) {
    return { type: 'response', response: context, dispose: () => disposeKvtRouter(handler) }
  }
  return {
    type: 'router',
    router: createKvtStaticRouter(handler.dataRoutes, context),
    context,
    dispose: () => disposeKvtRouter(handler)
  }
}
