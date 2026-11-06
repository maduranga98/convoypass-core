import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'functions/lib', 'functions/node_modules']),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Our field labels wrap the input and a two-line text block (label > span > span > text).
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either', depth: 4 }],
      // Zod's JIT compiler needs 'unsafe-eval' (blocked by our CSP): '@/lib/zod' turns it off.
      'no-restricted-imports': ['error', { paths: [{ name: 'zod', message: "Import { z } from '@/lib/zod' (CSP-safe)." }] }],
      // React calls whatever an effect returns as its cleanup. An expression body returns the call's value, and some
      // browser APIs now return one (window.scrollTo gives a Promise in current Chrome): "x is not a function" on
      // unmount. Write effects with a block body, or return a cleanup arrow (`() => () => ...`).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression.arguments:first-child[expression=true]:not([body.type='ArrowFunctionExpression'])",
          message: 'Give effects a block body: an expression body becomes the cleanup React calls on unmount.',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'e2e/**/*.ts', 'functions/**/*.ts', '*.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
])
