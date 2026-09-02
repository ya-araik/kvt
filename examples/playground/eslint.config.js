import js from '@eslint/js'
import kvt from '@kvt/eslint-plugin'
import eslintConfigPrettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist/**',
    'coverage/**',
    'node_modules/**',
    'playwright-report/**',
    'test-results/**'
  ]),
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended]
  },
  {
    files: ['src/app.tsx', 'src/presentation/view/**/*.{jsx,tsx}'],
    extends: [reactRefresh.configs.vite]
  },
  ...kvt.configs.recommended,
  eslintConfigPrettier
])
