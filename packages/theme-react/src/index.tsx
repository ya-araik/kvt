import {
  darkTheme,
  lightTheme,
  themeToCssText,
  themeToCssVariables,
  withMotionPreference,
  type KvtTheme,
  type MotionPreference
} from '@kvt/theme-core'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode
} from 'react'

export type ThemeColorPreference = 'light' | 'dark' | 'system'
export type ThemeMotionPreference = MotionPreference | 'system'

export interface ThemePreference {
  readonly version: 1
  readonly color: ThemeColorPreference
  readonly motion: ThemeMotionPreference
}

export interface ThemeStorageAdapter {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem?(key: string): void | Promise<void>
  subscribe?(key: string, listener: (value: string | null) => void): () => void
}

export interface ThemeFailure {
  readonly operation: 'storage-read' | 'storage-write' | 'storage-remove' | 'storage-subscribe' | 'preference-parse'
  readonly error: unknown
}

export interface ThemeSnapshot {
  readonly preference: ThemePreference
  readonly resolvedColor: 'light' | 'dark'
  readonly resolvedMotion: MotionPreference
  readonly theme: KvtTheme
}

export interface ThemeContextValue extends ThemeSnapshot {
  setPreference(preference: Omit<ThemePreference, 'version'>): void
  reset(): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const defaultPreference: ThemePreference = Object.freeze({ version: 1, color: 'system', motion: 'system' })

class ThemeController {
  readonly #listeners = new Set<() => void>()
  readonly #light: KvtTheme
  readonly #dark: KvtTheme
  readonly #storage: ThemeStorageAdapter | undefined
  readonly #storageKey: string
  readonly #default: ThemePreference
  readonly #onFailure: ((failure: ThemeFailure) => void) | undefined
  #preference: ThemePreference
  #systemDark: boolean
  #systemReduced: boolean
  #snapshot: ThemeSnapshot
  #stop: (() => void)[] = []
  #revision = 0
  #run = 0

  constructor(options: {
    readonly light: KvtTheme
    readonly dark: KvtTheme
    readonly storage: ThemeStorageAdapter | undefined
    readonly storageKey: string
    readonly defaultPreference: ThemePreference
    readonly initialSystemDark: boolean
    readonly initialSystemReduced: boolean
    readonly onFailure: ((failure: ThemeFailure) => void) | undefined
  }) {
    this.#light = options.light
    this.#dark = options.dark
    this.#storage = options.storage
    this.#storageKey = options.storageKey
    this.#default = options.defaultPreference
    this.#preference = options.defaultPreference
    this.#systemDark = options.initialSystemDark
    this.#systemReduced = options.initialSystemReduced
    this.#onFailure = options.onFailure
    this.#snapshot = this.#resolve()
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  readonly getSnapshot = () => this.#snapshot

  start(): () => void {
    const run = ++this.#run
    if (typeof matchMedia !== 'undefined') {
      const dark = matchMedia('(prefers-color-scheme: dark)')
      const reduced = matchMedia('(prefers-reduced-motion: reduce)')
      const update = () => {
        this.#systemDark = dark.matches
        this.#systemReduced = reduced.matches
        this.#publish()
      }
      dark.addEventListener('change', update)
      reduced.addEventListener('change', update)
      this.#stop.push(() => dark.removeEventListener('change', update), () => reduced.removeEventListener('change', update))
      update()
    }
    if (this.#storage) {
      const revision = this.#revision
      try {
        void Promise.resolve(this.#storage.getItem(this.#storageKey)).then((value) => {
          if (run !== this.#run || revision !== this.#revision) return
          if (value === null) this.#setPreference(this.#default, false)
          else this.#setFromSerialized(value)
        }, (error: unknown) => this.#fail('storage-read', error))
      } catch (error) {
        this.#fail('storage-read', error)
      }
      if (this.#storage.subscribe) {
        try {
          this.#stop.push(this.#storage.subscribe(this.#storageKey, (value) => {
            if (run !== this.#run) return
            if (value === null) this.#setPreference(this.#default, true)
            else this.#setFromSerialized(value)
          }))
        } catch (error) {
          this.#fail('storage-subscribe', error)
        }
      }
    }
    return () => {
      if (this.#run === run) this.#run++
      for (const stop of this.#stop.splice(0)) stop()
    }
  }

  setPreference(preference: Omit<ThemePreference, 'version'>): void {
    this.#setPreference(normalizePreference({ version: 1, ...preference }, this.#default), true)
    if (this.#storage) {
      try {
        void Promise.resolve(this.#storage.setItem(this.#storageKey, JSON.stringify(this.#preference)))
          .catch((error: unknown) => this.#fail('storage-write', error))
      } catch (error) {
        this.#fail('storage-write', error)
      }
    }
  }

  reset(): void {
    this.#setPreference(this.#default, true)
    if (this.#storage?.removeItem) {
      try {
        void Promise.resolve(this.#storage.removeItem(this.#storageKey))
          .catch((error: unknown) => this.#fail('storage-remove', error))
      } catch (error) {
        this.#fail('storage-remove', error)
      }
    } else if (this.#storage) {
      try {
        void Promise.resolve(this.#storage.setItem(this.#storageKey, JSON.stringify(this.#default)))
          .catch((error: unknown) => this.#fail('storage-write', error))
      } catch (error) {
        this.#fail('storage-write', error)
      }
    }
  }

  #setFromSerialized(value: string): void {
    try {
      this.#setPreference(normalizePreference(JSON.parse(value), this.#default), true)
    } catch (error) {
      this.#fail('preference-parse', error)
    }
  }

  #setPreference(preference: ThemePreference, incrementRevision: boolean): void {
    if (incrementRevision) this.#revision++
    this.#preference = preference
    this.#publish()
  }

  #resolve(): ThemeSnapshot {
    const resolvedColor = this.#preference.color === 'system'
      ? (this.#systemDark ? 'dark' : 'light')
      : this.#preference.color
    const resolvedMotion = this.#preference.motion === 'system'
      ? (this.#systemReduced ? 'reduced' : 'full')
      : this.#preference.motion
    return Object.freeze({
      preference: this.#preference,
      resolvedColor,
      resolvedMotion,
      theme: withMotionPreference(resolvedColor === 'dark' ? this.#dark : this.#light, resolvedMotion)
    })
  }

  #publish(): void {
    this.#snapshot = this.#resolve()
    for (const listener of [...this.#listeners]) listener()
  }

  #fail(operation: ThemeFailure['operation'], error: unknown): void {
    try { this.#onFailure?.({ operation, error }) } catch { /* observational */ }
  }
}

export type ThemeTarget = HTMLElement | ShadowRoot
interface TargetLayer { readonly id: symbol; readonly theme: KvtTheme }
interface TargetState {
  readonly base: Readonly<Record<string, string>>
  readonly layers: TargetLayer[]
  style: HTMLStyleElement | undefined
}
const targetLayers = new WeakMap<ThemeTarget, TargetState>()

export function applyTheme(target: ThemeTarget, theme: KvtTheme): () => void {
  const id = Symbol('theme-layer')
  let disposed = false
  let state = targetLayers.get(target)
  if (!state) {
    const base: Record<string, string> = {}
    if (target instanceof HTMLElement) {
      for (const key of Object.keys(themeToCssVariables(theme))) base[key] = target.style.getPropertyValue(key)
    }
    state = { base: Object.freeze(base), layers: [], style: undefined }
    targetLayers.set(target, state)
  }
  state.layers.push({ id, theme })
  renderTarget(target, state)
  return () => {
    if (disposed) return
    disposed = true
    const index = state?.layers.findIndex((layer) => layer.id === id) ?? -1
    if (index >= 0) state?.layers.splice(index, 1)
    if (state) {
      renderTarget(target, state)
      if (state.layers.length === 0) targetLayers.delete(target)
    }
  }
}

function renderTarget(target: ThemeTarget, state: TargetState): void {
  const top = state.layers.at(-1)
  if (target instanceof ShadowRoot) {
    state.style?.remove()
    state.style = undefined
    if (top) {
      const style = target.ownerDocument.createElement('style')
      style.dataset.kvtTheme = ''
      style.textContent = themeToCssText(top.theme)
      target.append(style)
      state.style = style
    }
    return
  }
  const keys = new Set([...Object.keys(state.base), ...(top ? Object.keys(themeToCssVariables(top.theme)) : [])])
  for (const key of keys) {
    const value = top ? themeToCssVariables(top.theme)[key as `--kvt-${string}`] : state.base[key]
    if (value) target.style.setProperty(key, value)
    else target.style.removeProperty(key)
  }
}

export interface KvtThemeProviderProps {
  /** Omit during SSR; the client supplies the scoped DOM target during hydration. */
  readonly target?: ThemeTarget
  readonly light?: KvtTheme
  readonly dark?: KvtTheme
  readonly storage?: ThemeStorageAdapter
  readonly storageKey?: string
  readonly defaultPreference?: ThemePreference
  readonly initialSystemDark?: boolean
  readonly initialSystemReducedMotion?: boolean
  readonly onFailure?: (failure: ThemeFailure) => void
  readonly children: ReactNode
}

export function KvtThemeProvider({
  target,
  light = lightTheme,
  dark = darkTheme,
  storage,
  storageKey = 'kvt-theme',
  defaultPreference: preferred = defaultPreference,
  initialSystemDark = false,
  initialSystemReducedMotion = false,
  onFailure,
  children
}: KvtThemeProviderProps) {
  const controller = useMemo(() => new ThemeController({
    light, dark, storage, storageKey, defaultPreference: normalizePreference(preferred, defaultPreference),
    initialSystemDark, initialSystemReduced: initialSystemReducedMotion, onFailure
  }), [dark, initialSystemDark, initialSystemReducedMotion, light, onFailure, preferred, storage, storageKey])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => controller.start(), [controller])
  useLayoutEffect(() => target ? applyTheme(target, snapshot.theme) : undefined, [snapshot.theme, target])
  const value = useMemo<ThemeContextValue>(() => ({
    ...snapshot,
    setPreference: (preference) => controller.setPreference(preference),
    reset: () => controller.reset()
  }), [controller, snapshot])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useKvtTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useKvtTheme requires KvtThemeProvider')
  return context
}

export function createLocalStorageThemeAdapter(storage: Storage): ThemeStorageAdapter {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
    subscribe: (key, listener) => {
      if (typeof window === 'undefined') return () => undefined
      const handler = (event: StorageEvent) => {
        if (event.storageArea === storage && event.key === key) listener(event.newValue)
      }
      window.addEventListener('storage', handler)
      return () => window.removeEventListener('storage', handler)
    }
  }
}

export function createThemePreHydrationScript(options: {
  readonly storageKey?: string
  readonly attribute?: string
  readonly motionAttribute?: string
  readonly initialPreference?: ThemePreference
} = {}): string {
  const key = JSON.stringify(options.storageKey ?? 'kvt-theme')
  const attribute = JSON.stringify(options.attribute ?? 'data-kvt-color-scheme')
  const motionAttribute = JSON.stringify(options.motionAttribute ?? 'data-kvt-motion')
  const initial = JSON.stringify(normalizePreference(options.initialPreference ?? defaultPreference, defaultPreference))
  return `(()=>{try{const f=${initial};const p=JSON.parse(localStorage.getItem(${key})||'null')||f;const c=p&&p.version===1&&p.color;const m=p&&p.version===1&&p.motion;const rc=c==='dark'||c==='light'?c:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';const rm=m==='full'||m==='reduced'||m==='none'?m:matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'full';document.documentElement.setAttribute(${attribute},rc);document.documentElement.setAttribute(${motionAttribute},rm)}catch{}})()`
}

export interface KvtThemeBootstrapScriptProps {
  readonly nonce?: string
  readonly storageKey?: string
  readonly attribute?: string
  readonly motionAttribute?: string
  readonly initialPreference?: ThemePreference
}

export function KvtThemeBootstrapScript({ nonce, storageKey, attribute, motionAttribute, initialPreference }: KvtThemeBootstrapScriptProps) {
  const script = createThemePreHydrationScript({
    ...(storageKey === undefined ? {} : { storageKey }),
    ...(attribute === undefined ? {} : { attribute }),
    ...(motionAttribute === undefined ? {} : { motionAttribute }),
    ...(initialPreference === undefined ? {} : { initialPreference })
  })
  return <script {...(nonce === undefined ? {} : { nonce })} dangerouslySetInnerHTML={{ __html: script }} />
}

export interface ThemeServerPreferenceInput {
  readonly cookieHeader?: string | null
  readonly colorSchemeHeader?: string | null
  readonly reducedMotionHeader?: string | null
  readonly cookieName?: string
  readonly defaultPreference?: ThemePreference
}

export interface ResolvedServerThemePreference {
  readonly preference: ThemePreference
  readonly initialSystemDark: boolean
  readonly initialSystemReducedMotion: boolean
}

export function resolveServerThemePreference(input: ThemeServerPreferenceInput = {}): ResolvedServerThemePreference {
  const fallback = normalizePreference(input.defaultPreference ?? defaultPreference, defaultPreference)
  let preference = fallback
  const cookie = readCookie(input.cookieHeader ?? null, input.cookieName ?? 'kvt-theme')
  if (cookie !== undefined) {
    try { preference = normalizePreference(JSON.parse(decodeURIComponent(cookie)), fallback) } catch { preference = fallback }
  }
  return Object.freeze({
    preference,
    initialSystemDark: input.colorSchemeHeader?.replaceAll('"', '').trim().toLowerCase() === 'dark',
    initialSystemReducedMotion: input.reducedMotionHeader?.replaceAll('"', '').trim().toLowerCase() === 'reduce'
  })
}

export function serializeThemePreferenceCookie(
  preference: ThemePreference,
  options: { readonly name?: string; readonly maxAgeSeconds?: number; readonly secure?: boolean } = {}
): string {
  const normalized = normalizePreference(preference, defaultPreference)
  const name = options.name ?? 'kvt-theme'
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new TypeError('Invalid theme cookie name')
  const maxAge = options.maxAgeSeconds
  if (maxAge !== undefined && (!Number.isSafeInteger(maxAge) || maxAge < 0)) throw new RangeError('maxAgeSeconds must be non-negative')
  return `${name}=${encodeURIComponent(JSON.stringify(normalized))}; Path=/; SameSite=Lax${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}${options.secure === false ? '' : '; Secure'}`
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const item of header.split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue
    return item.slice(separator + 1).trim()
  }
  return undefined
}

function normalizePreference(value: unknown, fallback: ThemePreference): ThemePreference {
  if (typeof value !== 'object' || value === null) return fallback
  const candidate = value as Partial<ThemePreference>
  const color = candidate.color
  const motion = candidate.motion
  if (candidate.version !== 1 || !['light', 'dark', 'system'].includes(color ?? '')
    || !['full', 'reduced', 'none', 'system'].includes(motion ?? '')) return fallback
  return Object.freeze({ version: 1, color: color as ThemeColorPreference, motion: motion as ThemeMotionPreference })
}
