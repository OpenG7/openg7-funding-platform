-- Opt-in preparation bridge. No existing source is queued or approved by this migration.
CREATE TABLE preflight_sources (
  tenant_id TEXT NOT NULL CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  commitment_id UUID NOT NULL,
  contribution_id UUID NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  eligible BOOLEAN NOT NULL,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,commitment_id),
  FOREIGN KEY(commitment_id,contribution_id) REFERENCES sponsorship_commitments(id,contribution_id)
);
CREATE TABLE preflight_missions (
  mission_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  commitment_id UUID NOT NULL,
  contribution_id UUID NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  remote_status TEXT NOT NULL DEFAULT 'received',
  current BOOLEAN NOT NULL DEFAULT TRUE,
  poll_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  poll_attempts INTEGER NOT NULL DEFAULT 0 CHECK (poll_attempts >= 0),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,commitment_id,source_version),
  FOREIGN KEY(tenant_id,commitment_id) REFERENCES preflight_sources(tenant_id,commitment_id),
  FOREIGN KEY(commitment_id,contribution_id) REFERENCES sponsorship_commitments(id,contribution_id)
);
CREATE TABLE preflight_outbox (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  commitment_id UUID NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  mission_id UUID REFERENCES preflight_missions(mission_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('mission.submitted','source.updated')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','delivered','quarantined','superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  claim_token UUID,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  UNIQUE(tenant_id,commitment_id,source_version,event_type),
  FOREIGN KEY(tenant_id,commitment_id) REFERENCES preflight_sources(tenant_id,commitment_id),
  CHECK ((event_type='mission.submitted')=(mission_id IS NOT NULL))
);
CREATE INDEX preflight_outbox_due ON preflight_outbox(tenant_id,next_attempt_at,created_at)
  WHERE status IN ('pending','running');
CREATE INDEX preflight_missions_poll ON preflight_missions(tenant_id,poll_after) WHERE current;
CREATE TABLE preflight_preparations (
  mission_id UUID PRIMARY KEY REFERENCES preflight_missions(mission_id),
  tenant_id TEXT NOT NULL,
  commitment_id UUID NOT NULL,
  contribution_id UUID NOT NULL,
  source_version INTEGER NOT NULL,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  preparation JSONB NOT NULL CHECK (jsonb_typeof(preparation)='object' AND preparation->>'status'='proposed'),
  obsolete BOOLEAN NOT NULL DEFAULT FALSE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id,commitment_id) REFERENCES preflight_sources(tenant_id,commitment_id),
  FOREIGN KEY(commitment_id,contribution_id) REFERENCES sponsorship_commitments(id,contribution_id)
);
CREATE TABLE preflight_worker_heartbeats (
  worker_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE FUNCTION protect_preflight_payload() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='preflight_outbox' AND
    (NEW.id,NEW.tenant_id,NEW.commitment_id,NEW.source_version,NEW.mission_id,NEW.event_type,NEW.payload)
    IS DISTINCT FROM
    (OLD.id,OLD.tenant_id,OLD.commitment_id,OLD.source_version,OLD.mission_id,OLD.event_type,OLD.payload)
  THEN RAISE EXCEPTION 'preflight source events are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preflight_outbox_payload_immutable BEFORE UPDATE ON preflight_outbox
  FOR EACH ROW EXECUTE FUNCTION protect_preflight_payload();
CREATE FUNCTION protect_preflight_preparation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.mission_id,NEW.tenant_id,NEW.commitment_id,NEW.contribution_id,NEW.source_version,NEW.source_hash,NEW.preparation,NEW.imported_at)
    IS DISTINCT FROM
    (OLD.mission_id,OLD.tenant_id,OLD.commitment_id,OLD.contribution_id,OLD.source_version,OLD.source_hash,OLD.preparation,OLD.imported_at)
    OR (OLD.obsolete AND NOT NEW.obsolete)
  THEN RAISE EXCEPTION 'preflight preparation history is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preflight_preparation_immutable BEFORE UPDATE ON preflight_preparations
  FOR EACH ROW EXECUTE FUNCTION protect_preflight_preparation();
