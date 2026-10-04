import assert from 'node:assert/strict';
import test from 'node:test';

import { backfillMissingSponsorshipInvoices as publicBackfill } from '../dist/apps/funding-api/src/sponsorship-invoices.repository.js';
import { backfillMissingSponsorshipInvoices } from '../dist/apps/funding-api/src/sponsorship-documents/invoices.backfill.js';

const candidate = (id) => ({
  id,
  public_reference: `OG7-2026-${id}`,
  stripe_session_id: `cs_test_backfill_${id}`,
  stripe_payment_intent_id: null,
  amount_cents: '25000',
  currency: 'cad',
  paid_at: '2026-09-01T12:00:00.000Z',
  email_private: 'sponsor@example.invalid'
});

const invoiceRow = (id) => ({
  id: `invoice-${id}`,
  contribution_id: id,
  invoice_number: `HISTORICAL-${id}`,
  public_reference: `OG7-2026-${id}`,
  stripe_session_id: `cs_test_backfill_${id}`,
  stripe_payment_intent_id: null,
  issued_at: '2026-09-01T12:00:00.000Z',
  paid_at: '2026-09-01T12:00:00.000Z',
  currency: 'cad',
  subtotal_cents: '25000',
  tax_cents: '0',
  total_cents: '25000',
  tax_label: 'Historical tax label',
  issuer_name: 'Historical issuer',
  issuer_email: null,
  issuer_address: null,
  issuer_tax_id: null,
  sponsor_name: 'Synthetic sponsor',
  sponsor_contact_name: null,
  sponsor_contact_email: null,
  sponsor_website_url: null,
  line_items: [],
  notes: 'Historical notes',
  last_email_status: null,
  last_email_recipient: null,
  last_email_sent_at: null,
  last_email_error: null
});

test('backfill remains the public owning function and reports no work without a pool', async () => {
  assert.equal(publicBackfill, backfillMissingSponsorshipInvoices);
  const result = await publicBackfill(null, { limit: 1000 });
  const { last_updated_at, ...counts } = result;
  assert.ok(Number.isFinite(Date.parse(last_updated_at)));
  assert.deepEqual(counts, {
    data_source: 'database',
    eligible_count: 0,
    missing_count: 0,
    processed_count: 0,
    created_count: 0,
    skipped_count: 0,
    remaining_count: 0,
    failed_count: 0,
    invoiceIds: [],
    invoices: [],
    errors: []
  });
});

test('backfill keeps the 1–1000 bounds, default 250 and contribution scope', async () => {
  for (const [limit, expected] of [
    [undefined, 250],
    [0, 1],
    [-100, 1],
    [1, 1],
    [1000, 1000],
    [1001, 1000],
    [1.5, 250],
    [NaN, 250],
    [Infinity, 250]
  ]) {
    const calls = [];
    const pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [] };
      }
    };
    const result = await publicBackfill(pool, {
      limit,
      contributionId: 'synthetic-scope'
    });
    assert.deepEqual(
      calls.map(({ values }) => values),
      [['synthetic-scope'], [expected, 'synthetic-scope']]
    );
    assert.equal(result.processed_count, 0);
  }
  const calls = [];
  await publicBackfill({
    query: async (_sql, values) => {
      calls.push(values);
      return { rows: [] };
    }
  });
  assert.deepEqual(calls, [[null], [250, null]]);
});

test('backfill continues after null results and errors while preserving all counters and issued IDs', async () => {
  const candidates = [
    'first',
    'absent',
    'error',
    'unknown',
    'last',
    'unreadable'
  ].map(candidate);
  const writes = [];
  const reads = [];
  const pool = {
    query: async (sql, values) => {
      if (sql.includes('COUNT(contribution.id)')) {
        return { rows: [{ eligible_count: '10', missing_count: '8' }] };
      }
      if (sql.includes('invoice.id IS NULL') && sql.includes('LIMIT $1')) {
        return { rows: candidates };
      }
      if (sql.includes('INSERT INTO sponsorship_invoices')) {
        writes.push(values);
        const id = values[0].replace('cs_test_backfill_', '');
        if (id === 'absent') return { rows: [] };
        if (id === 'error') throw new Error('Synthetic transient failure');
        if (id === 'unknown') throw 'synthetic non-Error failure';
        return { rows: [invoiceRow(id)] };
      }
      if (sql.includes('FROM sponsorship_credit_notes')) return { rows: [] };
      if (sql.includes('FROM sponsorship_invoices invoice')) {
        reads.push(values[0]);
        return {
          rows:
            values[0] === 'invoice-unreadable'
              ? []
              : [invoiceRow(values[0].replace('invoice-', ''))]
        };
      }
      throw new Error('Unexpected backfill query');
    }
  };
  const result = await publicBackfill(pool, { limit: 6 });
  assert.deepEqual(
    writes.map((values) => values[0]),
    candidates.map((item) => item.stripe_session_id)
  );
  assert.equal(JSON.parse(writes[0][11])[0].totalCents, 25000);
  assert.deepEqual(reads, [
    'invoice-first',
    'invoice-last',
    'invoice-unreadable'
  ]);
  assert.deepEqual(result.invoiceIds, reads);
  assert.deepEqual(
    result.invoices.map((invoice) => invoice.id),
    ['invoice-first', 'invoice-last']
  );
  assert.equal(result.invoices[0].invoice_number, 'HISTORICAL-first');
  assert.equal(result.eligible_count, 10);
  assert.equal(result.missing_count, 8);
  assert.equal(result.processed_count, 6);
  assert.equal(result.created_count, 3);
  assert.equal(result.skipped_count, 2);
  assert.equal(result.remaining_count, 2);
  assert.equal(result.failed_count, 3);
  assert.deepEqual(result.errors, [
    {
      contribution_id: 'absent',
      stripe_session_id: 'cs_test_backfill_absent',
      error: 'No sponsorship invoice was created.'
    },
    {
      contribution_id: 'error',
      stripe_session_id: 'cs_test_backfill_error',
      error: 'Synthetic transient failure'
    },
    {
      contribution_id: 'unknown',
      stripe_session_id: 'cs_test_backfill_unknown',
      error: 'Unknown sponsorship invoice error.'
    }
  ]);
});

test('count, candidate and administrative read failures remain visible to the caller', async () => {
  for (const failure of ['count', 'candidate', 'read']) {
    const pool = {
      query: async (sql) => {
        if (sql.includes('COUNT(contribution.id)')) {
          if (failure === 'count') throw new Error('Synthetic count failure');
          return { rows: [{ eligible_count: '1', missing_count: '1' }] };
        }
        if (sql.includes('invoice.id IS NULL') && sql.includes('LIMIT $1')) {
          if (failure === 'candidate')
            throw new Error('Synthetic candidate failure');
          return { rows: [candidate('first')] };
        }
        if (sql.includes('INSERT INTO sponsorship_invoices'))
          return { rows: [invoiceRow('first')] };
        throw new Error('Synthetic read failure');
      }
    };
    await assert.rejects(
      publicBackfill(pool),
      new RegExp(`Synthetic ${failure} failure`)
    );
  }
});
