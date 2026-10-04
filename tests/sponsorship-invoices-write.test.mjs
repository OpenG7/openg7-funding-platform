import assert from 'node:assert/strict';
import test from 'node:test';

import { createSponsorshipInvoiceForStripeSession as publicCreate } from '../dist/apps/funding-api/src/sponsorship-invoices.repository.js';
import { createSponsorshipInvoiceForStripeSession } from '../dist/apps/funding-api/src/sponsorship-documents/invoices.write.js';
import { sponsorshipInvoiceConfig } from '../dist/apps/funding-api/src/sponsorship-invoice-config.js';

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
  assert.equal(await publicCreate(null, input()), null);
});

test('invoice numbering preserves public-reference suffixes and uses the payment UTC year', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [] };
    }
  };
  assert.equal(await publicCreate(pool, input()), null);
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
  await assert.rejects(
    publicCreate(pool, request),
    /Synthetic database failure/
  );
  const invoice = await publicCreate(pool, request);
  assert.deepEqual(numbers, [
    `${sponsorshipInvoiceConfig.invoicePrefix}-2027-7E6310F5`,
    `${sponsorshipInvoiceConfig.invoicePrefix}-2027-7E6310F5`
  ]);
  assert.equal(invoice.id, storedInvoice.id);
});

test('creation returns the persisted historical snapshot after a replay with different inputs', async () => {
  const pool = { query: async () => ({ rows: [storedInvoice] }) };
  const invoice = await publicCreate(
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
});
