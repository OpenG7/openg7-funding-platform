ALTER TABLE fund_contributions
  ADD COLUMN IF NOT EXISTS sponsorship_followup_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS sponsorship_followup_token_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sponsorship_followup_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sponsorship_followup_email_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_contributions_followup_token_hash
  ON fund_contributions (sponsorship_followup_token_hash)
  WHERE sponsorship_followup_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fund_contributions_followup_email_sent_at
  ON fund_contributions (sponsorship_followup_email_sent_at DESC);
