import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

// Standalone browser checks with mocked APIs, without Docker, seed, or cleanup.
export default defineConfig({
  testDir: '.',
  testMatch: ['funding-home-trust.spec.ts', 'payment-recovery-ui.spec.ts'],
  outputDir: '../../test-results/funding-home',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4301',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `"${process.execPath}" node_modules/@angular/cli/bin/ng.js serve funding-web --host 127.0.0.1 --port 4301`,
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    url: 'http://127.0.0.1:4301',
    timeout: 120_000,
    reuseExistingServer: false
  }
});
