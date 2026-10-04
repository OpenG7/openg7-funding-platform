-- Private request snapshots support retries without changing Stripe parameters.
-- No historical contribution or confirmed financial fact is modified.
CREATE TABLE checkout_operations (
  id UUID PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'submitting', 'uncertain', 'created', 'completed')),
  params JSONB NOT NULL,
  contribution_input JSONB NOT NULL,
  provider_result JSONB,
  first_submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (state NOT IN ('created', 'completed') OR provider_result IS NOT NULL)
);
