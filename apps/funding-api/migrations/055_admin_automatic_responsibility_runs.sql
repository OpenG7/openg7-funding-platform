-- Private administrative reconciliation only. No financial fact, approval,
-- publication, notification or worker activation is created by this migration.
CREATE TABLE admin_automatic_runs (
  id UUID PRIMARY KEY,
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('running','paused','completed','uncertain')),
  pass INTEGER NOT NULL DEFAULT 1 CHECK (pass > 0),
  cursor BIGINT NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  in_flight_request_id UUID,
  last_balance JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX admin_automatic_runs_one_active_actor
  ON admin_automatic_runs(actor) WHERE status IN ('running','paused','uncertain');
CREATE INDEX admin_automatic_runs_actor_history
  ON admin_automatic_runs(actor, started_at DESC, id);

-- The manifest is frozen in one database statement, without a client-side cap.
-- Only derived observations can change; captured financial inputs stay immutable.
CREATE TABLE admin_automatic_run_dossiers (
  run_id UUID NOT NULL REFERENCES admin_automatic_runs(id),
  position BIGINT NOT NULL CHECK (position > 0),
  contribution_id UUID NOT NULL,
  reference TEXT NOT NULL,
  contribution_type TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_status TEXT NOT NULL,
  last_pass INTEGER,
  last_balance JSONB,
  PRIMARY KEY (run_id, position),
  UNIQUE (run_id, contribution_id)
);
CREATE INDEX admin_automatic_run_dossiers_contribution
  ON admin_automatic_run_dossiers(contribution_id, run_id);

CREATE TABLE admin_automatic_run_commands (
  request_id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES admin_automatic_runs(id),
  actor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('start','advance','pause','resume','recheck','reconcile')),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('executing','completed','failed','uncertain')),
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX admin_automatic_run_commands_run
  ON admin_automatic_run_commands(run_id, created_at);

CREATE TABLE admin_automatic_run_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES admin_automatic_runs(id),
  pass INTEGER NOT NULL CHECK (pass > 0),
  position BIGINT NOT NULL CHECK (position > 0),
  contribution_id UUID NOT NULL,
  reference TEXT NOT NULL,
  actor TEXT NOT NULL,
  request_id UUID NOT NULL REFERENCES admin_automatic_run_commands(request_id),
  audit_reference UUID NOT NULL REFERENCES admin_audit_log(id),
  before_balance JSONB NOT NULL,
  balance JSONB NOT NULL,
  actions JSONB NOT NULL CHECK (jsonb_typeof(actions)='array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id, pass, position),
  UNIQUE (request_id)
);
CREATE INDEX admin_automatic_run_entries_report
  ON admin_automatic_run_entries(run_id, id);
CREATE TRIGGER admin_automatic_run_entries_immutable
  BEFORE UPDATE OR DELETE ON admin_automatic_run_entries
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();

CREATE FUNCTION protect_admin_automatic_manifest() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR
    (NEW.run_id,NEW.position,NEW.contribution_id,NEW.reference,NEW.contribution_type,
     NEW.amount_minor,NEW.currency,NEW.payment_status)
    IS DISTINCT FROM
    (OLD.run_id,OLD.position,OLD.contribution_id,OLD.reference,OLD.contribution_type,
     OLD.amount_minor,OLD.currency,OLD.payment_status) THEN
    RAISE EXCEPTION 'automatic run manifest is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_automatic_run_dossiers_immutable_inputs
  BEFORE UPDATE OR DELETE ON admin_automatic_run_dossiers
  FOR EACH ROW EXECUTE FUNCTION protect_admin_automatic_manifest();

CREATE FUNCTION protect_admin_automatic_run_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.id,NEW.actor,NEW.started_at)
    IS DISTINCT FROM (OLD.id,OLD.actor,OLD.started_at) THEN
    RAISE EXCEPTION 'automatic run identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_automatic_runs_immutable_identity
  BEFORE UPDATE OR DELETE ON admin_automatic_runs
  FOR EACH ROW EXECUTE FUNCTION protect_admin_automatic_run_identity();

CREATE FUNCTION protect_admin_automatic_command_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.request_id,NEW.run_id,NEW.actor,NEW.kind,NEW.request_hash,NEW.created_at)
    IS DISTINCT FROM (OLD.request_id,OLD.run_id,OLD.actor,OLD.kind,OLD.request_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'automatic command identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_automatic_run_commands_immutable_identity
  BEFORE UPDATE OR DELETE ON admin_automatic_run_commands
  FOR EACH ROW EXECUTE FUNCTION protect_admin_automatic_command_identity();
