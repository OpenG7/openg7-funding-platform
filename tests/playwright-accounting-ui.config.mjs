import { defineBuiltWebSuite } from './ui/playwright-fixtures.config.mjs';

// Accounting UI only: built Angular app and intercepted synthetic APIs.
// No Docker stack, identity provider, database seed or external delivery.
export default defineBuiltWebSuite({
  testMatch: [
    'admin-document-resend-ui.spec.ts',
    'admin-allocation-create-ui.spec.ts',
    'admin-allocation-edit-ui.spec.ts',
    'admin-contributions-ui.spec.ts'
  ],
  outputDir: '../test-results/admin-accounting'
});
