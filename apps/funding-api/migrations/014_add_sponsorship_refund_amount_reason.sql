ALTER TABLE fund_contributions
  ADD COLUMN IF NOT EXISTS sponsorship_refund_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS sponsorship_refund_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fund_contributions_sponsorship_refund_amount_check'
      AND conrelid = 'fund_contributions'::regclass
  ) THEN
    ALTER TABLE fund_contributions
      ADD CONSTRAINT fund_contributions_sponsorship_refund_amount_check
      CHECK (
        sponsorship_refund_amount_cents IS NULL
        OR sponsorship_refund_amount_cents > 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fund_contributions_sponsorship_refund_reason_check'
      AND conrelid = 'fund_contributions'::regclass
  ) THEN
    ALTER TABLE fund_contributions
      ADD CONSTRAINT fund_contributions_sponsorship_refund_reason_check
      CHECK (
        sponsorship_refund_reason IS NULL
        OR sponsorship_refund_reason IN (
          'requested_by_customer',
          'duplicate',
          'fraudulent'
        )
      );
  END IF;
END $$;

UPDATE fund_contributions
SET
  sponsorship_refund_amount_cents = amount_cents,
  sponsorship_refund_reason = COALESCE(
    sponsorship_refund_reason,
    'requested_by_customer'
  )
WHERE contribution_type = 'sponsorship_interest'
  AND status = 'refunded'
  AND sponsorship_refund_status = 'completed'
  AND sponsorship_refund_amount_cents IS NULL;

