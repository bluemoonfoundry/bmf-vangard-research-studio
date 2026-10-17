import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  require: 'readonly',
  module: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  structuredClone: 'readonly',
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Renderer (React + TypeScript)
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },

  // Electron main process, preload, and Node-side config/test files
  {
    files: ['electron/**/*.{js,ts}', 'e2e/**/*.{js,ts}', '*.config.{js,ts}'],
    languageOptions: { globals: nodeGlobals },
    rules: {
      // preload.js is CommonJS by necessity (sandboxed preload).
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Use electron/lib/logger.main.js -- console output is lost in packaged builds.
      'no-console': 'error',
    },
  },

  // The logger is the one place console is the implementation; tests may log freely.
  {
    files: ['electron/lib/logger.main.js', '**/*.test.{ts,tsx}'],
    rules: { 'no-console': 'off' },
  },

  {
    ignores: ['dist/**', 'release/**', 'coverage/**', 'node_modules/**', 'e2e/test-results/**', 'playwright-report/**'],
  },
);
