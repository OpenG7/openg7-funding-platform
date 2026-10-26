import { devices } from '@playwright/test';

import { definePublicPageSuite } from './ui/playwright-fixtures.config.mjs';

// Synthetic browser-only prototype: no API process, DB, seed or provider.
export default definePublicPageSuite({
  testMatch: ['service-demo.ui.spec.ts'],
  outputDir: '../test-results/service-demo',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1536, height: 864 }
      }
    },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }
  ]
});
