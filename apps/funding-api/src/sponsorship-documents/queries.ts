export const sponsorshipInvoiceSelect = `
  invoice.id::text AS id,
  invoice.contribution_id::text AS contribution_id,
  invoice.invoice_number,
  invoice.public_reference,
  invoice.stripe_session_id,
  invoice.stripe_payment_intent_id,
  invoice.issued_at::text AS issued_at,
  invoice.paid_at::text AS paid_at,
  invoice.currency,
  invoice.subtotal_cents::text AS subtotal_cents,
  invoice.tax_cents::text AS tax_cents,
  invoice.total_cents::text AS total_cents,
  invoice.tax_label,
  invoice.issuer_name,
  invoice.issuer_email,
  invoice.issuer_address,
  invoice.issuer_tax_id,
  invoice.sponsor_name,
  invoice.sponsor_contact_name,
  invoice.sponsor_contact_email,
  invoice.sponsor_website_url,
  invoice.line_items,
  invoice.notes
`;

export const sponsorshipCreditNoteSelect = `
  credit_note.id::text AS id,
  credit_note.invoice_id::text AS invoice_id,
  credit_note.contribution_id::text AS contribution_id,
  credit_note.credit_note_number,
  credit_note.invoice_number,
  credit_note.public_reference,
  credit_note.stripe_refund_id,
  credit_note.stripe_payment_intent_id,
  credit_note.issued_at::text AS issued_at,
  credit_note.currency,
  credit_note.subtotal_cents::text AS subtotal_cents,
  credit_note.tax_cents::text AS tax_cents,
  credit_note.total_cents::text AS total_cents,
  credit_note.tax_label,
  credit_note.issuer_name,
  credit_note.issuer_email,
  credit_note.issuer_address,
  credit_note.issuer_tax_id,
  credit_note.sponsor_name,
  credit_note.sponsor_contact_name,
  credit_note.sponsor_contact_email,
  credit_note.sponsor_website_url,
  credit_note.line_items,
  credit_note.notes
`;

export const latestEmailSelect = `
  latest_email.status AS last_email_status,
  latest_email.recipient_email AS last_email_recipient,
  latest_email.sent_at::text AS last_email_sent_at,
  latest_email.last_error AS last_email_error
`;
