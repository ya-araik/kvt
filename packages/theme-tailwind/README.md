# `@kvt/theme-tailwind`

Generates opt-in Tailwind CSS 4 mappings under the `kvt-*` namespace. It does
not emit global element styles.

```css
@import "tailwindcss";
@import "@kvt/theme-tailwind/theme.css";
```

KVT theme variables then drive regular Tailwind utilities such as
`bg-kvt-surface`, `text-kvt-on-surface`, `rounded-kvt-lg`, `p-kvt-md`,
`shadow-kvt-3` and `text-kvt-title-lg`. Changing the active KVT theme updates
the variables; components do not need dark-mode class branches.
