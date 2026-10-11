import { devices } from '@playwright/test';
import { defineBuiltWebSuite } from './ui/playwright-fixtures.config.mjs';

// Built Web and synthetic intercepted APIs; no database, provider or activation.
export default defineBuiltWebSuite({
  testMatch: [
    'admin-sponsorship-progress.spec.ts',
    'sponsorship-moderation-followup.spec.ts',
    'funding-home-trust.spec.ts'
  ],
  grep: /moderation V1/,
  outputDir: '../test-results/moderation-ui',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'] },
      grep: /moderation V1.*EN mobile/
    }
  ]
});
