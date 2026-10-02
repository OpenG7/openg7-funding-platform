export interface SponsorshipInvoiceConfig {
  readonly invoicePrefix: string;
  readonly creditNotePrefix: string;
  readonly issuerName: string;
  readonly issuerEmail: string;
  readonly issuerAddress: string;
  readonly issuerTaxId: string;
  readonly taxLabel: string;
  readonly invoiceLegalNote: string;
  readonly creditNoteLegalNote: string;
}

export const loadSponsorshipInvoiceConfig = (
  env: Readonly<Record<string, string | undefined>>
): SponsorshipInvoiceConfig => ({
  invoicePrefix: env.FUNDING_SPONSORSHIP_INVOICE_PREFIX?.trim() || 'OG7-CMD',
  creditNotePrefix:
    env.FUNDING_SPONSORSHIP_CREDIT_NOTE_PREFIX?.trim() || 'OG7-AV',
  issuerName: env.FUNDING_INVOICE_ISSUER_NAME?.trim() || 'OpenG7',
  issuerEmail:
    env.FUNDING_INVOICE_ISSUER_EMAIL?.trim() ||
    env.MAIL_REPLY_TO_ADDRESS?.trim() ||
    env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() ||
    '',
  issuerAddress: env.FUNDING_INVOICE_ISSUER_ADDRESS?.trim() || '',
  issuerTaxId: env.FUNDING_INVOICE_TAX_ID?.trim() || '',
  taxLabel:
    env.FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL?.trim() ||
    'Taxes non calculees par la plateforme',
  invoiceLegalNote:
    env.FUNDING_SPONSORSHIP_INVOICE_LEGAL_NOTE?.trim() ||
    'Facture de commandite descriptive. Ce document ne constitue pas un recu officiel de don de bienfaisance.',
  creditNoteLegalNote:
    env.FUNDING_SPONSORSHIP_CREDIT_NOTE_LEGAL_NOTE?.trim() ||
    'Avoir de commandite lie a un remboursement Stripe. Ce document reduit la facture associee du montant indique et ne constitue pas un recu officiel de don de bienfaisance.'
});

// Issuance and administration share the same startup configuration. Changes
// to process.env after import must not change the settings used for issuance.
export const sponsorshipInvoiceConfig = Object.freeze(
  loadSponsorshipInvoiceConfig(process.env)
);
