import { defineConfig } from 'vitest/config';

/** GitHub Pages serves the app from https://tiendung21.github.io/veritas-image-forensics/ */
export const PAGES_BASE = '/veritas-image-forensics/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? PAGES_BASE : '/',
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    maxWorkers: 4,
    testTimeout: 20000,
  },
}));
