import assert from 'node:assert/strict';
import test from 'node:test';

import { webhooksTransparencySourceLabel } from '../dist/apps/funding-web/src/app/features/funding/pages/webhooks-page/webhooks-presentation.js';

test('webhook diagnostics preserve their page-specific transparency labels', () => {
  assert.equal(webhooksTransparencySourceLabel('database'), 'PostgreSQL');
  assert.equal(webhooksTransparencySourceLabel('stripe'), 'Stripe direct');
  assert.equal(webhooksTransparencySourceLabel('none'), 'A configurer');
});
