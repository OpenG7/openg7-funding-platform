import { definePublicPageSuite } from './ui/playwright-fixtures.config.mjs';

export default definePublicPageSuite({
  testMatch: 'boutique.spec.ts',
  outputDir: '../test-results/boutique'
});
