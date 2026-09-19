import { defineConfig, devices } from '@playwright/test';

import adminUiConfig from './tests/playwright-admin-ui.config.mjs';
import followupUiConfig from './tests/playwright-followup-ui.config.mjs';

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '') ??
  'http://127.0.0.1:8080';

// @mobile covers public/admin reads and journeys with intercepted mutations.
// Session creation is allowed. Real business mutations run once on desktop
// Chromium; replaying them on a second browser would reuse modified fixtures.
const MOBILE_TAG = /@mobile/;

export default defineConfig({
  testDir: './tests/playwright',
  // Follow-up fixtures run in their isolated CI step in both workflows.
  // Admin fixtures have a separate step in the disposable acceptance workflow.
  // Reuse each suite's testMatch so no fixture is replayed against Docker there.
  testIgnore: [
    followupUiConfig.testMatch ?? [],
    process.env.OPENG7_E2E_ISOLATED === '1'
      ? (adminUiConfig.testMatch ?? [])
      : []
  ].flat(),
  outputDir:
    process.env.OPENG7_E2E_ISOLATED === '1'
      ? 'test-results/acceptance/browser'
      : 'test-results/docker',
  globalTeardown: './tests/playwright/global-teardown.mjs',
  timeout: 30_000,
  expect: {
    timeout: 7_500
  },
  fullyParallel: false,
  retries: process.env.OPENG7_E2E_ISOLATED === '1' ? 0 : process.env.CI ? 2 : 0,
  workers: 1,
  reporter:
    process.env.OPENG7_E2E_ISOLATED === '1'
      ? [
          ['list'],
          ['json', { outputFile: 'test-results/acceptance/results.json' }]
        ]
      : [['list']],
  use: {
    baseURL,
    trace:
      process.env.OPENG7_E2E_ISOLATED === '1'
        ? 'retain-on-failure'
        : 'on-first-retry',
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
      // Public/admin reads or isolated fixtures on an emulated
      // Pixel 5. Pixel 5 is a Chromium device, so it reuses the browser binary
      // already installed by `playwright install chromium` -- no extra
      // download and no change to the install script.
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      grep: MOBILE_TAG
    }
  ]
});
