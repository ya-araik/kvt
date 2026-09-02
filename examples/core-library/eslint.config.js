import js from '@eslint/js'
import kvt from '@kvt/eslint-plugin'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**']),
  {
    files: ['**/*.{js,mjs,ts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  ...kvt.configs.recommended,
  eslintConfigPrettier
])
