import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: process.env.JEV_LIVE ? [] : ['test/live/**'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/types.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 90, branches: 80, functions: 90, statements: 90 },
    },
  },
});
