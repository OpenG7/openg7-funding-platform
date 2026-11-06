-- Extends the existing private preparation review with an exact service scope.
-- No obligation, moderation decision, delivery or sending authorization changes.
CREATE TABLE admin_service_preparation_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  obligation_id UUID NOT NULL REFERENCES sponsorship_obligations(id),
  draft_id TEXT NOT NULL CHECK (length(draft_id) BETWEEN 1 AND 200),
  draft_version TEXT NOT NULL CHECK (length(draft_version) BETWEEN 1 AND 200),
  content_version TEXT NOT NULL CHECK (content_version ~ '^[a-f0-9]{64}$'),
  expected_version TEXT NOT NULL CHECK (expected_version ~ '^[a-f0-9]{64}$'),
  decision TEXT NOT NULL CHECK (decision IN ('approved','correction_requested','rejected')),
  reason TEXT,
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  request_id UUID NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  audit_reference UUID NOT NULL REFERENCES admin_audit_log(id),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (decision='approved' OR (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 10 AND 2000)),
  CHECK (reason IS NULL OR length(reason)<=2000)
);
CREATE INDEX admin_service_preparation_decisions_history
  ON admin_service_preparation_decisions(contribution_id,obligation_id,created_at DESC,id DESC);
-- Two sessions may have acquired repeatable-read snapshots before the first
-- decision commits. One examined version can have only one logical decision.
CREATE UNIQUE INDEX admin_service_preparation_decisions_examined_version
  ON admin_service_preparation_decisions(contribution_id,obligation_id,expected_version);
CREATE TRIGGER admin_service_preparation_decisions_immutable
  BEFORE UPDATE OR DELETE ON admin_service_preparation_decisions
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
