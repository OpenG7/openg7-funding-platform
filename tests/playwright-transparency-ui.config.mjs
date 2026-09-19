import { defineConfig } from '@playwright/test';
import publicPageConfig from './playwright-about-ui.config.mjs';

export default defineConfig({
  ...publicPageConfig,
  testMatch: 'funding-transparency-public.spec.ts',
  outputDir: '../test-results/transparency'
});
