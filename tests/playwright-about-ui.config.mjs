import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Built public pages and intercepted APIs; no database, Stripe, seed or teardown.
export default defineConfig({
  testDir: './playwright',
  testMatch: 'funding-about.spec.ts',
  outputDir: '../test-results/about',
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 7500 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }
  ],
  webServer: {
    command: '"' + process.execPath + '" tests/ui/serve-built-web.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false
  }
});
