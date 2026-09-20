import { defineConfig } from '@playwright/test';

import publicPageConfig from './playwright-about-ui.config.mjs';

export default defineConfig({
  ...publicPageConfig,
  testMatch: 'boutique.spec.ts',
  outputDir: '../test-results/boutique'
});
