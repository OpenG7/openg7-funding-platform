import {
  definePublicPageSuite,
  publicJourneyProjects
} from './ui/playwright-fixtures.config.mjs';

export default definePublicPageSuite({
  testMatch: [
    'builders-public.spec.ts',
    'public-journeys.spec.ts',
    'support-page.spec.ts',
    'refund-policy.spec.ts'
  ],
  outputDir: '../test-results/public-journeys',
  projects: publicJourneyProjects()
});
