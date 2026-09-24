import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderSponsorshipInvoicePdf,
  renderSponsorshipCreditNotePdf
} from '../dist/apps/funding-api/src/sponsorship-document-pdf.service.js';

test('issued financial PDFs retain identical bytes when downloaded on another date', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 8, 23) });
  const invoice = {
    id: '10000000-0000-4000-8000-000000000701',
    contributionId: '10000000-0000-4000-8000-000000000702',
    invoiceNumber: 'INV-SYNTHETIC',
    publicReference: 'OG7-TEST',
    stripeSessionId: 'cs_test_document',
    stripePaymentIntentId: null,
    issuedAtIso: '2026-09-01T12:00:00.000Z',
    paidAtIso: '2026-09-01T12:00:00.000Z',
    currency: 'CAD',
    subtotalCents: 50000,
    taxCents: 0,
    totalCents: 50000,
    taxLabel: '',
    issuerName: 'OpenG7 test',
    issuerEmail: null,
    issuerAddress: null,
    issuerTaxId: null,
    sponsorName: 'Entreprise synthétique',
    sponsorContactName: 'Contact synthétique',
    sponsorContactEmail: 'original@example.test',
    sponsorWebsiteUrl: null,
    lineItems: [
      {
        description: 'Commandite synthétique',
        quantity: 1,
        unitAmountCents: 50000,
        totalCents: 50000
      }
    ],
    notes: null
  };
  const note = {
    ...invoice,
    id: '10000000-0000-4000-8000-000000000703',
    invoiceId: invoice.id,
    creditNoteNumber: 'CN-SYNTHETIC',
    stripeRefundId: 're_test_document'
  };
  for (const [render, input] of [
    [renderSponsorshipInvoicePdf, invoice],
    [renderSponsorshipCreditNotePdf, note]
  ]) {
    const first = await render(input);
    t.mock.timers.tick(86400000);
    assert.deepEqual(await render(input), first);
    assert.ok(first.includes(Buffer.from('D:20260901120000Z')));
    assert.notDeepEqual(
      await render({ ...input, notes: 'Document distinct pour le test.' }),
      first
    );
  }
});
