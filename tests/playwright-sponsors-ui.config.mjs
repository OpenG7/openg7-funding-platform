import { definePublicPageSuite } from './ui/playwright-fixtures.config.mjs';

export default definePublicPageSuite({
  testMatch: 'sponsors-public.spec.ts',
  outputDir: '../test-results/sponsors'
});
