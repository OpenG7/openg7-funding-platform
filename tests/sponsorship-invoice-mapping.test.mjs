import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapAdminSponsorshipCreditNoteRow,
  mapAdminSponsorshipInvoiceRow,
  mapSponsorshipCreditNoteRow,
  mapSponsorshipInvoiceRow
} from '../dist/apps/funding-api/src/sponsorship-invoice.mapping.js';
import {
  getAdminSponsorshipCreditNoteById,
  getAdminSponsorshipInvoiceById,
  getSponsorshipCreditNoteById,
  getSponsorshipInvoiceById,
  listAdminSponsorshipInvoices
} from '../dist/apps/funding-api/src/sponsorship-invoices.repository.js';

// Synthetic persisted snapshots deliberately differ from current issuer/pricing
// settings. The adapter must project them without recomputing their contents.
const lineItems = [
  {
    description: 'Historical sponsorship agreement',
    quantity: 2,
    unitAmountCents: 6000,
    totalCents: 12345
  }
];
const documentRow = {
  id: 'synthetic-invoice',
  contribution_id: 'synthetic-contribution',
  invoice_number: 'HISTORICAL-2025-001',
  public_reference: null,
  stripe_payment_intent_id: null,
  issued_at: '2025-12-01 16:30:00+00',
  currency: 'usd',
  subtotal_cents: '12345',
  tax_cents: '789',
  total_cents: '13134',
  tax_label: 'Historical tax label',
  issuer_name: 'Historical issuer',
  issuer_email: 'issuer@example.test',
  issuer_address: 'Synthetic historical address',
  issuer_tax_id: null,
  sponsor_name: 'Synthetic sponsor',
  sponsor_contact_name: null,
  sponsor_contact_email: 'sponsor@example.test',
  sponsor_website_url: null,
  line_items: lineItems,
  notes: 'Historical benefits and legal note',
  tracking_token: 'synthetic-private-field',
  metadata: { extra: 'excluded from document contracts' }
};
const invoiceRow = {
  ...documentRow,
  stripe_session_id: 'cs_test_snapshot',
  paid_at: null
};
const creditRow = {
  ...documentRow,
  id: 'synthetic-credit',
  invoice_id: 'synthetic-invoice',
  credit_note_number: 'HISTORICAL-CREDIT-001',
  stripe_refund_id: 're_test_snapshot'
};
const emailRow = {
  last_email_status: 'failed',
  last_email_recipient: 'corrected@example.test',
  last_email_sent_at: null,
  last_email_error: 'Synthetic delivery failure'
};
const persistedDocument = {
  id: 'synthetic-invoice',
  contributionId: 'synthetic-contribution',
  invoiceNumber: 'HISTORICAL-2025-001',
  publicReference: null,
  stripePaymentIntentId: null,
  issuedAtIso: '2025-12-01 16:30:00+00',
  currency: 'USD',
  subtotalCents: 12345,
  taxCents: 789,
  totalCents: 13134,
  taxLabel: 'Historical tax label',
  issuerName: 'Historical issuer',
  issuerEmail: 'issuer@example.test',
  issuerAddress: 'Synthetic historical address',
  issuerTaxId: null,
  sponsorName: 'Synthetic sponsor',
  sponsorContactName: null,
  sponsorContactEmail: 'sponsor@example.test',
  sponsorWebsiteUrl: null,
  lineItems,
  notes: 'Historical benefits and legal note'
};
const invoice = {
  ...persistedDocument,
  stripeSessionId: 'cs_test_snapshot',
  paidAtIso: null
};
const credit = {
  ...persistedDocument,
  id: 'synthetic-credit',
  invoiceId: 'synthetic-invoice',
  creditNoteNumber: 'HISTORICAL-CREDIT-001',
  stripeRefundId: 're_test_snapshot'
};
const adminDocument = {
  id: 'synthetic-invoice',
  contribution_id: 'synthetic-contribution',
  invoice_number: 'HISTORICAL-2025-001',
  public_reference: null,
  stripe_payment_intent_id: null,
  issued_at: '2025-12-01 16:30:00+00',
  currency: 'USD',
  subtotal: 123.45,
  tax: 7.89,
  total: 131.34,
  tax_label: 'Historical tax label',
  issuer_name: 'Historical issuer',
  issuer_email: 'issuer@example.test',
  issuer_address: 'Synthetic historical address',
  issuer_tax_id: null,
  sponsor_name: 'Synthetic sponsor',
  sponsor_contact_name: null,
  sponsor_contact_email: 'sponsor@example.test',
  sponsor_website_url: null,
  line_items: [
    {
      description: 'Historical sponsorship agreement',
      quantity: 2,
      unit_amount: 60,
      total: 123.45
    }
  ],
  notes: 'Historical benefits and legal note',
  ...emailRow
};
const adminCredit = {
  ...adminDocument,
  id: 'synthetic-credit',
  invoice_id: 'synthetic-invoice',
  credit_note_number: 'HISTORICAL-CREDIT-001',
  stripe_refund_id: 're_test_snapshot'
};
const adminInvoice = {
  ...adminDocument,
  stripe_session_id: 'cs_test_snapshot',
  paid_at: null,
  credit_notes: []
};

test('invoice and credit note projections preserve issued snapshots in minor units', () => {
  const before = structuredClone([invoiceRow, creditRow]);
  assert.deepEqual(mapSponsorshipInvoiceRow(invoiceRow), invoice);
  assert.deepEqual(mapSponsorshipCreditNoteRow(creditRow), credit);
  assert.deepEqual([invoiceRow, creditRow], before, 'rows remain unchanged');
});

test('admin projections keep display amounts, email state and distinct document identities', () => {
  assert.deepEqual(
    mapAdminSponsorshipCreditNoteRow({ ...creditRow, ...emailRow }),
    adminCredit
  );
  assert.deepEqual(
    mapAdminSponsorshipInvoiceRow({ ...invoiceRow, ...emailRow }),
    adminInvoice
  );
  assert.deepEqual(
    mapAdminSponsorshipInvoiceRow({ ...invoiceRow, ...emailRow }, [
      adminCredit
    ]),
    { ...adminInvoice, credit_notes: [adminCredit] }
  );
});

test('all projections accept JSON text and parsed PostgreSQL line items consistently', () => {
  for (const raw of [lineItems, JSON.stringify(lineItems)]) {
    assert.deepEqual(
      mapSponsorshipInvoiceRow({ ...invoiceRow, line_items: raw }),
      invoice
    );
    assert.deepEqual(
      mapSponsorshipCreditNoteRow({ ...creditRow, line_items: raw }),
      credit
    );
    assert.deepEqual(
      mapAdminSponsorshipInvoiceRow({
        ...invoiceRow,
        ...emailRow,
        line_items: raw
      }),
      adminInvoice
    );
    assert.deepEqual(
      mapAdminSponsorshipCreditNoteRow({
        ...creditRow,
        ...emailRow,
        line_items: raw
      }),
      adminCredit
    );
  }
});

test('historical partial line items retain defaults and filter invalid entries', () => {
  const row = {
    ...invoiceRow,
    line_items: [
      null,
      false,
      42,
      'invalid',
      {},
      { description: '' },
      { description: 123 },
      { description: 'Fallbacks', quantity: '2', unitAmountCents: '100' },
      { description: 'Zero quantity', quantity: 0, totalCents: 7 }
    ]
  };
  assert.deepEqual(mapSponsorshipInvoiceRow(row).lineItems, [
    {
      description: 'Fallbacks',
      quantity: 1,
      unitAmountCents: 0,
      totalCents: 0
    },
    {
      description: 'Zero quantity',
      quantity: 0,
      unitAmountCents: 0,
      totalCents: 7
    }
  ]);
  assert.deepEqual(
    mapAdminSponsorshipInvoiceRow({ ...row, ...emailRow }).line_items,
    [
      { description: 'Fallbacks', quantity: 1, unit_amount: 0, total: 0 },
      { description: 'Zero quantity', quantity: 0, unit_amount: 0, total: 0.07 }
    ]
  );
});

test('invalid JSON or non-array line items still produce empty document items', () => {
  for (const raw of ['{broken', 'null', '{}', '42', null, undefined, {}, 42]) {
    assert.deepEqual(
      mapSponsorshipInvoiceRow({ ...invoiceRow, line_items: raw }).lineItems,
      []
    );
    assert.deepEqual(
      mapAdminSponsorshipCreditNoteRow({
        ...creditRow,
        ...emailRow,
        line_items: raw
      }).line_items,
      []
    );
  }
});

test('repository reads use the extracted projections and bind the requested identity', async () => {
  for (const [read, row, expected, table] of [
    [getSponsorshipInvoiceById, invoiceRow, invoice, 'sponsorship_invoices'],
    [
      getSponsorshipCreditNoteById,
      creditRow,
      credit,
      'sponsorship_credit_notes'
    ],
    [
      getAdminSponsorshipCreditNoteById,
      { ...creditRow, ...emailRow },
      adminCredit,
      'sponsorship_credit_notes'
    ]
  ]) {
    let queries = 0;
    const pool = {
      async query(sql, params) {
        queries += 1;
        assert.match(sql, /^\s*SELECT /);
        assert.ok(sql.includes(`FROM ${table}`));
        assert.deepEqual(params, [row.id]);
        return { rows: [row] };
      }
    };
    assert.deepEqual(await read(pool, row.id), expected);
    assert.equal(queries, 1);
  }
});

test('admin invoice reads attach its credit notes in query order without changing their refund identities', async () => {
  const secondCreditRow = {
    ...creditRow,
    ...emailRow,
    id: 'synthetic-credit-2',
    credit_note_number: 'HISTORICAL-CREDIT-002',
    stripe_refund_id: 're_test_snapshot_2'
  };
  const expectedCredits = [
    {
      ...adminCredit,
      id: 'synthetic-credit-2',
      credit_note_number: 'HISTORICAL-CREDIT-002',
      stripe_refund_id: 're_test_snapshot_2'
    },
    adminCredit
  ];
  const calls = [];
  const pool = {
    async query(sql, params) {
      assert.match(sql, /^\s*SELECT /);
      calls.push(params);
      return {
        rows: sql.includes('FROM sponsorship_credit_notes')
          ? [secondCreditRow, { ...creditRow, ...emailRow }]
          : [{ ...invoiceRow, ...emailRow }]
      };
    }
  };
  assert.deepEqual(await getAdminSponsorshipInvoiceById(pool, invoiceRow.id), {
    ...adminInvoice,
    credit_notes: expectedCredits
  });
  assert.deepEqual(calls, [[invoiceRow.id], [[invoiceRow.id]]]);
});

test('invoice listings group credits per invoice and preserve the summary units', async () => {
  const secondInvoiceRow = {
    ...invoiceRow,
    ...emailRow,
    id: 'synthetic-invoice-2'
  };
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push(params);
      if (sql.includes('WITH latest_email AS')) {
        return {
          rows: [
            {
              total_count: '2',
              total_amount: '26268',
              credit_note_count: '1',
              total_credited: '13134',
              failed_email_count: '3',
              currency: 'usd',
              last_updated_at: '2026-01-01 00:00:00+00'
            }
          ]
        };
      }
      assert.match(sql, /^\s*SELECT /);
      return {
        rows: sql.includes('FROM sponsorship_credit_notes')
          ? [{ ...creditRow, ...emailRow }]
          : [{ ...invoiceRow, ...emailRow }, secondInvoiceRow]
      };
    }
  };
  assert.deepEqual(
    await listAdminSponsorshipInvoices(pool, 'synthetic-filter'),
    {
      data_source: 'database',
      invoices: [
        { ...adminInvoice, credit_notes: [adminCredit] },
        { ...adminInvoice, id: 'synthetic-invoice-2' }
      ],
      summary: {
        total_count: 2,
        total_amount: 262.68,
        credit_note_count: 1,
        total_credited: 131.34,
        failed_email_count: 3,
        currency: 'USD'
      },
      last_updated_at: '2026-01-01 00:00:00+00'
    }
  );
  assert.deepEqual(calls, [
    ['synthetic-filter'],
    undefined,
    [[invoiceRow.id, secondInvoiceRow.id]]
  ]);
});

test('document lookups preserve null results and propagate query failures', async () => {
  for (const read of [
    getSponsorshipInvoiceById,
    getAdminSponsorshipInvoiceById,
    getSponsorshipCreditNoteById,
    getAdminSponsorshipCreditNoteById
  ]) {
    assert.equal(await read(null, 'missing'), null);
    let queries = 0;
    const emptyPool = {
      async query() {
        queries += 1;
        return { rows: [] };
      }
    };
    assert.equal(await read(emptyPool, 'missing'), null);
    assert.equal(queries, 1, 'missing invoice does not load its credit notes');
    const failure = new Error('Synthetic query failure');
    await assert.rejects(
      read(
        {
          async query() {
            throw failure;
          }
        },
        'synthetic-id'
      ),
      (error) => error === failure
    );
  }
});
