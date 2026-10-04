import { defineBuiltWebSuite } from './ui/playwright-fixtures.config.mjs';

// Exercises the built web app with intercepted synthetic API fixtures.
// Does not start the API, load .env, seed a DB, or run the Docker teardown.
export default defineBuiltWebSuite({
  testMatch: [
    'admin-audit-ui.spec.ts',
    'admin-transparency-ui.spec.ts',
    'admin-allocation-create-ui.spec.ts',
    'admin-allocation-edit-ui.spec.ts',
    'admin-stripe-backfill-ui.spec.ts',
    'admin-access-ui.spec.ts',
    'admin-setup-email-ui.spec.ts',
    'admin-backups-ui.spec.ts',
    'admin-setup-layout.spec.ts',
    'admin-pilotage.spec.ts',
    'admin-inspection.spec.ts',
    'admin-email-recovery-ui.spec.ts',
    'admin-document-resend-ui.spec.ts',
    'admin-dashboard-layout.spec.ts',
    'admin-typography.spec.ts',
    'admin-cockpit.spec.ts',
    'admin-global-search.spec.ts',
    'admin-attention.spec.ts',
    'admin-assistant-context.spec.ts',
    'admin-assistant-overview.spec.ts',
    'admin-sponsorship-progress.spec.ts',
    'admin-sponsor-list-controller.ui.ts',
    'admin-publication-queue.spec.ts',
    'admin-publication-automation.spec.ts'
  ],
  outputDir: '../test-results/admin-layout'
});
