import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/** Modules that must stay pure so they run unchanged in Node and in a Web Worker. */
const PURE = [
  'src/core/**/*.js',
  'src/jpeg/**/*.js',
  'src/exif/**/*.js',
  'src/container/**/*.js',
  'src/analysis/**/*.js',
  'src/pipeline/**/*.js',
  'src/report/**/*.js',
  'src/findings/**/*.js',
];

export default [
  { ignores: ['dist/**', 'coverage/**', '.cache/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      curly: ['error', 'multi-line'],
    },
  },
  { files: ['src/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['src/worker/**/*.js'], languageOptions: { globals: { ...globals.worker } } },
  {
    files: PURE,
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'EventSource',
        'navigator',
        'localStorage',
      ],
    },
  },
  {
    files: ['test/**/*.js', 'tools/**/*.mjs', '*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
];
