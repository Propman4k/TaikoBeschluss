// Minimal-Setup: recommended + react-hooks + jsx-no-leaked-render
// (faengt die "0 && ..."-Falle, die hier schon zweimal aufgetreten ist).
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'

export default [
  { ignores: ['dist/', 'node_modules/', 'server/node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['server/**/*.{js,mjs}', 'vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, react },
    settings: { react: { version: 'detect' } },
    rules: {
      // Nur die zwei Klassiker — die neuen v7-Compiler-Regeln (immutability etc.)
      // schlagen bei legitimer Hash-Navigation an.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-no-leaked-render': ['error', { validStrategies: ['coerce', 'ternary'] }],
      'react/jsx-uses-vars': 'error', // sonst meldet no-unused-vars JSX-Komponenten
    },
  },
  {
    files: ['server/test/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
]
