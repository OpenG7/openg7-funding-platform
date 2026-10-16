import { defineConfig } from '@playwright/test';

// The isolated sandbox launcher owns startup and teardown. No existing site is adopted.
export default defineConfig({
  testDir: './playwright',
  testMatch: 'admin-sandbox-acceptance.spec.ts',
  outputDir: '../test-results/admin-sandbox/browser',
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 10000 },
  reporter: [
    ['list'],
    ['json', { outputFile: '../test-results/admin-sandbox/results.json' }]
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 10000,
    navigationTimeout: 20000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
