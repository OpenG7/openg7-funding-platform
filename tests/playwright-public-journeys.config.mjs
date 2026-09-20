import { defineConfig, devices } from '@playwright/test';
import publicConfig from './playwright-about-ui.config.mjs';

export default defineConfig({
  ...publicConfig,
  testMatch: [
    'builders-public.spec.ts',
    'public-journeys.spec.ts',
    'support-page.spec.ts',
    'refund-policy.spec.ts'
  ],
  outputDir: '../test-results/public-journeys',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }
  ]
});
