ALTER TABLE fund_contributions
  ADD COLUMN IF NOT EXISTS sponsor_public_slug TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_public_summary TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_feed_target TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_feed_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sponsor_feed_status TEXT NOT NULL DEFAULT 'not_planned',
  ADD COLUMN IF NOT EXISTS sponsor_feed_public_url TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_feed_notes TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_visibility_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_contributions_sponsor_public_slug
  ON fund_contributions (sponsor_public_slug)
  WHERE sponsor_public_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fund_contributions_sponsor_feed_target
  ON fund_contributions (sponsor_feed_target);

CREATE INDEX IF NOT EXISTS idx_fund_contributions_sponsor_feed_status
  ON fund_contributions (sponsor_feed_status);

CREATE INDEX IF NOT EXISTS idx_fund_contributions_sponsor_visibility_updated_at
  ON fund_contributions (sponsor_visibility_updated_at DESC);
