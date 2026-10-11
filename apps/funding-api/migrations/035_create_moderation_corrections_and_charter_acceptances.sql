CREATE TABLE moderation_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES moderation_decisions(id),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  submitted_content_version INTEGER NOT NULL CHECK (submitted_content_version > 0),
  content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX moderation_corrections_contribution ON moderation_corrections(contribution_id, created_at DESC);

CREATE TABLE sponsorship_charter_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL UNIQUE REFERENCES checkout_operations(id),
  policy_version TEXT NOT NULL REFERENCES moderation_policies(version),
  policy_fingerprint TEXT NOT NULL CHECK (policy_fingerprint ~ '^[a-f0-9]{64}$'),
  locale TEXT NOT NULL CHECK (locale IN ('fr-CA', 'en')),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- No historical acceptance is inferred or populated.
