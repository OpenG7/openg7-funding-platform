import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadSponsorshipInvoiceConfig,
  sponsorshipInvoiceConfig
} from '../dist/apps/funding-api/src/sponsorship-invoice-config.js';

const environmentKeys = [
  'FUNDING_SPONSORSHIP_INVOICE_PREFIX',
  'FUNDING_SPONSORSHIP_CREDIT_NOTE_PREFIX',
  'FUNDING_INVOICE_ISSUER_NAME',
  'FUNDING_INVOICE_ISSUER_EMAIL',
  'MAIL_REPLY_TO_ADDRESS',
  'FUNDING_ADMIN_NOTIFICATION_EMAIL',
  'FUNDING_INVOICE_ISSUER_ADDRESS',
  'FUNDING_INVOICE_TAX_ID',
  'FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL',
  'FUNDING_SPONSORSHIP_INVOICE_LEGAL_NOTE',
  'FUNDING_SPONSORSHIP_CREDIT_NOTE_LEGAL_NOTE'
];

const defaults = {
  invoicePrefix: 'OG7-CMD',
  creditNotePrefix: 'OG7-AV',
  issuerName: 'OpenG7',
  issuerEmail: '',
  issuerAddress: '',
  issuerTaxId: '',
  taxLabel: 'Taxes non calculees par la plateforme',
  invoiceLegalNote:
    'Facture de commandite descriptive. Ce document ne constitue pas un recu officiel de don de bienfaisance.',
  creditNoteLegalNote:
    'Avoir de commandite lie a un remboursement Stripe. Ce document reduit la facture associee du montant indique et ne constitue pas un recu officiel de don de bienfaisance.'
};

test('invoice configuration preserves defaults for absent and blank settings', () => {
  assert.deepEqual(loadSponsorshipInvoiceConfig({}), defaults);
  for (const value of ['', '  \t\n ']) {
    const env = Object.fromEntries(environmentKeys.map((key) => [key, value]));
    assert.deepEqual(loadSponsorshipInvoiceConfig(env), defaults);
  }
});

test('explicit invoice settings are trimmed without changing internal text', () => {
  const env = {
    FUNDING_SPONSORSHIP_INVOICE_PREFIX: ' CMD-TEST ',
    FUNDING_SPONSORSHIP_CREDIT_NOTE_PREFIX: ' AV-TEST ',
    FUNDING_INVOICE_ISSUER_NAME: ' Synthetic issuer ',
    FUNDING_INVOICE_ISSUER_EMAIL: ' issuer@example.test ',
    FUNDING_INVOICE_ISSUER_ADDRESS: ' Address line 1\nAddress line 2 ',
    FUNDING_INVOICE_TAX_ID: ' SYNTHETIC-TAX-ID ',
    FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL: ' Synthetic tax label ',
    FUNDING_SPONSORSHIP_INVOICE_LEGAL_NOTE: ' Invoice note\nSecond line ',
    FUNDING_SPONSORSHIP_CREDIT_NOTE_LEGAL_NOTE: ' Credit note\nSecond line '
  };
  const config = loadSponsorshipInvoiceConfig(env);
  assert.deepEqual(config, {
    invoicePrefix: 'CMD-TEST',
    creditNotePrefix: 'AV-TEST',
    issuerName: 'Synthetic issuer',
    issuerEmail: 'issuer@example.test',
    issuerAddress: 'Address line 1\nAddress line 2',
    issuerTaxId: 'SYNTHETIC-TAX-ID',
    taxLabel: 'Synthetic tax label',
    invoiceLegalNote: 'Invoice note\nSecond line',
    creditNoteLegalNote: 'Credit note\nSecond line'
  });
  env.FUNDING_INVOICE_ISSUER_NAME = 'Changed source';
  assert.equal(config.issuerName, 'Synthetic issuer');
  assert.equal(loadSponsorshipInvoiceConfig(env).issuerName, 'Changed source');
});

test('issuer email fallback keeps the invoice, reply-to, admin priority', () => {
  const env = {
    FUNDING_INVOICE_ISSUER_EMAIL: ' issuer@example.test ',
    MAIL_REPLY_TO_ADDRESS: ' reply@example.test ',
    FUNDING_ADMIN_NOTIFICATION_EMAIL: ' admin@example.test '
  };
  assert.equal(
    loadSponsorshipInvoiceConfig(env).issuerEmail,
    'issuer@example.test'
  );
  for (const value of [undefined, '', '  ']) {
    env.FUNDING_INVOICE_ISSUER_EMAIL = value;
    assert.equal(
      loadSponsorshipInvoiceConfig(env).issuerEmail,
      'reply@example.test'
    );
    const withoutReplyTo = { ...env, MAIL_REPLY_TO_ADDRESS: value };
    assert.equal(
      loadSponsorshipInvoiceConfig(withoutReplyTo).issuerEmail,
      'admin@example.test'
    );
    assert.equal(
      loadSponsorshipInvoiceConfig({
        ...withoutReplyTo,
        FUNDING_ADMIN_NOTIFICATION_EMAIL: value
      }).issuerEmail,
      ''
    );
  }
});

test('invoice and credit-note issuance share the immutable startup snapshot', async (t) => {
  const originalEnv = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]])
  );
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const startup = { ...sponsorshipInvoiceConfig };
  assert.ok(Object.isFrozen(sponsorshipInvoiceConfig));
  assert.throws(() => {
    sponsorshipInvoiceConfig.issuerName = 'Changed snapshot';
  }, TypeError);

  for (const key of environmentKeys) process.env[key] = ' Runtime override ';
  assert.equal(
    loadSponsorshipInvoiceConfig(process.env).issuerName,
    'Runtime override'
  );
  // Importing a consumer later must still use the shared startup settings.
  const {
    createSponsorshipInvoiceForStripeSession,
    createSponsorshipCreditNoteForRefund
  } =
    await import('../dist/apps/funding-api/src/sponsorship-invoices.repository.js');
  let invoiceParams;
  await createSponsorshipInvoiceForStripeSession(
    {
      async query(_sql, params) {
        invoiceParams = params;
        return { rows: [] };
      }
    },
    {
      stripeSessionId: 'cs_invoice_config_test',
      stripePaymentIntentId: null,
      publicReference: 'OG7-2026-REFERENCE',
      amountCents: 25000,
      currency: 'cad',
      paidAtIso: '2026-09-01T12:00:00.000Z',
      customerEmail: 'sponsor@example.test'
    }
  );
  const invoiceNumber = `${startup.invoicePrefix}-2026-REFERENCE`;
  assert.equal(invoiceParams[1], invoiceNumber);
  assert.deepEqual(invoiceParams.slice(5, 10), [
    startup.taxLabel,
    startup.issuerName,
    startup.issuerEmail || null,
    startup.issuerAddress || null,
    startup.issuerTaxId || null
  ]);
  assert.ok(invoiceParams[12].endsWith(startup.invoiceLegalNote));

  let creditNoteParams;
  let creditNoteQueryCount = 0;
  await createSponsorshipCreditNoteForRefund(
    {
      async query(_sql, params) {
        creditNoteQueryCount += 1;
        if (creditNoteQueryCount === 1) {
          return {
            rows: [{ invoice_number: invoiceNumber, total_cents: '25000' }]
          };
        }
        creditNoteParams = params;
        return { rows: [] };
      }
    },
    {
      contributionId: 'f1e9756a-b50d-4f3a-a8b0-fb26a1d2e6ba',
      stripeRefundId: 're_invoice_config_test',
      refundAmountCents: 10000
    }
  );
  assert.ok(
    creditNoteParams[1].startsWith(
      `${startup.creditNotePrefix}-2026-REFERENCE-`
    )
  );
  assert.equal(creditNoteParams[5], startup.creditNoteLegalNote);
  assert.deepEqual(sponsorshipInvoiceConfig, startup);
});

test('document facade preserves the public exports and owner implementations', async () => {
  const root = '../dist/apps/funding-api/src/';
  const [facade, write, backfill, read, creditNotes] = await Promise.all([
    import(`${root}sponsorship-invoices.repository.js`),
    import(`${root}sponsorship-documents/invoices.write.js`),
    import(`${root}sponsorship-documents/invoices.backfill.js`),
    import(`${root}sponsorship-documents/invoices.read.js`),
    import(`${root}sponsorship-documents/credit-notes.repository.js`)
  ]);
  const expected = {
    createSponsorshipInvoiceForStripeSession:
      write.createSponsorshipInvoiceForStripeSession,
    backfillMissingSponsorshipInvoices:
      backfill.backfillMissingSponsorshipInvoices,
    getSponsorshipInvoiceById: read.getSponsorshipInvoiceById,
    getAdminSponsorshipInvoiceById: read.getAdminSponsorshipInvoiceById,
    listAdminSponsorshipInvoices: read.listAdminSponsorshipInvoices,
    createSponsorshipCreditNoteForRefund:
      creditNotes.createSponsorshipCreditNoteForRefund,
    getSponsorshipCreditNoteById: creditNotes.getSponsorshipCreditNoteById,
    getAdminSponsorshipCreditNoteById:
      creditNotes.getAdminSponsorshipCreditNoteById
  };
  assert.deepEqual(Object.keys(facade).sort(), Object.keys(expected).sort());
  for (const [name, implementation] of Object.entries(expected)) {
    assert.equal(facade[name], implementation, name);
  }
});

test('document owners keep the acyclic persistence dependency graph', () => {
  const root = 'apps/funding-api/src/sponsorship-documents/';
  const dependencies = {
    'contracts.ts': [],
    'queries.ts': [],
    'invoices.write.ts': ['contracts.ts'],
    'credit-notes.repository.ts': ['contracts.ts', 'queries.ts'],
    'invoices.read.ts': ['credit-notes.repository.ts', 'queries.ts'],
    'invoices.backfill.ts': ['invoices.write.ts', 'invoices.read.ts']
  };
  for (const [owner, allowed] of Object.entries(dependencies)) {
    const source = readFileSync(`${root}${owner}`, 'utf8');
    assert.ok(!source.includes('sponsorship-invoices.repository'), owner);
    const imports = Array.from(
      source.matchAll(/from '\.\/([^']+)\.js'/gu),
      ([, name]) => `${name}.ts`
    ).sort();
    assert.deepEqual(imports, [...allowed].sort(), owner);
  }
});
