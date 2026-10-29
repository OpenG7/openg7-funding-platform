import { devices } from '@playwright/test';

import { defineBuiltWebSuite } from './ui/playwright-fixtures.config.mjs';

// Synthetic administrative fixtures only; no API process, database or provider.
export default defineBuiltWebSuite({
  testMatch: [
    'activity-hub-embedded.ui.spec.ts',
    'admin-guidance.spec.ts',
    'admin-workflow-guide.spec.ts'
  ],
  outputDir: '../test-results/activity-hub-embedded',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1536, height: 864 }
      }
    },
    {
      name: 'mobile-chrome',
      testMatch: ['activity-hub-embedded.ui.spec.ts'],
      use: { ...devices['Pixel 5'] }
    }
  ]
});
