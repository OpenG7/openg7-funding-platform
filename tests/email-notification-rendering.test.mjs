import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderAdminContributionReceivedEmail,
  renderContributionReferenceRecoveryEmail,
  renderSponsorshipAccessEmail,
  renderSponsorshipCreditNoteEmail,
  renderSponsorshipInformationRequestEmail,
  renderSponsorshipInvoiceEmail,
  renderSponsorshipRejectionEmail,
  renderSponsorshipRefundEmail,
  renderSponsorshipReviewReminderNotification
} from '../dist/apps/funding-api/src/services/email/index.js';

const createDocument = (overrides = {}) => ({
  id: 'synthetic-document',
  invoiceId: 'synthetic-invoice',
  contributionId: 'synthetic-contribution',
  invoiceNumber: 'INV-2026-001',
  creditNoteNumber: 'CREDIT-2026-001',
  publicReference: 'G7-<synthetic>',
  stripeSessionId: 'cs_synthetic',
  stripePaymentIntentId: null,
  stripeRefundId: 're_synthetic',
  issuedAtIso: '2026-09-01T12:00:00.000Z',
  paidAtIso: null,
  currency: 'cad',
  subtotalCents: 37550,
  taxCents: 0,
  totalCents: 37550,
  taxLabel: 'Taxes',
  issuerName: 'OpenG7 <synthetic>',
  issuerEmail: null,
  issuerAddress: null,
  issuerTaxId: null,
  sponsorName: 'Sponsor & synthetic',
  sponsorContactName: null,
  sponsorContactEmail: null,
  sponsorWebsiteUrl: null,
  lineItems: [],
  notes: 'Conditions <script> & originales\nSeconde ligne',
  ...overrides
});

test('private sponsorship access remains bilingual and escapes its reference and URL', () => {
  for (const [locale, subject, linkLabel] of [
    [
      'fr-CA',
      'Votre lien de suivi de commandite OpenG7',
      'Reprendre ma commandite'
    ],
    ['en', 'Your OpenG7 sponsorship access link', 'Resume my sponsorship']
  ]) {
    const input = {
      to: 'recipient@example.test',
      reference: 'G7-<synthetic>&"',
      url: 'https://example.test/private?token=synthetic&item="2"',
      locale,
      idempotencyKey: 'synthetic-access'
    };
    const message = renderSponsorshipAccessEmail(input);
    assert.equal(message.subject, subject);
    assert.ok(message.text.includes(input.url));
    assert.ok(message.html.includes(linkLabel));
    assert.match(message.html, /G7-&lt;synthetic&gt;&amp;&quot;/);
    assert.match(message.html, /token=synthetic&amp;item=&quot;2&quot;/);
    assert.deepEqual(message.metadata, { publicReference: input.reference });
    if (locale === 'fr-CA') {
      assert.match(message.text, /lien privé/);
      assert.match(message.text, /n’avez pas demandé/);
    } else {
      assert.match(message.text, /Do not share this link/);
    }
  }
});

test('reference recovery keeps the ordered facts and escapes display names in HTML', () => {
  const references = ['paid', 'refunded', 'disputed', 'pending'].map(
    (paymentStatus, index) => ({
      publicReference: `G7-${index + 1}`,
      contributionType: index === 0 ? 'sponsorship_interest' : 'personal',
      amount: 25.15,
      currency: 'cad',
      paymentStatus,
      paidAt: null,
      createdAt: 'invalid-date',
      displayName: '  Sponsor <script> & original  '
    })
  );
  const message = renderContributionReferenceRecoveryEmail({ references });
  assert.match(message.text, /1\. G7-1\n   Type: Commandite/);
  assert.match(message.text, /2\. G7-2\n   Type: Contribution personnelle/);
  for (const status of ['confirmee', 'remboursee', 'contestee', 'en attente']) {
    assert.ok(message.text.includes(status));
  }
  assert.match(message.text, /Date: invalid-date/);
  assert.match(message.html, /Nom: Sponsor &lt;script&gt; &amp; original/);
  assert.doesNotMatch(message.html, /<script>/);
  assert.deepEqual(message.metadata, {
    publicReferences: ['G7-1', 'G7-2', 'G7-3', 'G7-4'],
    referenceCount: 4
  });
});

test('rejection and refund messages preserve explicit handling and escape multiline notes', () => {
  const input = {
    to: 'recipient@example.test',
    contributionId: 'synthetic-contribution',
    publicReference: null,
    sponsorName: '<script>Sponsor</script>',
    amount: 25.15,
    currency: 'cad',
    reviewReason: 'Motif <synthetic>\nSuite & originale',
    sponsorMessage: 'Message <synthetic>\nSuite & originale',
    refundNote: '  Note <synthetic>  ',
    refundId: 're_synthetic',
    refundStatus: null
  };
  for (const [refundHandling, wording] of [
    ['manual_required', 'Un remboursement sera traite separement'],
    ['manual_completed', 'Le remboursement a ete marque comme deja traite'],
    ['none', 'Aucun remboursement automatique n est declenche']
  ]) {
    const message = renderSponsorshipRejectionEmail({
      ...input,
      refundHandling
    });
    assert.ok(message.text.includes(wording));
    assert.match(
      message.html,
      /Message &lt;synthetic&gt;<br \/>Suite &amp; originale/
    );
    assert.match(
      message.html,
      /Note remboursement:<\/strong> Note &lt;synthetic&gt;/
    );
    assert.doesNotMatch(message.html, /<script>/);
    assert.equal(message.metadata.refundHandling, refundHandling);
  }
  const refund = renderSponsorshipRefundEmail(input);
  assert.match(refund.text, /Statut Stripe: cree/);
  assert.equal(refund.metadata.refundStatus, null);
  assert.equal(refund.metadata.refundId, input.refundId);
});

test('document emails format stored minor units and preserve original notes and line items', () => {
  const invoice = createDocument();
  const invoiceMessage = renderSponsorshipInvoiceEmail({ invoice });
  assert.match(invoiceMessage.text, /Total paye: 375,50/);
  assert.ok(invoiceMessage.text.includes(invoice.notes));
  assert.match(
    invoiceMessage.html,
    /Conditions &lt;script&gt; &amp; originales<br \/>Seconde ligne/
  );
  assert.doesNotMatch(invoiceMessage.html, /<script>/);
  assert.equal(invoice.lineItems.length, 0);
  assert.equal(invoiceMessage.metadata.invoiceId, invoice.id);

  const creditNote = createDocument({
    subtotalCents: 7510,
    totalCents: 7510,
    lineItems: [
      {
        description: 'Avoir <synthetic>',
        quantity: 2,
        unitAmountCents: 3755,
        totalCents: 7510
      }
    ]
  });
  const creditMessage = renderSponsorshipCreditNoteEmail({ creditNote });
  assert.match(creditMessage.text, /2 x 37,55.+ = 75,10/);
  assert.match(creditMessage.html, /Avoir &lt;synthetic&gt;/);
  assert.ok(creditMessage.text.includes(creditNote.notes));
  assert.equal(
    creditMessage.metadata.stripeRefundId,
    creditNote.stripeRefundId
  );
  assert.equal(creditMessage.metadata.invoiceNumber, creditNote.invoiceNumber);
});

test('review reminders link only HTTP URLs without credentials and keep escaped navigation paths', () => {
  const input = {
    totalCount: 1,
    urgentCount: 0,
    oldestDaysWaiting: null,
    items: []
  };
  for (const [adminUrl, linked] of [
    ['https://example.test/admin?scope=1&item=2', true],
    ['http://example.test/admin', true],
    ['/admin/fundraiser/sponsors', false],
    ['javascript:alert(1)', false],
    ['https://user:synthetic@example.test/admin', false]
  ]) {
    const message = renderSponsorshipReviewReminderNotification({
      ...input,
      adminUrl
    });
    assert.equal(message.html.includes('<a href='), linked);
    assert.ok(message.text.includes(adminUrl));
    assert.match(
      message.text,
      /ne valide, ne refuse et ne publie aucune commandite/
    );
  }
});

test('admin and information messages preserve private preparation wording and escape plain text', () => {
  const admin = renderAdminContributionReceivedEmail({
    activityId: 'synthetic-activity',
    contributionId: 'synthetic-contribution',
    reference: 'G7-<synthetic>',
    amountMinor: 2515,
    currency: 'cad',
    adminUrl: 'https://example.test/admin'
  });
  assert.match(admin.subject, /Contribution reçue — 25,15/);
  assert.match(admin.text, /préparation reste privée/);
  assert.match(admin.html, /G7-&lt;synthetic&gt;/);
  assert.deepEqual(admin.metadata, {
    contributionId: 'synthetic-contribution',
    activityId: 'synthetic-activity'
  });

  const input = {
    contributionId: 'synthetic-contribution',
    subject: 'Informations requises',
    body: 'Message <script> & original\nSeconde ligne'
  };
  const request = renderSponsorshipInformationRequestEmail(input);
  assert.equal(request.text, input.body);
  assert.equal(
    request.html,
    '<p>Message &lt;script&gt; &amp; original<br>Seconde ligne</p>'
  );
  assert.deepEqual(request.metadata, { contributionId: input.contributionId });
});
