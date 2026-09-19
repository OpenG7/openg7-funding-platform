import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Local browser coverage with intercepted synthetic data; no API, Stripe or DB.
export default defineConfig({
  testDir: './playwright',
  testMatch: [
    'sponsorship-followup.spec.ts',
    'sponsor-media-upload-feedback.spec.ts'
  ],
  outputDir: '../test-results/followup',
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@mobile/
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      grep: /@mobile/
    }
  ],
  webServer: {
    command: '"' + process.execPath + '" tests/ui/serve-built-web.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false
  }
});
