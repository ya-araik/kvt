# Theme React

`@kvt/theme-react` применяет KVT theme к явному target и управляет preference.

`theme-core` описывает значения, а этот пакет владеет browser side effects:
CSS variables, media-query listeners, storage subscription и cleanup. Поэтому
provider должен находиться на границе DOM subtree, которую он действительно
оформляет.

## Provider

```tsx
<KvtThemeProvider
  target={rootElement}
  light={brandLight}
  dark={brandDark}
  storage={createLocalStorageThemeAdapter(localStorage)}
>
  <App />
</KvtThemeProvider>
```

Target — `HTMLElement` или `ShadowRoot`. Provider не меняет `body` без явного
выбора application.

| Где работает UI                              | Рекомендуемый target                 |
| -------------------------------------------- | ------------------------------------ |
| Обычная SPA целиком                          | root element приложения              |
| Widget на чужой странице                     | element widget-а                     |
| Web component                                | его `ShadowRoot`                     |
| Несколько независимо брендированных областей | отдельный target/provider для каждой |

## Scoped target

Для HTMLElement variables пишутся в inline style выбранного root. Для
ShadowRoot создаётся scoped `:host` style.

Несколько providers на одном target образуют stack. При unmount верхнего слоя
восстанавливается предыдущий, а после последнего — исходное состояние target.

## Preference

```ts
const theme = useKvtTheme();

theme.preference; // сохранённый выбор
theme.resolvedColor; // фактически light/dark
theme.resolvedMotion; // full/reduced/none
theme.theme; // итоговый KvtTheme

theme.setPreference({ color: "dark", motion: "system" });
theme.reset();
```

Color: `light | dark | system`. Motion: `full | reduced | none | system`.

User preference имеет приоритет над system media query.

Храните preference (`dark/system`, `reduced/system`), а не вычисленный theme.
Тогда выбор `system` продолжит реагировать на изменения ОС и не устареет между
сессиями.

## Storage fail-soft

Storage adapter может быть sync или async. Ошибка чтения/записи не ломает UI:

```tsx
<KvtThemeProvider
  target={root}
  storage={storage}
  onFailure={({ operation, error }) => report(operation, error)}
>
  <App />
</KvtThemeProvider>
```

Late async storage read не перезаписывает более новый user choice.

## Cross-tab

`createLocalStorageThemeAdapter()` подписывается на browser `storage` event.
Изменение preference в другой вкладке обновляет текущую.

## System changes

Provider слушает:

- `prefers-color-scheme`;
- `prefers-reduced-motion`.

Listeners снимаются при provider cleanup.

## SSR no-flash

До CSS и hydration вставьте:

```tsx
<KvtThemeBootstrapScript nonce={cspNonce} />
```

Либо получите string:

```ts
createThemePreHydrationScript({
  storageKey: "kvt-theme",
});
```

Script выбирает initial scheme до первого paint. Передавайте CSP nonce и не
встраивайте user data в options.

## Reset

`reset()` возвращает `defaultPreference` конкретного provider, а не
framework-global preset. Это важно для branded приложения.

## Ошибки использования

- применять theme к `document.body` неосознанно;
- создавать новый `light/dark` object на каждый render;
- менять CSS variables вручную параллельно с provider;
- делать `dark:` classes вместо semantic token, если различие только цветовое;
- забывать pre-hydration script при SSR.

Если target создаётся после первого render, вынесите bootstrap на уровень host,
где element уже известен. Не ищите target через `document.querySelector()` в
каждом component — это теряет ownership и усложняет micro-frontend teardown.
