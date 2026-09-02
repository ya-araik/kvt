# Tailwind CSS 4

`@kvt/theme-tailwind` связывает KVT CSS variables с namespaced Tailwind
utilities. Пакет не содержит component styles.

Используйте его, если application уже пишет layout/components на Tailwind 4 и
хочет обращаться к KVT semantic tokens через classes. Без Tailwind подключайте
variables из `theme-core` напрямую — этот adapter не обязателен.

## Подключение

```css
@import "tailwindcss";
@import "@kvt/theme-tailwind/theme.css";
```

Vite:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
});
```

Одного CSS import недостаточно: variables должны быть применены к ancestor
через `KvtThemeProvider` или `themeToCssText()`. Иначе utilities существуют,
но их значения `var(--kvt-...)` не определены.

## Colors

```tsx
<section className="bg-kvt-surface text-kvt-on-surface">
  <button className="bg-kvt-primary text-kvt-on-primary">Save</button>
</section>
```

Доступны все semantic colors: primary/secondary/tertiary, containers, error,
background, surface, outlines и inverse pairs.

## Typography

```tsx
<h1 className="font-kvt-sans text-kvt-headline-lg">Title</h1>
<p className="text-kvt-body-lg">Body</p>
<span className="text-kvt-label-sm">Label</span>
```

Utility содержит font size, line height, letter spacing и weight из theme.

## Spacing и shapes

```tsx
<article className="rounded-kvt-xl p-kvt-lg">
  <div className="mt-kvt-sm gap-kvt-md" />
</article>
```

Namespaced scale не конфликтует с product Tailwind scale. Обычные utilities
`flex`, `grid`, `w-full` продолжают работать.

## Elevation и easing

```tsx
<div className="shadow-kvt-3 transition-colors ease-kvt-standard" />
```

Durations пока читаются как arbitrary CSS variable:

```tsx
className = "duration-(--kvt-motion-duration-medium)";
```

При motion preference `none` duration variable становится `0ms` без условного
JS.

## Почему class не меняется при dark theme

Mapping выглядит так:

```css
@theme inline {
  --color-kvt-surface: var(--kvt-colors-surface);
}
```

`KvtThemeProvider` меняет `--kvt-colors-surface`, а generated utility продолжает
ссылаться на variable. Поэтому не нужен conditional:

```tsx
// Не требуется
className={dark ? 'bg-zinc-950' : 'bg-white'}
```

## Programmatic CSS generation

```ts
import { createKvtTailwindThemeCss } from "@kvt/theme-tailwind";

const css = createKvtTailwindThemeCss();
```

Published `theme.css` проверяется тестом на точное совпадение с generator, чтобы
не появилось два источника истины.

## Граница ответственности

KVT mapping даёт tokens, но application сама проектирует components, responsive
layout и states. Framework не добавляет global reset поверх Tailwind и не
стилизует `html`/`body`.

## Что использовать вместе

```tsx
function PrimaryButton(props: React.ComponentProps<"button">) {
  return (
    <button
      {...props}
      className="rounded-kvt-md bg-kvt-primary px-kvt-md py-kvt-sm
                 text-kvt-on-primary shadow-kvt-1
                 focus-visible:outline-kvt-outline"
    />
  );
}
```

Semantic utility отвечает за цвет и design token, а обычный Tailwind — за
layout, interaction variants и responsive behavior. Проверяйте generated class
names обычным Tailwind build: динамически собранная строка вроде
`` `bg-kvt-${role}` `` может не попасть в output CSS.
