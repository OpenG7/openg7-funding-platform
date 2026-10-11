CREATE TABLE moderation_remote_removals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES moderation_decisions(id),
  delivery_id UUID NOT NULL REFERENCES publication_deliveries(id),
  feed_id TEXT NOT NULL REFERENCES publication_feeds(id),
  external_post_id TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('mock','live')),
  status TEXT NOT NULL DEFAULT 'not_supported' CHECK(status IN ('not_supported','requested','confirmed','uncertain')),
  evidence_url TEXT,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(decision_id,delivery_id),
  CHECK(status<>'confirmed' OR (evidence_url IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE TABLE moderation_retention_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES moderation_cases(id),
  reference TEXT NOT NULL UNIQUE CHECK(length(reference) BETWEEN 1 AND 100),
  reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  released_by TEXT,
  CHECK((released_at IS NULL)=(released_by IS NULL))
);
CREATE INDEX moderation_remote_removal_open ON moderation_remote_removals(status,created_at) WHERE status<>'confirmed';
CREATE INDEX moderation_retention_hold_case ON moderation_retention_holds(case_id) WHERE released_at IS NULL;
