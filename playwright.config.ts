import { defineConfig, devices } from '@playwright/test';

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '') ??
  'http://127.0.0.1:8080';

export default defineConfig({
  testDir: './tests/playwright',
  globalTeardown: './tests/playwright/global-teardown.mjs',
  timeout: 30_000,
  expect: {
    timeout: 7_500
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
