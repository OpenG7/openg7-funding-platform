-- Preparation approval is private, append-only and never authorizes delivery.
CREATE TABLE admin_preparation_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  contribution_id UUID NOT NULL,
  preparation_version TEXT NOT NULL CHECK (preparation_version ~ '^[a-f0-9]{64}$'),
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  request_id UUID NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  audit_reference UUID NOT NULL REFERENCES admin_audit_log(id),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (run_id, contribution_id)
    REFERENCES admin_automatic_run_dossiers(run_id, contribution_id),
  UNIQUE (run_id, contribution_id, preparation_version)
);
CREATE INDEX admin_preparation_approvals_history
  ON admin_preparation_approvals(contribution_id, approved_at DESC, id);
CREATE TRIGGER admin_preparation_approvals_immutable
  BEFORE UPDATE OR DELETE ON admin_preparation_approvals
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
