# `@kvt/eslint-plugin`

ESLint 9 flat-config rules for KVT applications.

```js
import kvt from '@kvt/eslint-plugin'

export default [
  ...kvt.configs.recommended
]
```

The recommended config checks Clean Architecture dependency direction,
business/UI error model placement, removed KVT prototype APIs and host globals
inside domain code. It does not provide stylistic formatting; use Prettier for
that.
