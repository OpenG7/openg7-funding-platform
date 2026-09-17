import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAdminStripeEvent,
  validStripeEventId
} from '../dist/apps/funding-api/src/admin-stripe-event.service.js';

test('Stripe inspection validates identifiers and distinguishes unavailable storage', async () => {
  assert.equal(validStripeEventId('evt_local_123'), true);
  for (const id of ['', 'pi_123', "evt_' OR TRUE", 'evt_' + 'x'.repeat(197)]) {
    assert.equal(validStripeEventId(id), false);
    await assert.rejects(getAdminStripeEvent(null, id));
  }
  assert.deepEqual(await getAdminStripeEvent(null, 'evt_local'), {
    available: false,
    event: null
  });
});
