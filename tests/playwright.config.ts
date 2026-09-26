import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: '../test-results/integration',
  reporter: [
    ['list'],
    [
      '../src/reporter.ts',
      {
        outputFile: '../test-results/integration/jev-report.json',
        markdownFile: '../test-results/integration/jev-report.md',
      },
    ],
  ],
  expect: { timeout: 5_000 },
  use: { headless: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
