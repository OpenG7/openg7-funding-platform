import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import { formatSponsorshipBenefitList } from '../sponsorship-benefits.js';
import { sponsorshipInvoiceConfig } from '../sponsorship-invoice-config.js';
import {
  centsToAmount,
  mapSponsorshipInvoiceRow,
  type SponsorshipInvoiceLineItem,
  type SponsorshipInvoiceRecord,
  type SponsorshipInvoiceRow
} from '../sponsorship-invoice.mapping.js';

import type { CreateSponsorshipInvoiceInput } from './contracts.js';

const {
  invoicePrefix,
  issuerName: invoiceIssuerName,
  issuerEmail: invoiceIssuerEmail,
  issuerAddress: invoiceIssuerAddress,
  issuerTaxId: invoiceIssuerTaxId,
  taxLabel: invoiceTaxLabel,
  invoiceLegalNote
} = sponsorshipInvoiceConfig;

const normalizeText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
};

const invoiceReferenceSuffix = (
  publicReference: string | null,
  stripeSessionId: string
): string => {
  if (publicReference) {
    return publicReference.replace(/^OG7-\d{4}-/u, '').replaceAll('-', '');
  }

  return createHash('sha256')
    .update(stripeSessionId)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
};

const createInvoiceNumber = (
  input: Pick<
    CreateSponsorshipInvoiceInput,
    'paidAtIso' | 'publicReference' | 'stripeSessionId'
  >
): string => {
  const year = new Date(input.paidAtIso ?? Date.now()).getUTCFullYear();
  return `${invoicePrefix}-${year}-${invoiceReferenceSuffix(
    input.publicReference,
    input.stripeSessionId
  )}`;
};

export const createSponsorshipInvoiceForStripeSession = async (
  pool: Pool | null,
  input: CreateSponsorshipInvoiceInput
): Promise<SponsorshipInvoiceRecord | null> => {
  if (!pool) {
    return null;
  }

  const invoiceNumber = createInvoiceNumber(input);
  // Persist the benefits with the issued document: resends and PDF downloads
  // must not resolve them again against a future pricing configuration.
  const notes = [
    'Avantages de votre commandite :',
    ...formatSponsorshipBenefitList(
      centsToAmount(input.amountCents),
      input.currency
    ).map((benefit) => `- ${benefit}`),
    '',
    'Ces présences nécessitent votre consentement et une validation administrative. Aucune publication n’est automatique au paiement.',
    '',
    invoiceLegalNote
  ].join('\n');
  const lineItems: readonly SponsorshipInvoiceLineItem[] = [
    {
      description: 'Commandite de visibilite OpenG7 - Fonds des batisseurs',
      quantity: 1,
      unitAmountCents: input.amountCents,
      totalCents: input.amountCents
    }
  ];

  const result = await pool.query<SponsorshipInvoiceRow>(
    `
      WITH contribution AS (
        SELECT
          id,
          public_reference,
          stripe_session_id,
          stripe_payment_intent_id,
          amount_cents,
          currency,
          paid_at,
          email_private,
          public_name,
          sponsor_company_name,
          sponsor_contact_name,
          sponsor_contact_email,
          sponsor_website_url
        FROM fund_contributions
        WHERE stripe_session_id = $1
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
        LIMIT 1
      )
      INSERT INTO sponsorship_invoices (
        contribution_id,
        invoice_number,
        public_reference,
        stripe_session_id,
        stripe_payment_intent_id,
        issued_at,
        paid_at,
        currency,
        subtotal_cents,
        tax_cents,
        total_cents,
        tax_label,
        issuer_name,
        issuer_email,
        issuer_address,
        issuer_tax_id,
        sponsor_name,
        sponsor_contact_name,
        sponsor_contact_email,
        sponsor_website_url,
        line_items,
        notes
      )
      SELECT
        contribution.id,
        $2,
        COALESCE(contribution.public_reference, $3),
        contribution.stripe_session_id,
        COALESCE($4, contribution.stripe_payment_intent_id),
        NOW(),
        COALESCE(contribution.paid_at, $5::timestamptz),
        contribution.currency,
        contribution.amount_cents,
        0,
        contribution.amount_cents,
        $6,
        $7,
        $8,
        $9,
        $10,
        COALESCE(
          NULLIF(btrim(contribution.sponsor_company_name), ''),
          NULLIF(btrim(contribution.public_name), ''),
          'Commanditaire a confirmer'
        ),
        contribution.sponsor_contact_name,
        COALESCE(
          NULLIF(btrim(contribution.sponsor_contact_email), ''),
          NULLIF(btrim(contribution.email_private), ''),
          $11
        ),
        contribution.sponsor_website_url,
        $12::jsonb,
        $13
      FROM contribution
      ON CONFLICT (contribution_id) DO UPDATE
      SET
        public_reference = COALESCE(
          sponsorship_invoices.public_reference,
          EXCLUDED.public_reference
        ),
        stripe_payment_intent_id = COALESCE(
          sponsorship_invoices.stripe_payment_intent_id,
          EXCLUDED.stripe_payment_intent_id
        ),
        paid_at = COALESCE(sponsorship_invoices.paid_at, EXCLUDED.paid_at),
        sponsor_name = CASE
          WHEN sponsorship_invoices.sponsor_name = 'Commanditaire a confirmer'
          THEN EXCLUDED.sponsor_name
          ELSE sponsorship_invoices.sponsor_name
        END,
        sponsor_contact_name = COALESCE(
          sponsorship_invoices.sponsor_contact_name,
          EXCLUDED.sponsor_contact_name
        ),
        sponsor_contact_email = COALESCE(
          sponsorship_invoices.sponsor_contact_email,
          EXCLUDED.sponsor_contact_email
        ),
        sponsor_website_url = COALESCE(
          sponsorship_invoices.sponsor_website_url,
          EXCLUDED.sponsor_website_url
        ),
        updated_at = NOW()
      RETURNING
        id::text AS id,
        contribution_id::text AS contribution_id,
        invoice_number,
        public_reference,
        stripe_session_id,
        stripe_payment_intent_id,
        issued_at::text AS issued_at,
        paid_at::text AS paid_at,
        currency,
        subtotal_cents::text AS subtotal_cents,
        tax_cents::text AS tax_cents,
        total_cents::text AS total_cents,
        tax_label,
        issuer_name,
        issuer_email,
        issuer_address,
        issuer_tax_id,
        sponsor_name,
        sponsor_contact_name,
        sponsor_contact_email,
        sponsor_website_url,
        line_items,
        notes
    `,
    [
      input.stripeSessionId,
      invoiceNumber,
      input.publicReference,
      input.stripePaymentIntentId,
      input.paidAtIso,
      invoiceTaxLabel,
      invoiceIssuerName,
      normalizeText(invoiceIssuerEmail),
      normalizeText(invoiceIssuerAddress),
      normalizeText(invoiceIssuerTaxId),
      input.customerEmail,
      JSON.stringify(lineItems),
      notes
    ]
  );

  return result.rows[0] ? mapSponsorshipInvoiceRow(result.rows[0]) : null;
};
