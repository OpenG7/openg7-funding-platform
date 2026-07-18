ALTER TABLE fund_contributions
  ADD COLUMN IF NOT EXISTS sponsorship_refund_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS sponsorship_refund_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sponsorship_refund_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sponsorship_refund_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sponsorship_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS sponsorship_refund_note TEXT,
  ADD COLUMN IF NOT EXISTS sponsorship_refund_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fund_contributions_sponsorship_refund_status_check'
      AND conrelid = 'fund_contributions'::regclass
  ) THEN
    ALTER TABLE fund_contributions
      ADD CONSTRAINT fund_contributions_sponsorship_refund_status_check
      CHECK (
        sponsorship_refund_status IN (
          'not_requested',
          'requested',
          'processing',
          'completed',
          'failed'
        )
      );
  END IF;
END $$;

UPDATE fund_contributions
SET
  sponsorship_refund_status = 'completed',
  sponsorship_refund_requested_at = COALESCE(
    sponsorship_refund_requested_at,
    updated_at,
    paid_at,
    NOW()
  ),
  sponsorship_refund_processed_at = COALESCE(
    sponsorship_refund_processed_at,
    updated_at,
    paid_at,
    NOW()
  ),
  sponsorship_refund_completed_at = COALESCE(
    sponsorship_refund_completed_at,
    updated_at,
    paid_at,
    NOW()
  )
WHERE contribution_type = 'sponsorship_interest'
  AND status = 'refunded'
  AND sponsorship_refund_status = 'not_requested';

CREATE INDEX IF NOT EXISTS idx_fund_contributions_sponsorship_refund_status
  ON fund_contributions (sponsorship_refund_status);

CREATE INDEX IF NOT EXISTS idx_fund_contributions_sponsorship_refund_completed_at
  ON fund_contributions (sponsorship_refund_completed_at DESC);
