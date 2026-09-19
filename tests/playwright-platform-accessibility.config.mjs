import { defineConfig } from '@playwright/test';
import publicConfig from './playwright-public-journeys.config.mjs';
export default defineConfig({
  ...publicConfig,
  testMatch: ['platform-accessibility.spec.ts'],
  outputDir: '../test-results/platform-accessibility'
});
