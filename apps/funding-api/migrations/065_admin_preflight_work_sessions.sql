-- Personal review context only. No business draft, authorization or job is created.
CREATE TABLE admin_preflight_work_sessions (
  id UUID PRIMARY KEY,
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
  status TEXT NOT NULL CHECK (status IN ('active','paused','finished')),
  filters JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(filters)='object'),
  last_position INTEGER NOT NULL DEFAULT 1 CHECK (last_position BETWEEN 1 AND 100),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  CHECK ((status='finished')=(finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX admin_preflight_work_sessions_one_active_actor
  ON admin_preflight_work_sessions(actor) WHERE status IN ('active','paused');
CREATE INDEX admin_preflight_work_sessions_recent
  ON admin_preflight_work_sessions(actor,updated_at DESC,id);

CREATE TABLE admin_preflight_work_session_items (
  session_id UUID NOT NULL REFERENCES admin_preflight_work_sessions(id),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 100),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  obligation_id UUID NOT NULL REFERENCES sponsorship_obligations(id),
  observed_version TEXT NOT NULL CHECK (observed_version ~ '^[a-f0-9]{64}$'),
  observed_content_version TEXT NOT NULL CHECK (observed_content_version ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','deferred','saved')),
  checkpoint JSONB NOT NULL DEFAULT '{"pendingDecision":null,"reason":""}' CHECK (jsonb_typeof(checkpoint)='object'),
  visited_at TIMESTAMPTZ,
  saved_at TIMESTAMPTZ,
  PRIMARY KEY(session_id,position),
  UNIQUE(session_id,contribution_id,obligation_id)
);

-- Receipts retain references and hashes only; business text stays with its owner.
CREATE TABLE admin_preflight_work_session_commands (
  request_id UUID PRIMARY KEY,
  session_id UUID REFERENCES admin_preflight_work_sessions(id),
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  kind TEXT NOT NULL CHECK (kind IN ('start','visit','defer','checkpoint','pause','finish','resume','save_draft')),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  obligation_id UUID NOT NULL REFERENCES sponsorship_obligations(id),
  audit_reference UUID NOT NULL REFERENCES admin_audit_log(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (session_id IS NOT NULL OR kind='save_draft')
);
CREATE INDEX admin_preflight_work_session_commands_session
  ON admin_preflight_work_session_commands(session_id,created_at,request_id);
CREATE TRIGGER admin_preflight_work_session_commands_immutable
  BEFORE UPDATE OR DELETE ON admin_preflight_work_session_commands
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();

CREATE FUNCTION protect_preflight_work_session_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.id,NEW.actor,NEW.started_at)
    IS DISTINCT FROM (OLD.id,OLD.actor,OLD.started_at) THEN
    RAISE EXCEPTION 'work session identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_preflight_work_sessions_identity
  BEFORE UPDATE OR DELETE ON admin_preflight_work_sessions
  FOR EACH ROW EXECUTE FUNCTION protect_preflight_work_session_identity();
CREATE FUNCTION protect_preflight_work_session_item_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.session_id,NEW.position,NEW.contribution_id,NEW.obligation_id)
    IS DISTINCT FROM (OLD.session_id,OLD.position,OLD.contribution_id,OLD.obligation_id) THEN
    RAISE EXCEPTION 'work session item identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_preflight_work_session_items_identity
  BEFORE UPDATE OR DELETE ON admin_preflight_work_session_items
  FOR EACH ROW EXECUTE FUNCTION protect_preflight_work_session_item_identity();
