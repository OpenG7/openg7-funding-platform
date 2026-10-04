import { definePublicPageSuite } from './ui/playwright-fixtures.config.mjs';

export default definePublicPageSuite({
  testMatch: ['dev-tools-pages.spec.ts'],
  outputDir: '../test-results/dev-tools'
});
