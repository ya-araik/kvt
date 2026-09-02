import { createTheme, lightTheme } from '@kvt/theme-core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  KvtThemeBootstrapScript,
  KvtThemeProvider,
  applyTheme,
  createLocalStorageThemeAdapter,
  createThemePreHydrationScript,
  resolveServerThemePreference,
  serializeThemePreferenceCookie,
  useKvtTheme,
  type ThemeStorageAdapter
} from '../src/index.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('@kvt/theme-react target ownership', () => {
  it('restores the previous target variables after the final layer', () => {
    const target = document.createElement('div')
    target.style.setProperty('--kvt-colors-primary', '#123456')
    const first = applyTheme(target, lightTheme)
    const custom = createTheme({ colors: { primary: '#654321' } })
    const second = applyTheme(target, custom)
    expect(target.style.getPropertyValue('--kvt-colors-primary')).toBe('#654321')
    first()
    expect(target.style.getPropertyValue('--kvt-colors-primary')).toBe('#654321')
    second()
    expect(target.style.getPropertyValue('--kvt-colors-primary')).toBe('#123456')
  })

  it('uses a scoped style for ShadowRoot and removes it on cleanup', () => {
    const root = document.createElement('div').attachShadow({ mode: 'open' })
    const cleanup = applyTheme(root, lightTheme)
    expect(root.querySelector('style')?.textContent).toContain(':host{--kvt-')
    cleanup()
    expect(root.querySelector('style')).toBeNull()
  })

  it('recaptures target state after the final owner releases it', () => {
    const target = document.createElement('div')
    target.style.setProperty('--kvt-colors-primary', '#111111')
    const first = applyTheme(target, lightTheme)
    first()
    target.style.setProperty('--kvt-colors-primary', '#222222')
    const second = applyTheme(target, lightTheme)
    first()
    second()
    expect(target.style.getPropertyValue('--kvt-colors-primary')).toBe('#222222')
  })

  it('keeps storage failures observational and prevents a late read from overwriting user intent', async () => {
    let resolveRead!: (value: string | null) => void
    const failures = vi.fn()
    const storage: ThemeStorageAdapter = {
      getItem: () => new Promise((resolve) => { resolveRead = resolve }),
      setItem: () => { throw new Error('write unavailable') }
    }
    function Consumer() {
      const theme = useKvtTheme()
      return <button type="button" onClick={() => theme.setPreference({ color: 'dark', motion: 'none' })}>
        {theme.resolvedColor}:{theme.resolvedMotion}
      </button>
    }
    render(<KvtThemeProvider target={document.createElement('div')} storage={storage} onFailure={failures}>
      <Consumer />
    </KvtThemeProvider>)
    fireEvent.click(screen.getByRole('button'))
    resolveRead(JSON.stringify({ version: 1, color: 'light', motion: 'full' }))
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('dark:none'))
    expect(failures).toHaveBeenCalledWith(expect.objectContaining({ operation: 'storage-write' }))
  })

  it('resolves SSR cookie and client-hint preferences and emits a CSP-compatible bootstrap script', () => {
    const preference = { version: 1, color: 'dark', motion: 'none' } as const
    const cookie = serializeThemePreferenceCookie(preference, { secure: false })
    const resolved = resolveServerThemePreference({
      cookieHeader: cookie,
      colorSchemeHeader: '"dark"',
      reducedMotionHeader: 'reduce'
    })
    expect(resolved).toEqual({ preference, initialSystemDark: true, initialSystemReducedMotion: true })
    const script = createThemePreHydrationScript({ initialPreference: preference })
    expect(script).toContain('data-kvt-color-scheme')
    expect(script).toContain('data-kvt-motion')
    expect(script).not.toContain('</script>')
  })

  it('tracks system media changes, persists preferences and resets through removeItem', async () => {
    const listeners: Array<() => void> = []
    const media = new Map<string, { matches: boolean }>([
      ['(prefers-color-scheme: dark)', { matches: false }],
      ['(prefers-reduced-motion: reduce)', { matches: false }]
    ])
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() { return media.get(query)?.matches ?? false },
      addEventListener: (_name: string, listener: () => void) => listeners.push(listener),
      removeEventListener: (_name: string, listener: () => void) => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    }))
    const removeItem = vi.fn()
    const setItem = vi.fn()
    const storage: ThemeStorageAdapter = { getItem: () => null, setItem, removeItem }
    function Consumer() {
      const theme = useKvtTheme()
      return <>
        <span>{theme.resolvedColor}:{theme.resolvedMotion}</span>
        <button onClick={() => theme.setPreference({ color: 'light', motion: 'full' })}>set</button>
        <button onClick={() => theme.reset()}>reset</button>
      </>
    }
    const result = render(<KvtThemeProvider target={document.createElement('div')} storage={storage}>
      <Consumer />
    </KvtThemeProvider>)
    await waitFor(() => expect(screen.getByText('light:full')).toBeTruthy())
    media.get('(prefers-color-scheme: dark)')!.matches = true
    media.get('(prefers-reduced-motion: reduce)')!.matches = true
    listeners[0]?.()
    await waitFor(() => expect(screen.getByText('dark:reduced')).toBeTruthy())
    fireEvent.click(screen.getByText('set'))
    expect(setItem).toHaveBeenCalled()
    fireEvent.click(screen.getByText('reset'))
    expect(removeItem).toHaveBeenCalledWith('kvt-theme')
    result.unmount()
    expect(listeners).toHaveLength(0)
  })

  it('handles cross-tab values, malformed preferences and every fail-soft storage path', async () => {
    let subscriber: ((value: string | null) => void) | undefined
    const failures = vi.fn(() => { throw new Error('observational callback') })
    const storage: ThemeStorageAdapter = {
      getItem: () => Promise.reject(new Error('read')),
      setItem: () => Promise.reject(new Error('write')),
      removeItem: () => Promise.reject(new Error('remove')),
      subscribe: (_key, listener) => { subscriber = listener; return () => { subscriber = undefined } }
    }
    function Consumer() {
      const theme = useKvtTheme()
      return <>
        <span>{theme.preference.color}:{theme.preference.motion}</span>
        <button onClick={() => theme.setPreference({ color: 'dark', motion: 'none' })}>set</button>
        <button onClick={() => theme.reset()}>reset</button>
      </>
    }
    render(<KvtThemeProvider target={document.createElement('div')} storage={storage} onFailure={failures}>
      <Consumer />
    </KvtThemeProvider>)
    await waitFor(() => expect(failures).toHaveBeenCalledWith(expect.objectContaining({ operation: 'storage-read' })))
    subscriber?.('{bad json')
    expect(failures).toHaveBeenCalledWith(expect.objectContaining({ operation: 'preference-parse' }))
    subscriber?.(JSON.stringify({ version: 1, color: 'dark', motion: 'none' }))
    await waitFor(() => expect(screen.getByText('dark:none')).toBeTruthy())
    subscriber?.(null)
    await waitFor(() => expect(screen.getByText('system:system')).toBeTruthy())
    fireEvent.click(screen.getByText('set'))
    fireEvent.click(screen.getByText('reset'))
    await waitFor(() => {
      expect(failures).toHaveBeenCalledWith(expect.objectContaining({ operation: 'storage-write' }))
      expect(failures).toHaveBeenCalledWith(expect.objectContaining({ operation: 'storage-remove' }))
    })
  })

  it('keeps synchronous storage and subscribe failures observational and falls back to setItem reset', async () => {
    const failures = vi.fn()
    const storage: ThemeStorageAdapter = {
      getItem: () => { throw new Error('sync read') },
      setItem: () => { throw new Error('sync write') },
      subscribe: () => { throw new Error('sync subscribe') }
    }
    function Consumer() {
      const theme = useKvtTheme()
      return <button onClick={() => theme.reset()}>reset</button>
    }
    render(<KvtThemeProvider target={document.createElement('div')} storage={storage} onFailure={failures}>
      <Consumer />
    </KvtThemeProvider>)
    fireEvent.click(screen.getByText('reset'))
    await waitFor(() => expect(failures).toHaveBeenCalledTimes(3))
    expect(failures.mock.calls.map(([failure]) => failure.operation)).toEqual(expect.arrayContaining([
      'storage-read', 'storage-subscribe', 'storage-write'
    ]))
  })

  it('provides a localStorage adapter with filtered storage events', () => {
    const adapter = createLocalStorageThemeAdapter(localStorage)
    adapter.setItem('theme', 'one')
    expect(adapter.getItem('theme')).toBe('one')
    const listener = vi.fn()
    const stop = adapter.subscribe?.('theme', listener)
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'skip', storageArea: localStorage }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'two', storageArea: localStorage }))
    expect(listener).toHaveBeenCalledWith('two')
    stop?.()
    adapter.removeItem?.('theme')
    expect(adapter.getItem('theme')).toBeNull()
  })

  it('renders a nonce bootstrap script and validates server/cookie edge cases', () => {
    render(<KvtThemeBootstrapScript nonce="nonce-value" storageKey="custom" attribute="data-color" motionAttribute="data-motion" />)
    const script = document.querySelector('script[nonce="nonce-value"]')
    expect(script?.textContent).toContain('custom')
    expect(script?.textContent).toContain('data-color')

    expect(resolveServerThemePreference({ cookieHeader: 'other=1; malformed; kvt-theme=%7Bbad' }).preference.color)
      .toBe('system')
    expect(resolveServerThemePreference({ colorSchemeHeader: 'light', reducedMotionHeader: 'no-preference' }))
      .toMatchObject({ initialSystemDark: false, initialSystemReducedMotion: false })
    expect(serializeThemePreferenceCookie({ version: 1, color: 'light', motion: 'full' }, {
      name: 'theme', maxAgeSeconds: 0
    })).toContain('; Max-Age=0; Secure')
    expect(() => serializeThemePreferenceCookie({ version: 1, color: 'light', motion: 'full' }, { name: 'bad name' }))
      .toThrow('Invalid theme cookie name')
    expect(() => serializeThemePreferenceCookie({ version: 1, color: 'light', motion: 'full' }, { maxAgeSeconds: -1 }))
      .toThrow(RangeError)
  })

  it('requires the provider for the theme hook', () => {
    function Invalid() { useKvtTheme(); return null }
    expect(() => render(<Invalid />)).toThrow('requires KvtThemeProvider')
  })
})
