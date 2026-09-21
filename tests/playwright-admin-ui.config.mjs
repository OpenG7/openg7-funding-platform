import { defineConfig } from '@playwright/test';

import { fileURLToPath } from 'node:url';

// Exercises the built web app with intercepted synthetic API fixtures.
// Does not start the API, load .env, seed a DB, or run the Docker teardown.
export default defineConfig({
  testDir: './playwright',
  testMatch: [
    'admin-inspection.spec.ts',
    'admin-dashboard-layout.spec.ts',
    'admin-cockpit.spec.ts',
    'admin-global-search.spec.ts',
    'admin-attention.spec.ts',
    'admin-assistant-context.spec.ts',
    'admin-sponsorship-progress.spec.ts',
    'admin-publication-queue.spec.ts'
  ],
  outputDir: '../test-results/admin-layout',
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: '"' + process.execPath + '" tests/ui/serve-built-web.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false
  }
});
