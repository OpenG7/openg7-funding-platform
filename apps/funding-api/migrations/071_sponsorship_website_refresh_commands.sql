-- Exact, explicit revalidation of an existing website passage. No source,
-- agreement, visibility or historical proof is changed by this migration.
CREATE TABLE sponsorship_website_refresh_commands (
  request_id UUID PRIMARY KEY,
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  obligation_id UUID NOT NULL,
  actor TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  outcome TEXT NOT NULL CHECK(outcome IN ('updated','unchanged','blocked','conflict')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(obligation_id,contribution_id) REFERENCES sponsorship_obligations(id,contribution_id)
);
CREATE INDEX sponsorship_website_refresh_commands_contribution
  ON sponsorship_website_refresh_commands(contribution_id,recorded_at DESC);
CREATE TRIGGER sponsorship_website_refresh_commands_immutable
  BEFORE UPDATE OR DELETE ON sponsorship_website_refresh_commands
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
