import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAdminWorkQueue,
  resolveSponsorshipSelection
} from '../../dist/apps/funding-api/src/admin-work-queue.service.js';
import { getAdminDashboard } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'the complete operational queue survives multiple currencies without changing scalar financial guards',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    await pool.query(
      "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at) VALUES('personal_support',1501,'cad','disputed',NOW())"
    );
    const single = await getAdminWorkQueue(pool);
    assert.equal(single.available, true);
    assert.equal(
      single.items.find((item) => item.type === 'financial_data_warning').id,
      'financial_data_warning:disputed'
    );

    const sponsor = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,stripe_session_id)
    VALUES('sponsorship_interest',50000,'usd','paid',NOW(),'cs_test_operational_currencies') RETURNING id`)
    ).rows[0].id;
    await pool.query(
      "INSERT INTO stripe_events(stripe_event_id,event_type,payload,processing_status) VALUES('evt_test_operational_currencies','payment_intent.succeeded','{}'::jsonb,'failed')"
    );
    await assert.rejects(getAdminDashboard(pool), {
      code: 'ADMIN_FINANCIAL_CURRENCY_CONFLICT'
    });
    const mixed = await getAdminWorkQueue(pool, { pageSize: 100 });
    assert.equal(mixed.available, true);
    assert.equal(mixed.coverage, 'complete');
    assert.deepEqual(mixed.missingSources, []);
    assert.equal(mixed.typeCounts.invoice_missing, 1);
    assert.equal(mixed.typeCounts.sponsorship_needs_info, 1);
    assert.equal(mixed.typeCounts.stripe_event_failed, 1);
    assert.equal(
      mixed.items.find((item) => item.type === 'invoice_missing')
        .contributionId,
      sponsor
    );
    assert.equal(
      mixed.items.find((item) => item.type === 'financial_data_warning').id,
      'financial_data_warning:disputed'
    );
    assert.equal(
      (await resolveSponsorshipSelection(pool)).sponsorshipId,
      sponsor
    );

    await pool.query(
      "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at) VALUES('personal_support',2502,'USD','disputed',NOW())"
    );
    const queue = await getAdminWorkQueue(pool, {
      type: 'financial_data_warning',
      pageSize: 100
    });
    assert.equal(queue.available, true);
    assert.equal(queue.filteredTotal, 2);
    assert.deepEqual(
      queue.items
        .map((item) => [
          item.id,
          item.facts.currency,
          item.facts.disputedAmountMinor
        ])
        .sort(),
      [
        ['financial_data_warning:disputed:CAD', 'CAD', 1501],
        ['financial_data_warning:disputed:USD', 'USD', 2502]
      ]
    );
    assert.equal(queue.typeCounts.invoice_missing, 1);
    assert.equal(queue.typeCounts.stripe_event_failed, 1);
    await assert.rejects(getAdminDashboard(pool), {
      code: 'ADMIN_FINANCIAL_CURRENCY_CONFLICT'
    });
  }
);
