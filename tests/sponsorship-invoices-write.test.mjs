import assert from 'node:assert/strict';
import test from 'node:test';

import { createSponsorshipInvoiceForStripeSession as publicCreate } from '../dist/apps/funding-api/src/sponsorship-invoices.repository.js';
import { createSponsorshipInvoiceForStripeSession } from '../dist/apps/funding-api/src/sponsorship-documents/invoices.write.js';
import { sponsorshipInvoiceConfig } from '../dist/apps/funding-api/src/sponsorship-invoice-config.js';

const frozenOffer = {
  version: 'sponsorship-v1',
  amountMinor: 50000,
  currency: 'CAD',
  benefits: [
    ['website_mention', 'website'],
    ['facebook_batch', 'facebook'],
    ['linkedin_batch', 'linkedin']
  ].map(([id, channel]) => ({
    id,
    channel,
    target: 'openg7',
    quantity: 1,
    requiredElements: ['company_name', 'approved_presentation'],
    deadlineDays: null,
    durationDays: null
  }))
};
// These query fixtures stand in for a caller-owned transaction. Financial and
// commercial snapshots are read under the contribution lock before issuance.
const emit = (pool, request) =>
  publicCreate(
    pool
      ? {
          release() {},
          query: (sql, values) =>
            sql.startsWith('SELECT amount_cents::text')
              ? Promise.resolve({ rows: [{ amount_cents: '50000' }] })
              : sql.includes('SELECT o.snapshot')
                ? Promise.resolve({ rows: [{ snapshot: frozenOffer }] })
                : pool.query(sql, values)
        }
      : null,
    request
  );

const input = (overrides = {}) => ({
  stripeSessionId: 'cs_test_invoice_write',
  stripePaymentIntentId: null,
  publicReference: 'OG7-2026-ABCD-EFGH',
  amountCents: 50000,
  currency: 'cad',
  paidAtIso: '2026-12-31T23:30:00-05:00',
  customerEmail: 'sponsor@example.invalid',
  ...overrides
});

const storedInvoice = {
  id: '11111111-1111-4111-8111-111111111111',
  contribution_id: '22222222-2222-4222-8222-222222222222',
  invoice_number: 'LEGACY-CMD-2020-001',
  public_reference: 'OG7-2020-ORIGINAL',
  stripe_session_id: 'cs_test_invoice_write',
  stripe_payment_intent_id: 'pi_test_original',
  issued_at: '2020-01-01T12:00:00.000Z',
  paid_at: '2020-01-01T11:00:00.000Z',
  currency: 'cad',
  subtotal_cents: '12345',
  tax_cents: '0',
  total_cents: '12345',
  tax_label: 'Historical tax label',
  issuer_name: 'Historical issuer',
  issuer_email: 'issuer@example.invalid',
  issuer_address: null,
  issuer_tax_id: null,
  sponsor_name: 'Historical sponsor',
  sponsor_contact_name: null,
  sponsor_contact_email: null,
  sponsor_website_url: null,
  line_items: [
    {
      description: 'Historical line',
      quantity: 1,
      unitAmountCents: 12345,
      totalCents: 12345
    }
  ],
  notes: 'Historical benefits and legal note'
};

test('invoice creation remains the public owning function and returns null without a database', async () => {
  assert.equal(publicCreate, createSponsorshipInvoiceForStripeSession);
  assert.equal(await emit(null, input()), null);
});

test('invoice numbering preserves public-reference suffixes and uses the payment UTC year', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [] };
    }
  };
  assert.equal(await emit(pool, input()), null);
  assert.equal(
    calls[0].values[1],
    `${sponsorshipInvoiceConfig.invoicePrefix}-2027-ABCDEFGH`
  );
  assert.deepEqual(calls[0].values.slice(0, 5), [
    'cs_test_invoice_write',
    `${sponsorshipInvoiceConfig.invoicePrefix}-2027-ABCDEFGH`,
    'OG7-2026-ABCD-EFGH',
    null,
    '2026-12-31T23:30:00-05:00'
  ]);
  assert.deepEqual(JSON.parse(calls[0].values[11]), [
    {
      description: 'Commandite de visibilite OpenG7 - Fonds des batisseurs',
      quantity: 1,
      unitAmountCents: 50000,
      totalCents: 50000
    }
  ]);
  assert.match(calls[0].values[12], /OpenG7\.org/);
  assert.match(calls[0].values[12], /Facebook/);
  assert.match(calls[0].values[12], /LinkedIn/);
  assert.match(calls[0].values[12], /Aucune publication/);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].values, [input().stripeSessionId]);
});

test('missing public reference uses the same session hash through a failed emission and retry', async () => {
  const numbers = [];
  const pool = {
    query: async (_sql, values) => {
      numbers.push(values[1]);
      if (numbers.length === 1) throw new Error('Synthetic database failure');
      return { rows: [storedInvoice] };
    }
  };
  const request = input({ publicReference: null });
  await assert.rejects(emit(pool, request), /Synthetic database failure/);
  const invoice = await emit(pool, request);
  assert.deepEqual(numbers, [
    `${sponsorshipInvoiceConfig.invoicePrefix}-2027-7E6310F5`,
    `${sponsorshipInvoiceConfig.invoicePrefix}-2027-7E6310F5`
  ]);
  assert.equal(invoice.id, storedInvoice.id);
});

test('creation returns the persisted historical snapshot after a replay with different inputs', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: calls.length === 1 ? [] : [storedInvoice] };
    }
  };
  const invoice = await emit(
    pool,
    input({ amountCents: 90000, publicReference: 'OG7-2026-REPLAY' })
  );
  assert.equal(invoice.invoiceNumber, 'LEGACY-CMD-2020-001');
  assert.equal(invoice.publicReference, 'OG7-2020-ORIGINAL');
  assert.equal(invoice.totalCents, 12345);
  assert.equal(invoice.issuedAtIso, '2020-01-01T12:00:00.000Z');
  assert.equal(invoice.issuerName, 'Historical issuer');
  assert.deepEqual(invoice.lineItems, storedInvoice.line_items);
  assert.equal(invoice.notes, 'Historical benefits and legal note');
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /ON CONFLICT \(contribution_id\) DO NOTHING/);
  assert.doesNotMatch(calls[0].sql, /DO UPDATE|UNION/);
  assert.match(calls[1].sql, /FROM sponsorship_invoices invoice/);
  assert.deepEqual(calls[1].values, ['cs_test_invoice_write']);
});

test('a successful first emission returns its stored snapshot without another read', async () => {
  const calls = [];
  const invoice = await emit(
    {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [storedInvoice] };
      }
    },
    input()
  );
  assert.equal(calls.length, 1);
  assert.equal(invoice.invoiceNumber, storedInvoice.invoice_number);
});

test('replay keeps missing values and the issued placeholder even if the new input fills them', async () => {
  const incompleteSnapshot = {
    ...storedInvoice,
    public_reference: null,
    stripe_payment_intent_id: null,
    paid_at: null,
    sponsor_name: 'Commanditaire a confirmer'
  };
  let calls = 0;
  const invoice = await emit(
    {
      query: async () => ({ rows: ++calls === 1 ? [] : [incompleteSnapshot] })
    },
    input({
      publicReference: 'OG7-2026-NEW-REFERENCE',
      stripePaymentIntentId: 'pi_test_new',
      customerEmail: 'new-contact@example.invalid'
    })
  );
  assert.equal(invoice.publicReference, null);
  assert.equal(invoice.stripePaymentIntentId, null);
  assert.equal(invoice.paidAtIso, null);
  assert.equal(invoice.sponsorName, 'Commanditaire a confirmer');
  assert.equal(invoice.sponsorContactName, null);
  assert.equal(invoice.sponsorContactEmail, null);
  assert.equal(invoice.sponsorWebsiteUrl, null);
  assert.equal(invoice.issuerAddress, null);
  assert.equal(invoice.issuerTaxId, null);
});

test('a failed read after conflict propagates the failure instead of reporting no invoice', async () => {
  let calls = 0;
  await assert.rejects(
    emit(
      {
        query: async () => {
          if (++calls === 1) return { rows: [] };
          throw new Error('Synthetic snapshot read failure');
        }
      },
      input()
    ),
    /Synthetic snapshot read failure/
  );
  assert.equal(calls, 2);
});

test('issuance owns one transaction and reads monetary and accepted-offer snapshots after locking the dossier', async () => {
  const queries = [];
  let released = 0;
  const client = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT amount_cents::text'))
        return { rows: [{ amount_cents: '12345' }] };
      if (sql.includes('SELECT o.snapshot'))
        return { rows: [{ snapshot: frozenOffer }] };
      if (sql.includes('INSERT INTO sponsorship_invoices')) {
        assert.equal(JSON.parse(values[11])[0].totalCents, 12345);
        assert.match(values[12], /Facebook/);
        return { rows: [storedInvoice] };
      }
      return { rows: [] };
    },
    release: () => {
      released++;
    }
  };
  const invoice = await publicCreate(
    {
      connect: async () => client,
      query: () => {
        throw new Error('Snapshot escaped its transaction');
      }
    },
    input({ amountCents: 90000 })
  );
  assert.equal(invoice.id, storedInvoice.id);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /FOR UPDATE/);
  assert.match(queries[2].sql, /SELECT o.snapshot/);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(released, 1);
});

test('a snapshot or emission failure rolls back and releases the owned client', async () => {
  for (const failAt of [
    'SELECT o.snapshot',
    'INSERT INTO sponsorship_invoices'
  ]) {
    const commands = [];
    let released = 0;
    const failure = new Error('Synthetic issuance snapshot failure');
    const client = {
      query: async (sql) => {
        commands.push(sql);
        if (sql.includes(failAt)) throw failure;
        if (sql.startsWith('SELECT amount_cents::text'))
          return { rows: [{ amount_cents: '50000' }] };
        if (sql.includes('SELECT o.snapshot'))
          return { rows: [{ snapshot: frozenOffer }] };
        return { rows: [] };
      },
      release: () => {
        released++;
      }
    };
    await assert.rejects(
      publicCreate({ connect: async () => client }, input()),
      (error) => error === failure
    );
    assert.equal(commands.at(-1), 'ROLLBACK');
    assert.equal(commands.includes('COMMIT'), false);
    assert.equal(released, 1);
  }
});

test('a historical invoice remains retrievable when the dossier no longer permits a new issuance', async () => {
  const commands = [];
  const client = {
    release() {},
    query: async (sql) => {
      commands.push(sql);
      if (sql.includes('FROM sponsorship_invoices invoice'))
        return { rows: [storedInvoice] };
      return { rows: [] };
    }
  };
  const invoice = await publicCreate(client, input());
  assert.equal(invoice.id, storedInvoice.id);
  assert.equal(invoice.notes, storedInvoice.notes);
  assert.equal(commands.length, 2);
  assert.equal(
    commands.some(
      (sql) =>
        sql.includes('INSERT INTO sponsorship_invoices') ||
        sql.includes('SELECT o.snapshot')
    ),
    false
  );
});
