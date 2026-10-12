import { devices } from '@playwright/test';
import { defineBuiltWebSuite } from './ui/playwright-fixtures.config.mjs';
// Synthetic intercepted API responses only; no provider, database or contract activation.
export default defineBuiltWebSuite({
  testMatch: [
    'sponsor-media-upload-feedback.spec.ts',
    'admin-sponsorship-progress.spec.ts',
    'admin-publication-automation.spec.ts',
    'sponsors-public.spec.ts'
  ],
  grep: /image usage|exact JPEG/,
  outputDir: '../test-results/sponsor-media-usage-ui',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /EN mobile/
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'] },
      grep: /(?=.*(?:image usage|exact JPEG))(?=.*EN mobile)/
    }
  ]
});
