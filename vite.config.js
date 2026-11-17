import { defineConfig } from 'vitest/config';

/** GitHub Pages serves the app from https://tiendung21.github.io/veritas-image-forensics/ */
export const PAGES_BASE = '/veritas-image-forensics/';

/**
 * Production Content Security Policy. The app needs no network access beyond its own static
 * files (scripts, styles, the worker, sample images), so everything else is refused, including
 * any request a decoding bug or a dependency might try to make. Injected only into the build:
 * the dev server needs inline scripts and a WebSocket for hot reload.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// `vite preview` runs as command 'serve'; it must use the build's base to serve dist/ under
// the same sub-path as Pages.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? PAGES_BASE : '/',
  plugins: [
    {
      name: 'veritas-csp',
      apply: 'build',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ],
    },
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    maxWorkers: 4,
    testTimeout: 20000,
  },
}));
