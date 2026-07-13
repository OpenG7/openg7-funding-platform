CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE fund_contributions
  ADD COLUMN IF NOT EXISTS public_reference TEXT;

UPDATE fund_contributions
SET public_reference = CONCAT(
  'OG7-',
  EXTRACT(YEAR FROM COALESCE(paid_at, created_at))::int,
  '-',
  UPPER(SUBSTRING(ENCODE(DIGEST(id::text, 'sha256'), 'hex') FROM 1 FOR 8))
)
WHERE public_reference IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_contributions_public_reference
  ON fund_contributions (public_reference)
  WHERE public_reference IS NOT NULL;
