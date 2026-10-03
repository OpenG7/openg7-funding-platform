import {
  definePublicPageSuite,
  publicJourneyProjects
} from './ui/playwright-fixtures.config.mjs';

export default definePublicPageSuite({
  testMatch: ['platform-accessibility.spec.ts'],
  outputDir: '../test-results/platform-accessibility',
  projects: publicJourneyProjects()
});
