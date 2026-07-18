CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sponsorship_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES sponsorship_invoices(id) ON DELETE CASCADE,
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id) ON DELETE CASCADE,
  credit_note_number TEXT NOT NULL UNIQUE,
  invoice_number TEXT NOT NULL,
  public_reference TEXT,
  stripe_refund_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  currency TEXT NOT NULL DEFAULT 'cad',
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  tax_label TEXT NOT NULL DEFAULT 'Taxes non calculees par la plateforme',
  issuer_name TEXT NOT NULL,
  issuer_email TEXT,
  issuer_address TEXT,
  issuer_tax_id TEXT,
  sponsor_name TEXT NOT NULL,
  sponsor_contact_name TEXT,
  sponsor_contact_email TEXT,
  sponsor_website_url TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsorship_credit_notes_stripe_refund_id
  ON sponsorship_credit_notes (stripe_refund_id);

CREATE INDEX IF NOT EXISTS idx_sponsorship_credit_notes_invoice_id
  ON sponsorship_credit_notes (invoice_id);

CREATE INDEX IF NOT EXISTS idx_sponsorship_credit_notes_contribution_id
  ON sponsorship_credit_notes (contribution_id);

CREATE INDEX IF NOT EXISTS idx_sponsorship_credit_notes_issued_at
  ON sponsorship_credit_notes (issued_at DESC);
