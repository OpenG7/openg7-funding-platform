import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAdminSponsorshipInvoiceById,
  listAdminSponsorshipInvoices
} from '../dist/apps/funding-api/src/sponsorship-documents/invoices.read.js';

const invoiceRow = {
  id: 'synthetic-invoice-a',
  contribution_id: 'synthetic-contribution',
  invoice_number: 'ARCHIVE-2025-007',
  public_reference: 'ARCHIVED-REFERENCE',
  stripe_session_id: 'cs_test_archived',
  stripe_payment_intent_id: 'pi_test_archived',
  issued_at: '2025-12-01 12:00:00+00',
  paid_at: '2025-12-01 11:00:00+00',
  currency: 'usd',
  subtotal_cents: '12000',
  tax_cents: '345',
  total_cents: '12345',
  tax_label: 'Archived tax',
  issuer_name: 'Archived issuer',
  issuer_email: null,
  issuer_address: null,
  issuer_tax_id: null,
  sponsor_name: 'Synthetic archived sponsor',
  sponsor_contact_name: null,
  sponsor_contact_email: 'sponsor@example.test',
  sponsor_website_url: null,
  line_items: [
    {
      description: 'Archived benefit',
      quantity: 1,
      unitAmountCents: 12000,
      totalCents: 12000
    }
  ],
  notes: 'Archived agreement note',
  last_email_status: 'failed',
  last_email_recipient: 'corrected@example.test',
  last_email_sent_at: null,
  last_email_error: 'Synthetic latest delivery failure'
};
const summaryRow = {
  total_count: '310',
  total_amount: '3826950',
  credit_note_count: '17',
  total_credited: '4567',
  failed_email_count: '5',
  currency: 'usd',
  last_updated_at: '2026-01-02 14:00:00+00'
};
const globalSummary = {
  total_count: 310,
  total_amount: 38269.5,
  credit_note_count: 17,
  total_credited: 45.67,
  failed_email_count: 5,
  currency: 'USD'
};
const emptySummary = {
  total_count: 0,
  total_amount: 0,
  credit_note_count: 0,
  total_credited: 0,
  failed_email_count: 0,
  currency: 'CAD'
};

const queryKind = (sql) =>
  sql.includes('WITH latest_email AS')
    ? 'summary'
    : sql.includes('FROM sponsorship_credit_notes')
      ? 'credits'
      : 'invoices';

test('invoice listings without a pool keep the empty database response and current timestamp', async () => {
  const startedAt = Date.now();
  const result = await listAdminSponsorshipInvoices(
    null,
    'synthetic-contribution'
  );
  const finishedAt = Date.now();

  assert.deepEqual(result.invoices, []);
  assert.deepEqual(result.summary, emptySummary);
  assert.equal(result.data_source, 'database');
  assert.ok(Date.parse(result.last_updated_at) >= startedAt);
  assert.ok(Date.parse(result.last_updated_at) <= finishedAt);
});

test('invoice filters affect the bounded list while its financial and email summary stays global', async () => {
  for (const contributionId of [undefined, 'synthetic-contribution', '']) {
    const calls = [];
    const pool = {
      async query(sql, params) {
        const kind = queryKind(sql);
        calls.push({ kind, sql, params });
        return {
          rows:
            kind === 'summary'
              ? [summaryRow]
              : kind === 'invoices'
                ? [invoiceRow]
                : []
        };
      }
    };

    const result = await listAdminSponsorshipInvoices(pool, contributionId);
    assert.deepEqual(result.summary, globalSummary);
    assert.equal(result.invoices.length, 1);
    assert.equal(result.last_updated_at, summaryRow.last_updated_at);
    assert.deepEqual(
      calls.map(({ kind }) => kind),
      ['invoices', 'summary', 'credits']
    );
    const [invoiceCall, summaryCall, creditCall] = calls;
    assert.deepEqual(invoiceCall.params, [contributionId ?? null]);
    assert.match(
      invoiceCall.sql,
      /WHERE \(\$1::text IS NULL OR invoice\.contribution_id::text = \$1\)/
    );
    assert.match(
      invoiceCall.sql,
      /ORDER BY invoice\.issued_at DESC, invoice\.created_at DESC\s+LIMIT 250/
    );
    assert.equal(summaryCall.params, undefined);
    assert.doesNotMatch(summaryCall.sql, /\$1|LIMIT 250/);
    assert.match(summaryCall.sql, /DISTINCT ON \(metadata->>'invoiceId'\)/);
    assert.match(summaryCall.sql, /DISTINCT ON \(metadata->>'creditNoteId'\)/);
    assert.match(
      summaryCall.sql,
      /invoice_totals\.failed_invoice_email_count \+\s+credit_note_totals\.failed_credit_note_email_count/
    );
    assert.deepEqual(creditCall.params, [[invoiceRow.id]]);
  }
});

test('invoice lists retain snapshot and latest email projections, invoice order and distinct partial refund groups', async () => {
  const secondInvoiceRow = {
    ...invoiceRow,
    id: 'synthetic-invoice-b',
    invoice_number: 'ARCHIVE-2025-008',
    last_email_status: 'sent',
    last_email_sent_at: '2026-01-01 12:00:00+00',
    last_email_error: null
  };
  const credits = [
    {
      ...invoiceRow,
      id: 'synthetic-credit-b',
      invoice_id: secondInvoiceRow.id,
      credit_note_number: 'ARCHIVE-CREDIT-003',
      stripe_refund_id: 're_test_partial_b',
      total_cents: '2100'
    },
    {
      ...invoiceRow,
      id: 'synthetic-credit-a2',
      invoice_id: invoiceRow.id,
      credit_note_number: 'ARCHIVE-CREDIT-002',
      stripe_refund_id: 're_test_partial_a2',
      total_cents: '1600'
    },
    {
      ...invoiceRow,
      id: 'synthetic-credit-a1',
      invoice_id: invoiceRow.id,
      credit_note_number: 'ARCHIVE-CREDIT-001',
      stripe_refund_id: 're_test_partial_a1',
      total_cents: '867'
    }
  ];
  const pool = {
    async query(sql, params) {
      switch (queryKind(sql)) {
        case 'summary':
          return { rows: [summaryRow] };
        case 'credits':
          assert.deepEqual(params, [[secondInvoiceRow.id, invoiceRow.id]]);
          return { rows: credits };
        default:
          assert.match(sql, /template_key = 'sponsorship_invoice'/);
          assert.match(sql, /metadata->>'invoiceId' = invoice\.id::text/);
          assert.match(sql, /ORDER BY created_at DESC\s+LIMIT 1/);
          return { rows: [secondInvoiceRow, invoiceRow] };
      }
    }
  };

  const result = await listAdminSponsorshipInvoices(pool);
  const [second, first] = result.invoices;
  assert.deepEqual(
    result.invoices.map(({ id }) => id),
    [secondInvoiceRow.id, invoiceRow.id]
  );
  assert.deepEqual(
    first.credit_notes.map(({ stripe_refund_id, total }) => [
      stripe_refund_id,
      total
    ]),
    [
      ['re_test_partial_a2', 16],
      ['re_test_partial_a1', 8.67]
    ]
  );
  assert.deepEqual(
    second.credit_notes.map(({ stripe_refund_id, total }) => [
      stripe_refund_id,
      total
    ]),
    [['re_test_partial_b', 21]]
  );
  assert.equal(first.invoice_number, invoiceRow.invoice_number);
  assert.equal(first.issuer_name, invoiceRow.issuer_name);
  assert.equal(first.tax_label, invoiceRow.tax_label);
  assert.equal(first.total, 123.45);
  assert.equal(first.notes, invoiceRow.notes);
  assert.deepEqual(first.line_items, [
    {
      description: 'Archived benefit',
      quantity: 1,
      unit_amount: 120,
      total: 120
    }
  ]);
  assert.equal(first.last_email_status, 'failed');
  assert.equal(first.last_email_recipient, invoiceRow.last_email_recipient);
  assert.equal(first.last_email_error, invoiceRow.last_email_error);
  assert.equal(second.last_email_status, 'sent');
  assert.equal(second.last_email_sent_at, secondInvoiceRow.last_email_sent_at);
  assert.equal(second.last_email_error, null);
});

test('an empty filtered list still returns the global summary without loading credit notes', async () => {
  const kinds = [];
  const pool = {
    async query(sql) {
      const kind = queryKind(sql);
      kinds.push(kind);
      assert.notEqual(kind, 'credits');
      return { rows: kind === 'summary' ? [summaryRow] : [] };
    }
  };
  const result = await listAdminSponsorshipInvoices(
    pool,
    'synthetic-unmatched'
  );

  assert.deepEqual(result.invoices, []);
  assert.deepEqual(result.summary, globalSummary);
  assert.equal(result.last_updated_at, summaryRow.last_updated_at);
  assert.deepEqual(kinds, ['invoices', 'summary']);
});

test('an absent summary row keeps the empty summary and current timestamp', async () => {
  const startedAt = Date.now();
  const result = await listAdminSponsorshipInvoices({
    async query() {
      return { rows: [] };
    }
  });

  assert.deepEqual(result.invoices, []);
  assert.deepEqual(result.summary, emptySummary);
  assert.ok(Date.parse(result.last_updated_at) >= startedAt);
  assert.ok(Date.parse(result.last_updated_at) <= Date.now());
});

test('list, global summary and grouped credit failures propagate instead of returning partial success', async () => {
  for (const failingKind of ['invoices', 'summary', 'credits']) {
    const failure = new Error(`Synthetic ${failingKind} failure`);
    const kinds = [];
    const pool = {
      async query(sql) {
        const kind = queryKind(sql);
        kinds.push(kind);
        if (kind === failingKind) throw failure;
        return {
          rows:
            kind === 'summary'
              ? [summaryRow]
              : kind === 'invoices'
                ? [invoiceRow]
                : []
        };
      }
    };

    await assert.rejects(
      listAdminSponsorshipInvoices(pool),
      (error) => error === failure
    );
    if (failingKind !== 'credits') assert.ok(!kinds.includes('credits'));
  }
});

test('admin invoice lookup propagates a grouped credit failure after finding its invoice', async () => {
  const failure = new Error('Synthetic credit grouping failure');
  const pool = {
    async query(sql) {
      if (queryKind(sql) === 'credits') throw failure;
      return { rows: [invoiceRow] };
    }
  };

  await assert.rejects(
    getAdminSponsorshipInvoiceById(pool, invoiceRow.id),
    (error) => error === failure
  );
});
