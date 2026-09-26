import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { configureJev } from 'playwright-jev';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile) && process.env.JEV_MODE === 'record') process.loadEnvFile(envFile);

const recording = process.env.JEV_MODE === 'record';

configureJev({
  fixturesDir: fileURLToPath(new URL('./.jev/fixtures', import.meta.url)),
  ...(recording ? { maxRetries: 6, maxRetryDelayMs: 65_000, requestTimeoutMs: 400_000 } : {}),
});

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: recording ? 600_000 : 30_000,
  outputDir: '../test-results/examples',
  reporter: [
    ['list'],
    [
      fileURLToPath(import.meta.resolve('playwright-jev/reporter')),
      { outputFile: '../test-results/examples/jev-report.json', failOnUnverified: true },
    ],
  ],
  use: { headless: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
