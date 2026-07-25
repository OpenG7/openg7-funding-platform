import { defineConfig, devices } from '@playwright/test';

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '') ??
  'http://127.0.0.1:8080';

// Tests tagged @mobile are read-only public journeys that are safe to replay
// on more than one browser/viewport. Every other spec mutates the shared local
// database (Stripe webhooks, admin actions, seeded fixtures), so it must run on
// exactly one project -- desktop Chromium -- and never be replayed by a second
// browser against the same database.
const MOBILE_TAG = /@mobile/;

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
      // Full functional suite on desktop Chromium. Excludes the @mobile-only
      // responsive checks, which the mobile-chrome project owns, so the
      // database-mutating specs are not needlessly duplicated.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: MOBILE_TAG
    },
    {
      // Pragmatic mobile smoke: read-only public journeys on an emulated
      // Pixel 5. Pixel 5 is a Chromium device, so it reuses the browser binary
      // already installed by `playwright install chromium` -- no extra
      // download and no change to the install script.
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      grep: MOBILE_TAG
    }
  ]
});
