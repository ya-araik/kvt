# Theme

Theme core contains immutable semantic colors, typography, shapes, spacing,
motion and elevation. It validates values, serializes version 1 schemes,
supports a custom registry and generates one `--kvt-*` CSS schema.

The React provider requires an HTMLElement or ShadowRoot target. It stacks and
restores target values on unmount, handles storage errors without breaking UI,
synchronizes system color/reduced-motion preferences and supports cross-tab
adapters. `none` motion sets decorative durations to zero.

The Tailwind package only generates opt-in `kvt-*` mappings. No theme package
styles `html`, `body` or global classes merely by being imported.

## Define a theme

```ts
const brandTheme = createTheme({
  colors: {
    primary: '#3659e3',
    onPrimary: '#ffffff',
    primaryContainer: '#dce2ff',
    onPrimaryContainer: '#08164f'
  },
  shapes: { medium: '0.75rem' },
  spacing: { medium: '1rem' }
})

validateTheme(brandTheme)
const failures = validateThemeContrast(brandTheme)
```

Overrides are type-safe deep partials. Returned themes and standard presets are
deep-frozen. Validation rejects missing/unknown keys, invalid CSS values and
unsupported serialized versions.

## Semantic color pairs

Use foreground/background pairs together: `primary/onPrimary`,
`primaryContainer/onPrimaryContainer`, `surface/onSurface`,
`surfaceVariant/onSurfaceVariant`, `error/onError`, and inverse pairs. Do not
infer arbitrary text colors from a decorative brand value. The standard light
and dark schemes pass the documented WCAG 2.2 AA text pairs.

## Scoped application

```tsx
<KvtThemeProvider target={applicationElement} light={brandTheme} dark={brandDarkTheme}>
  <App />
</KvtThemeProvider>
```

`applyTheme()` writes only namespaced variables to the explicit HTMLElement or
a scoped style in a ShadowRoot. Multiple layers restore the preceding layer;
the final cleanup restores the state that existed before KVT took ownership.

## Preferences and persistence

Color preference is light/dark/system. Motion is full/reduced/none/system. User
choice has priority over system preference. Storage adapters may be synchronous
or asynchronous; read/write failure invokes `onFailure` but never breaks UI.
Cross-tab updates are normalized and invalid values fall back to provider
defaults. Reset means the provider's configured default, not a global preset.

`reduced` shortens decorative motion and `none` sets decorative duration to
zero. Essential state communication must not rely on animation alone.

## SSR and no-flash bootstrap

Resolve the initial preference from a cookie/header adapter on the server. Emit
`KvtThemeBootstrapScript` before application CSS/React hydration and pass the
CSP nonce. The generated script safely serializes configuration and applies
only the selected target attributes; it does not inject global product styles.

## Serialization and migrations

Persist `{ version, theme }` with `serializeTheme()`. `deserializeTheme()` only
accepts the current schema or an explicit ordered migration. Register custom
schemes by stable ID in `ThemeSchemeRegistry`; never execute serialized code.

## Tailwind CSS 4

`@kvt/theme-tailwind` maps semantic variables to opt-in namespaced utilities.
It does not import React or create a global `body` baseline. Applications remain
responsible for their reset, typography defaults and component design system.

```css
@import "tailwindcss";
@import "@kvt/theme-tailwind/theme.css";
```

```tsx
<section className="rounded-kvt-lg bg-kvt-surface p-kvt-lg text-kvt-on-surface shadow-kvt-3">
  <h1 className="text-kvt-title-lg text-kvt-primary">Semantic theme tokens</h1>
</section>
```

These classes point to the scoped `--kvt-*` variables. `KvtThemeProvider`
changes those variables, so components do not need conditional `dark:` colors
or inline theme expressions.
