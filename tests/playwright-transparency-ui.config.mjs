import { definePublicPageSuite } from './ui/playwright-fixtures.config.mjs';

export default definePublicPageSuite({
  testMatch: 'funding-transparency-public.spec.ts',
  outputDir: '../test-results/transparency'
});
