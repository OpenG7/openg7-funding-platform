ALTER TABLE fund_contributions
  ADD COLUMN IF NOT EXISTS sponsor_review_status TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_review_note TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_reviewed_at TIMESTAMPTZ;

UPDATE fund_contributions
SET sponsor_review_status = 'pending_review'
WHERE contribution_type = 'sponsorship_interest'
  AND sponsor_review_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_fund_contributions_sponsor_review_status
  ON fund_contributions (sponsor_review_status);

CREATE INDEX IF NOT EXISTS idx_fund_contributions_sponsor_reviewed_at
  ON fund_contributions (sponsor_reviewed_at DESC);
