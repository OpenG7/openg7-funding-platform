ALTER TABLE fund_contributions
  ADD COLUMN IF NOT EXISTS sponsor_company_name TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_website_url TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_message TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_details_submitted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fund_contributions_sponsor_submitted_at
  ON fund_contributions (sponsor_details_submitted_at DESC);
