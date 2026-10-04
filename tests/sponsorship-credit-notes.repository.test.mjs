import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FUNDING_SPONSORSHIP_INVOICE_PREFIX = 'OG7-CMD';
process.env.FUNDING_SPONSORSHIP_CREDIT_NOTE_PREFIX = 'OG7-AV';
process.env.FUNDING_SPONSORSHIP_CREDIT_NOTE_LEGAL_NOTE =
  'Synthetic current wording';

const { createSponsorshipCreditNoteForRefund } =
  await import('../dist/apps/funding-api/src/sponsorship-invoices.repository.js');
const { listAdminSponsorshipCreditNotesForInvoices } =
  await import('../dist/apps/funding-api/src/sponsorship-documents/credit-notes.repository.js');

const input = {
  contributionId: 'synthetic-contribution',
  stripeRefundId: 're_first',
  refundAmountCents: 20000
};
const creditRow = {
  id: 'synthetic-credit',
  invoice_id: 'synthetic-invoice',
  contribution_id: input.contributionId,
  invoice_number: 'HISTORICAL-INVOICE',
  credit_note_number: 'HISTORICAL-CREDIT',
  public_reference: 'OG7-2020-HISTORICAL',
  stripe_refund_id: input.stripeRefundId,
  stripe_payment_intent_id: 'pi_historical',
  issued_at: '2020-01-01 00:00:00+00',
  currency: 'usd',
  subtotal_cents: '12345',
  tax_cents: '67',
  total_cents: '12412',
  tax_label: 'Historical tax',
  issuer_name: 'Historical issuer',
  issuer_email: 'issuer@example.test',
  issuer_address: 'Synthetic historical address',
  issuer_tax_id: 'SYNTHETIC-TAX',
  sponsor_name: 'Historical company',
  sponsor_contact_name: 'Synthetic contact',
  sponsor_contact_email: 'contact@example.test',
  sponsor_website_url: 'https://example.test',
  line_items: [
    {
      description: 'Historical line',
      quantity: 1,
      unitAmountCents: 12412,
      totalCents: 12412
    }
  ],
  notes: 'Historical wording',
  last_email_status: 'failed',
  last_email_recipient: 'corrected@example.test',
  last_email_sent_at: null,
  last_email_error: 'Synthetic delivery failure'
};

test('credit note creation returns null without persistence or an issued invoice', async () => {
  assert.equal(await createSponsorshipCreditNoteForRefund(null, input), null);
  const calls = [];
  assert.equal(
    await createSponsorshipCreditNoteForRefund(
      {
        async query(sql, params) {
          calls.push({ sql, params });
          return { rows: [] };
        }
      },
      input
    ),
    null
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM sponsorship_invoices/);
  assert.deepEqual(calls[0].params, [input.contributionId]);
});

test('credit note creation keeps numbering and partial/full refund parameters stable', async () => {
  for (const [invoiceNumber, refundId, amount, expectedNumber, description] of [
    [
      'OG7-CMD-2026-UNIT',
      're_first',
      20000,
      'OG7-AV-2026-UNIT-19218DF3DFB9F055',
      'Avoir - remboursement partiel de la commandite OpenG7'
    ],
    [
      'OG7-CMD-2026-UNIT',
      're_second',
      50000,
      'OG7-AV-2026-UNIT-20BCADAF094A2CE0',
      'Avoir - remboursement complet de la commandite OpenG7'
    ],
    [
      'CUSTOM-2026-UNIT',
      're_first',
      20000,
      'OG7-AV-F270394B685C1C0D',
      'Avoir - remboursement partiel de la commandite OpenG7'
    ]
  ]) {
    const calls = [];
    const result = await createSponsorshipCreditNoteForRefund(
      {
        async query(sql, params) {
          calls.push({ sql, params });
          return {
            rows:
              calls.length === 1
                ? [{ invoice_number: invoiceNumber, total_cents: '50000' }]
                : []
          };
        }
      },
      { ...input, stripeRefundId: refundId, refundAmountCents: amount }
    );
    assert.equal(
      result,
      null,
      'a vanished invoice leaves no issued credit note'
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params, [input.contributionId]);
    assert.match(
      calls[1].sql,
      /ON CONFLICT \(stripe_refund_id\) DO UPDATE\s+SET\s+updated_at = NOW\(\)\s+RETURNING/
    );
    assert.deepEqual(calls[1].params, [
      input.contributionId,
      expectedNumber,
      refundId,
      amount,
      JSON.stringify([
        {
          description,
          quantity: 1,
          unitAmountCents: amount,
          totalCents: amount
        }
      ]),
      'Synthetic current wording'
    ]);
  }
});

test('a retry returns the historical persisted credit note snapshot', async () => {
  let calls = 0;
  const note = await createSponsorshipCreditNoteForRefund(
    {
      async query() {
        calls += 1;
        return {
          rows:
            calls === 1
              ? [{ invoice_number: 'OG7-CMD-2026-UNIT', total_cents: '50000' }]
              : [creditRow]
        };
      }
    },
    input
  );
  assert.equal(calls, 2);
  assert.equal(note.creditNoteNumber, 'HISTORICAL-CREDIT');
  assert.equal(note.invoiceNumber, 'HISTORICAL-INVOICE');
  assert.equal(note.currency, 'USD');
  assert.equal(note.subtotalCents, 12345);
  assert.equal(note.taxCents, 67);
  assert.equal(note.totalCents, 12412);
  assert.equal(note.issuerName, 'Historical issuer');
  assert.equal(note.sponsorName, 'Historical company');
  assert.equal(note.notes, 'Historical wording');
  assert.deepEqual(note.lineItems, creditRow.line_items);
});

test('invoice lookup and credit note insertion failures propagate without retries', async () => {
  for (const failAt of [1, 2]) {
    const failure = new Error(`Synthetic query ${failAt} failure`);
    let calls = 0;
    await assert.rejects(
      createSponsorshipCreditNoteForRefund(
        {
          async query() {
            calls += 1;
            if (calls === failAt) throw failure;
            return {
              rows: [
                { invoice_number: 'OG7-CMD-2026-UNIT', total_cents: '50000' }
              ]
            };
          }
        },
        input
      ),
      (error) => error === failure
    );
    assert.equal(calls, failAt);
  }
});

test('credit note grouping preserves invoice identity, query order and email projection', async () => {
  const second = {
    ...creditRow,
    id: 'synthetic-second-credit',
    stripe_refund_id: 're_second',
    credit_note_number: 'HISTORICAL-SECOND-CREDIT',
    last_email_status: 'sent',
    last_email_error: null
  };
  const other = {
    ...creditRow,
    id: 'synthetic-other-credit',
    invoice_id: 'synthetic-other-invoice'
  };
  let queries = 0;
  const grouped = await listAdminSponsorshipCreditNotesForInvoices(
    {
      async query(sql, params) {
        queries += 1;
        assert.deepEqual(params, [[creditRow.invoice_id, other.invoice_id]]);
        assert.match(
          sql,
          /WHERE credit_note\.invoice_id = ANY\(\$1::uuid\[\]\)/
        );
        assert.match(
          sql,
          /ORDER BY credit_note\.issued_at DESC, credit_note\.created_at DESC/
        );
        return { rows: [second, other, creditRow] };
      }
    },
    [creditRow.invoice_id, other.invoice_id]
  );
  assert.equal(queries, 1);
  assert.deepEqual(
    grouped.get(creditRow.invoice_id).map((note) => note.stripe_refund_id),
    ['re_second', 're_first']
  );
  assert.equal(grouped.get(other.invoice_id)[0].id, other.id);
  assert.equal(grouped.get('missing-invoice'), undefined);
  const historical = grouped.get(creditRow.invoice_id)[1];
  assert.equal(historical.credit_note_number, 'HISTORICAL-CREDIT');
  assert.equal(historical.total, 124.12);
  assert.equal(historical.last_email_status, 'failed');
  assert.equal(historical.last_email_recipient, 'corrected@example.test');
  assert.equal(historical.last_email_error, 'Synthetic delivery failure');
});

test('credit note grouping skips empty identities and propagates persistence failures', async () => {
  assert.deepEqual(
    await listAdminSponsorshipCreditNotesForInvoices(
      { query: () => assert.fail('empty invoice list must not query') },
      []
    ),
    new Map()
  );
  assert.deepEqual(
    await listAdminSponsorshipCreditNotesForInvoices(
      { query: async () => ({ rows: [] }) },
      ['missing-invoice']
    ),
    new Map()
  );
  const failure = new Error('Synthetic grouped credit query failure');
  await assert.rejects(
    listAdminSponsorshipCreditNotesForInvoices(
      {
        query: async () => {
          throw failure;
        }
      },
      [creditRow.invoice_id]
    ),
    (error) => error === failure
  );
});
