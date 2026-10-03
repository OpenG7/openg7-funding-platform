import { definePublicPageSuite } from './ui/playwright-fixtures.config.mjs';

// Built public pages and intercepted APIs; no database, Stripe, seed or teardown.
export default definePublicPageSuite({
  testMatch: 'funding-about.spec.ts',
  outputDir: '../test-results/about'
});
