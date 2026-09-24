import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './identity',
  testMatch: '*.spec.ts',
  outputDir: '../test-results/identity/browser',
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 10000 },
  reporter: [
    ['list'],
    ['json', { outputFile: '../test-results/identity/results.json' }]
  ],
  use: {
    browserName: 'chromium',
    actionTimeout: 10000,
    navigationTimeout: 15000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
