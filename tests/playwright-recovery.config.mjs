import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './recovery',
  testMatch: '*.spec.mjs',
  workers: 1,
  retries: 0,
  timeout: 480000,
  expect: { timeout: 15000 },
  outputDir: '../test-results/recovery/browser',
  reporter: [
    ['list'],
    ['json', { outputFile: '../test-results/recovery/results.json' }]
  ],
  use: {
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
