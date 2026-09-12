ALTER TABLE fund_allocations
  ADD COLUMN IF NOT EXISTS expected_outcome TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS progress_status TEXT NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS proof_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_source TEXT,
  ADD COLUMN IF NOT EXISTS proof_published_at TIMESTAMPTZ;

ALTER TABLE fund_allocations
  DROP CONSTRAINT IF EXISTS fund_allocations_progress_status_check;

ALTER TABLE fund_allocations
  ADD CONSTRAINT fund_allocations_progress_status_check
  CHECK (progress_status IN ('planned', 'in_progress', 'delivered'));

CREATE INDEX IF NOT EXISTS idx_fund_allocations_progress_status
  ON fund_allocations (progress_status);

CREATE INDEX IF NOT EXISTS idx_fund_allocations_proof_published_at
  ON fund_allocations (proof_published_at DESC);