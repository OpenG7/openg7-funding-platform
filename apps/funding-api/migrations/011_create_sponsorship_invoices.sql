CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sponsorship_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  public_reference TEXT,
  stripe_session_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsorship_invoices_contribution_id
  ON sponsorship_invoices (contribution_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsorship_invoices_stripe_session_id
  ON sponsorship_invoices (stripe_session_id);

CREATE INDEX IF NOT EXISTS idx_sponsorship_invoices_issued_at
  ON sponsorship_invoices (issued_at DESC);

