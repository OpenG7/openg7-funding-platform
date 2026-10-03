import { devices } from '@playwright/test';
import { defineBuiltWebSuite } from './ui/playwright-fixtures.config.mjs';

// Local browser coverage with intercepted synthetic data; no API, Stripe or DB.
export default defineBuiltWebSuite({
  testMatch: [
    'sponsorship-followup.spec.ts',
    'sponsor-media-upload-feedback.spec.ts'
  ],
  outputDir: '../test-results/followup',
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
  ]
});
