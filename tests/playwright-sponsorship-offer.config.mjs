import { devices } from '@playwright/test';
import { defineBuiltWebSuite } from './ui/playwright-fixtures.config.mjs';

// Server offer fixtures only: no Stripe, database or contract activation.
export default defineBuiltWebSuite({
  testMatch: ['funding-home-trust.spec.ts', 'sponsorship-followup.spec.ts'],
  grep: /sponsorship offer|switching the default|moderation V1.*charter|invalid sponsorship input/,
  outputDir: '../test-results/sponsorship-offer-ui',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /EN mobile/
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'] },
      grep: /(?=.*(?:sponsorship offer|switching the default|moderation V1.*charter|invalid sponsorship input))(?=.*EN mobile)/
    }
  ]
});
