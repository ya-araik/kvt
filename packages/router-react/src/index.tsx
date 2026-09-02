import { raceWithAbort, type FeatureDefinition, type FeatureHandle, type KvtRuntime, type KvtScope } from '@kvt/core'
import { KvtViewModelOwner } from '@kvt/react'
import { createContext, createElement, useContext, type ComponentType, type ReactNode } from 'react'
import {
  Outlet,
  createBrowserRouter,
  createMemoryRouter,
  createStaticHandler,
  createStaticRouter,
  type ActionFunction,
  type LoaderFunction,
  type RouteObject,
  useParams
} from 'react-router'

export interface KvtRouteMetadata {
  readonly featureModule?: FeatureDefinition
  readonly diagnostics?: boolean
  readonly unload?: 'on-route-exit' | 'keep-alive'
}

export const KVT_ROUTE_METADATA = Symbol.for('@kvt/router-react/metadata')

interface KvtRouteHandle {
  readonly [KVT_ROUTE_METADATA]?: KvtRouteMetadata
}

export function withKvtRoute<TRoute extends RouteObject>(route: TRoute, metadata: KvtRouteMetadata): TRoute {
  const existingHandle = typeof route.handle === 'object' && route.handle !== null ? route.handle : {}
  return {
    ...route,
    handle: { ...existingHandle, [KVT_ROUTE_METADATA]: Object.freeze({ ...metadata }) }
  }
}

interface ManagedFeature {
  readonly definition: FeatureDefinition
  handle: FeatureHandle | undefined
  loading: Promise<FeatureHandle> | undefined
  activeMatches: number
  pendingNavigations: number
  everActivated: boolean
  keepAlive: boolean
  cleanupTimer: ReturnType<typeof setTimeout> | undefined
  loadController: AbortController | undefined
}

class RouteFeatureManager {
  readonly #runtime: KvtRuntime
  readonly #features = new Map<string, ManagedFeature>()

  constructor(runtime: KvtRuntime) {
    this.#runtime = runtime
  }

  async prepare(definition: FeatureDefinition, signal: AbortSignal): Promise<KvtScope> {
    const feature = this.#entry(definition)
    feature.pendingNavigations++
    try {
      if (!feature.handle) {
        if (!feature.loading) {
          feature.loadController = new AbortController()
          feature.loading = this.#runtime.loadFeature(definition, feature.loadController.signal).then((handle) => {
            feature.handle = handle
            return handle
          }).finally(() => {
            feature.loading = undefined
            feature.loadController = undefined
          })
          void feature.loading.catch(() => undefined)
        }
        await raceWithAbort(feature.loading, signal)
      }
      if (!feature.handle) throw new Error(`Feature ${definition.id}@${definition.version} finished loading without a handle`)
      return feature.handle.scope
    } finally {
      feature.pendingNavigations--
      if (feature.pendingNavigations === 0 && feature.activeMatches === 0 && feature.everActivated) this.#scheduleCleanup(feature)
    }
  }

  prepareLazy(definition: FeatureDefinition): Promise<KvtScope> {
    return this.prepare(definition, new AbortController().signal)
  }

  emitDiagnostic(
    operation: 'loader' | 'action',
    phase: 'start' | 'success' | 'failure',
    feature: FeatureDefinition,
    error?: unknown
  ): void {
    this.#runtime.emitDiagnostic('router', operation, phase, {
      moduleId: feature.id,
      version: feature.version,
      ...(error === undefined ? {} : { error })
    })
  }

  reconcile(matches: readonly { readonly route: { readonly handle?: unknown } }[]): void {
    const active = new Map<string, number>()
    for (const match of matches) {
      const definition = metadataFromHandle(match.route.handle)?.featureModule
      if (!definition) continue
      const key = featureKey(definition)
      active.set(key, (active.get(key) ?? 0) + 1)
      const feature = this.#entry(definition)
      if (metadataFromHandle(match.route.handle)?.unload === 'keep-alive') feature.keepAlive = true
    }
    for (const [key, feature] of this.#features) {
      feature.activeMatches = active.get(key) ?? 0
      if (feature.activeMatches > 0) {
        feature.everActivated = true
        if (feature.cleanupTimer) clearTimeout(feature.cleanupTimer)
        feature.cleanupTimer = undefined
        continue
      }
      feature.loadController?.abort(new DOMException('Route navigation was cancelled', 'AbortError'))
      this.#scheduleCleanup(feature)
    }
  }

  scope(definition: FeatureDefinition): KvtScope {
    const scope = this.#features.get(featureKey(definition))?.handle?.scope
    if (!scope) throw new Error(`Feature scope ${featureKey(definition)} is not ready before route render`)
    return scope
  }

  async dispose(): Promise<void> {
    for (const feature of this.#features.values()) feature.loadController?.abort(new DOMException('Router disposed', 'AbortError'))
    await Promise.allSettled([...this.#features.values()].flatMap((feature) => feature.loading ? [feature.loading] : []))
    await Promise.all([...this.#features.values()].map(async (feature) => {
      if (feature.cleanupTimer) clearTimeout(feature.cleanupTimer)
      await feature.handle?.release()
    }))
    this.#features.clear()
  }

  #entry(definition: FeatureDefinition): ManagedFeature {
    const key = `${definition.id}@${definition.version}`
    const existing = this.#features.get(key)
    if (existing) {
      if (existing.definition.load !== definition.load) throw new Error(`Conflicting loader for feature ${key}`)
      return existing
    }
    const feature: ManagedFeature = {
      definition,
      handle: undefined,
      loading: undefined,
      activeMatches: 0,
      pendingNavigations: 0,
      everActivated: false,
      keepAlive: false,
      cleanupTimer: undefined,
      loadController: undefined
    }
    this.#features.set(key, feature)
    return feature
  }

  #scheduleCleanup(feature: ManagedFeature): void {
    if (feature.keepAlive || feature.activeMatches > 0 || feature.pendingNavigations > 0 || !feature.handle) return
    if (feature.cleanupTimer) clearTimeout(feature.cleanupTimer)
    feature.cleanupTimer = setTimeout(() => {
      if (feature.activeMatches > 0 || feature.pendingNavigations > 0) return
      const handle = feature.handle
      feature.handle = undefined
      void handle?.release()
    }, 0)
  }
}

interface ManagedRouter {
  readonly manager: RouteFeatureManager
  readonly unsubscribe?: () => void
}

const routerManagers = new WeakMap<object, ManagedRouter>()

export interface KvtBrowserRouterOptions extends NonNullable<Parameters<typeof createBrowserRouter>[1]> {
  readonly runtime: KvtRuntime
  readonly routes: readonly RouteObject[]
}

export function createKvtBrowserRouter(options: KvtBrowserRouterOptions): ReturnType<typeof createBrowserRouter> {
  const { runtime, routes, ...routerOptions } = options
  const manager = new RouteFeatureManager(runtime)
  const router = createBrowserRouter(prepareRoutes(routes, manager), routerOptions)
  registerRouter(router, manager)
  return router
}

export interface KvtMemoryRouterOptions extends NonNullable<Parameters<typeof createMemoryRouter>[1]> {
  readonly runtime: KvtRuntime
  readonly routes: readonly RouteObject[]
}

export function createKvtMemoryRouter(options: KvtMemoryRouterOptions): ReturnType<typeof createMemoryRouter> {
  const { runtime, routes, ...routerOptions } = options
  const manager = new RouteFeatureManager(runtime)
  const router = createMemoryRouter(prepareRoutes(routes, manager), routerOptions)
  registerRouter(router, manager)
  return router
}

export interface KvtStaticHandlerOptions extends NonNullable<Parameters<typeof createStaticHandler>[1]> {
  readonly runtime: KvtRuntime
  readonly routes: readonly RouteObject[]
}

export function createKvtStaticHandler(options: KvtStaticHandlerOptions): ReturnType<typeof createStaticHandler> {
  const { runtime, routes, ...handlerOptions } = options
  const manager = new RouteFeatureManager(runtime)
  const handler = createStaticHandler(prepareRoutes(routes, manager), handlerOptions)
  routerManagers.set(handler, { manager })
  return handler
}

export function createKvtStaticRouter(
  dataRoutes: Parameters<typeof createStaticRouter>[0],
  context: Parameters<typeof createStaticRouter>[1]
): ReturnType<typeof createStaticRouter> {
  return createStaticRouter(dataRoutes, context)
}

export async function disposeKvtRouter(router: object): Promise<void> {
  const managed = routerManagers.get(router)
  routerManagers.delete(router)
  managed?.unsubscribe?.()
  await managed?.manager.dispose()
}

function registerRouter(
  router: ReturnType<typeof createBrowserRouter> | ReturnType<typeof createMemoryRouter>,
  manager: RouteFeatureManager
): void {
  const reconcile = (state: typeof router.state) => {
    if (state.navigation.state === 'idle') manager.reconcile(state.matches)
  }
  const unsubscribe = router.subscribe(reconcile)
  routerManagers.set(router, { manager, unsubscribe })
  reconcile(router.state)
}

function prepareRoutes(routes: readonly RouteObject[], manager: RouteFeatureManager, parentId = 'root'): RouteObject[] {
  return routes.map((route, index) => {
    const ownId = route.id ?? `${parentId}/${route.path ?? (route.index ? 'index' : `layout-${index}`)}`
    return prepareRoute(route, manager, ownId)
  })
}

function prepareRoute(route: RouteObject, manager: RouteFeatureManager, routeId: string): RouteObject {
  const metadata = metadataFromHandle(route.handle)
  const feature = metadata?.featureModule
  const owner: RouteOwnerDefinition = { id: routeId, parameterNames: routeParameterNames(route.path) }
  const prepared = {
    ...route,
    ...(route.children ? { children: prepareRoutes(route.children, manager, routeId) } : {})
  } as RouteObject
  if (feature) {
    if (typeof route.loader === 'function') prepared.loader = wrapDataFunction(route.loader, feature, manager, 'loader', metadata?.diagnostics === true) as LoaderFunction
    else if (route.loader !== true && !route.lazy) prepared.loader = wrapDataFunction(() => null, feature, manager, 'loader', metadata?.diagnostics === true) as LoaderFunction
    if (typeof route.action === 'function') prepared.action = wrapDataFunction(route.action, feature, manager, 'action', metadata?.diagnostics === true) as ActionFunction
  }
  if (route.Component) prepared.Component = wrapComponent(route.Component, owner, feature, manager)
  if (route.element) prepared.element = createElement(RouteOwnerBoundary, { owner, feature, manager, children: route.element })
  if (typeof route.lazy === 'function') prepared.lazy = wrapLazyRoute(route.lazy, route, owner, feature, metadata, manager)
  if (!route.Component && !route.element && !route.lazy && route.children) {
    prepared.Component = wrapComponent(Outlet, owner, feature, manager)
  }
  return prepared
}

function wrapLazyRoute(
  lazy: Exclude<RouteObject['lazy'], undefined> & (() => Promise<Record<string, unknown>>),
  route: RouteObject,
  owner: RouteOwnerDefinition,
  feature: FeatureDefinition | undefined,
  metadata: KvtRouteMetadata | undefined,
  manager: RouteFeatureManager
): NonNullable<RouteObject['lazy']> {
  return async () => {
    if (feature) await manager.prepareLazy(feature)
    const loaded = await lazy()
    const result = { ...loaded }
    if (feature && typeof loaded.loader === 'function') result.loader = wrapDataFunction(loaded.loader as LoaderFunction, feature, manager, 'loader', metadata?.diagnostics === true)
    else if (feature && route.loader === undefined) result.loader = wrapDataFunction(() => null, feature, manager, 'loader', metadata?.diagnostics === true)
    if (feature && typeof loaded.action === 'function') result.action = wrapDataFunction(loaded.action as ActionFunction, feature, manager, 'action', metadata?.diagnostics === true)
    if (typeof loaded.Component === 'function') {
      result.Component = wrapComponent(loaded.Component as ComponentType, owner, feature, manager)
    }
    if (loaded.element) {
      result.element = createElement(RouteOwnerBoundary, {
        owner, feature, manager, children: loaded.element as ReactNode
      })
    }
    return result as never
  }
}

function wrapDataFunction(
  dataFunction: LoaderFunction | ActionFunction,
  feature: FeatureDefinition,
  manager: RouteFeatureManager,
  operation: 'loader' | 'action',
  diagnostics: boolean
): LoaderFunction | ActionFunction {
  return async (arguments_) => {
    await manager.prepare(feature, arguments_.request.signal)
    if (diagnostics) manager.emitDiagnostic(operation, 'start', feature)
    try {
      const result = await dataFunction(arguments_ as never)
      if (diagnostics) manager.emitDiagnostic(operation, 'success', feature)
      return result
    } catch (error) {
      if (diagnostics) manager.emitDiagnostic(operation, 'failure', feature, error)
      throw error
    }
  }
}

function wrapComponent(
  component: ComponentType,
  owner: RouteOwnerDefinition,
  feature: FeatureDefinition | undefined,
  manager: RouteFeatureManager
): ComponentType {
  return function KvtRouteComponent() {
    return createElement(RouteOwnerBoundary, { owner, feature, manager, children: createElement(component) })
  }
}

const KvtRouteScopeContext = createContext<KvtScope | undefined>(undefined)

export function useKvtRouteScope(): KvtScope {
  const scope = useContext(KvtRouteScopeContext)
  if (!scope) throw new Error('useKvtRouteScope requires a route with KVT feature metadata')
  return scope
}

interface RouteOwnerDefinition {
  readonly id: string
  readonly parameterNames: readonly string[]
}

function RouteOwnerBoundary({ owner, feature, manager, children }: {
  readonly owner: RouteOwnerDefinition
  readonly feature: FeatureDefinition | undefined
  readonly manager: RouteFeatureManager
  readonly children: ReactNode
}) {
  const parameters = useParams()
  const parameterKey = owner.parameterNames.map((name) => `${name}=${parameters[name] ?? ''}`).join('&')
  const ownerId = `route:${owner.id}${parameterKey.length > 0 ? `?${parameterKey}` : ''}`
  const scope = feature ? manager.scope(feature) : undefined
  const content = feature
    ? createElement(KvtRouteScopeContext.Provider, { value: scope, children })
    : children
  return createElement(KvtViewModelOwner, {
    key: ownerId,
    id: ownerId,
    ...(scope ? { scope } : {}),
    children: content
  })
}

function metadataFromHandle(handle: unknown): KvtRouteMetadata | undefined {
  return (handle as KvtRouteHandle | undefined)?.[KVT_ROUTE_METADATA]
}

function featureKey(definition: FeatureDefinition): string {
  return `${definition.id}@${definition.version}`
}

function routeParameterNames(path: string | undefined): readonly string[] {
  if (!path) return Object.freeze([])
  return Object.freeze([...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!).sort())
}
