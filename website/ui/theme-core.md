# Theme core

`@kvt/theme-core` описывает semantic design tokens без React, DOM и Tailwind.
Theme — immutable value object.

Пакет нужен, когда одна visual language должна одинаково работать в React,
Shadow DOM, SSR или другом renderer. Если приложение имеет несколько
несвязанных цветов и не переключает schemes, обычных CSS variables может быть
достаточно.

## Структура

```ts
interface KvtTheme {
  colors: ColorScheme;
  typography: TypographyScheme;
  shapes: ShapeScheme;
  spacing: SpacingScheme;
  motion: MotionScheme;
  elevation: ElevationScheme;
}
```

Semantic token описывает роль, а не конкретный цвет: `primary`, `surface`,
`onSurface`, `error`. Поэтому component не спрашивает, тёмная ли тема.

Semantic naming отделяет решение дизайнера от реализации component. Кнопка
использует `primary/onPrimary`; light, dark и high-contrast themes могут менять
конкретные значения, не меняя JSX и component API.

## Color pairs

Foreground/background используются парами:

- `primary` / `onPrimary`;
- `primaryContainer` / `onPrimaryContainer`;
- `surface` / `onSurface`;
- `surfaceVariant` / `onSurfaceVariant`;
- `error` / `onError`;
- `inverseSurface` / `inverseOnSurface`.

Не ставьте `onPrimary` на случайный background: contrast contract относится к
своей паре.

## Создание scheme

```ts
const brandLight = createTheme({
  colors: createLightColorScheme({
    primary: "#5b5fe8",
    onPrimary: "#ffffff",
    primaryContainer: "#e3e2ff",
    onPrimaryContainer: "#15145f",
  }),
  shapes: { medium: "0.875rem" },
});
```

`DeepPartial` позволяет переопределить только нужные fields. Result полностью
заполнен, валидирован и deep-frozen.

Dark scheme создавайте отдельно:

```ts
const brandDark = createTheme({
  colors: createDarkColorScheme({
    primary: "#c2c1ff",
    onPrimary: "#29287a",
  }),
});
```

## Validation

```ts
validateTheme(theme);
const failures = validateThemeContrast(theme);
```

Проверяются exact keys, CSS values, typography structure, motion preference и
документированные WCAG contrast pairs.

Запускайте contrast validation при создании/сборке темы, а не на каждый render.
Успешная проверка token pairs не гарантирует accessibility всего component:
opacity, изображение под текстом и нестандартное сочетание tokens нужно
проверять отдельно.

## CSS variables

```ts
const variables = themeToCssVariables(theme);
const css = themeToCssText(theme, ":host");
```

Имена namespaced: `--kvt-colors-primary`, `--kvt-spacing-large` и т.д. Core не
применяет их к document — target выбирает adapter/application.

## Motion

```ts
withMotionPreference(theme, "reduced");
withMotionPreference(theme, "none");
```

`reduced` сокращает декоративные durations, `none` делает их `0ms`. Essential
state change нельзя передавать только анимацией.

## Serialization

```ts
const stored = serializeTheme(theme);
const restored = deserializeTheme(stored, migrations);
```

Формат versioned. Migration обязана двигаться ровно на одну version. Unknown
version без migration отклоняется.

## Custom registry

```ts
const registry = new ThemeSchemeRegistry();
registry.register("brand-high-contrast", highContrastTheme);
```

High contrast — обычная custom scheme, а не hardcoded product mode framework.

## Рекомендуемый workflow

1. Определите semantic roles и пары foreground/background.
2. Создайте light и dark scheme из одного набора ролей.
3. Проверьте structure и contrast в тесте.
4. Преобразуйте theme в CSS variables на renderer boundary.
5. Компоненты используют только semantic variables/utilities.
6. Версионируйте serialized preference при изменении persisted contract.

Не экспортируйте mutable theme builder как global singleton. Экспортируйте
готовые frozen themes, чтобы результат render не зависел от порядка импортов.
