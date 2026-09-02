import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/temp/**',
    '**/website/public/api/**',
    '**/.vitepress/cache/**',
    '**/test-results/**',
    '**/playwright-report/**'
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
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^T($|[A-Z])'
      }]
    }
  },
  {
    files: ['examples/**/*.{ts,tsx}'],
    extends: [reactRefresh.configs.vite]
  }
])
