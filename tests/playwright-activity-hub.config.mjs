import { devices } from '@playwright/test';

import { definePublicPageSuite } from './ui/playwright-fixtures.config.mjs';

// Synthetic, browser-local module: no API, identity provider, database or seed.
export default definePublicPageSuite({
  testMatch: ['activity-hub.ui.spec.ts', 'activity-hub-journal.ui.spec.ts'],
  outputDir: '../test-results/activity-hub',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1672, height: 941 }
      }
    },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }
  ]
});
