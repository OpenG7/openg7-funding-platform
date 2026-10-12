-- Samples extend the existing timing history; they neither start nor complete an exposure period.
CREATE TABLE sponsorship_public_visibility_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  obligation_id UUID NOT NULL,
  contribution_id UUID NOT NULL,
  start_observation_id UUID NOT NULL,
  obligation_version INTEGER NOT NULL CHECK (obligation_version>0),
  content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  started_at TIMESTAMPTZ NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('visible','changed','not_visible','unknown')),
  reason TEXT NOT NULL CHECK (reason IN ('MATCH','PUBLIC_CONTENT_CHANGED','PUBLIC_MEDIA_CHANGED','PUBLIC_MEDIA_MISSING',
    'PROFILE_NOT_OBSERVED','HTTP_ERROR','HTTP_REDIRECT','HTTP_TIMEOUT','HTTP_TOO_LARGE','HTTP_INVALID',
    'DNS_UNSAFE','CHECK_BUDGET_EXHAUSTED','SOURCE_CHANGED')),
  http_status INTEGER CHECK (http_status BETWEEN 100 AND 599),
  request_count INTEGER NOT NULL CHECK (request_count BETWEEN 0 AND 48),
  next_directory_page INTEGER NOT NULL CHECK (next_directory_page BETWEEN 1 AND 100000),
  CHECK (checked_at>=started_at),
  CHECK ((status='visible')=(reason='MATCH')),
  CHECK (status<>'not_visible' OR reason='PUBLIC_MEDIA_MISSING'),
  CHECK (status<>'changed' OR reason IN ('PUBLIC_CONTENT_CHANGED','PUBLIC_MEDIA_CHANGED')),
  FOREIGN KEY (obligation_id,contribution_id) REFERENCES sponsorship_obligations(id,contribution_id),
  FOREIGN KEY (start_observation_id,obligation_id) REFERENCES sponsorship_website_exposure_observations(id,obligation_id)
);
CREATE INDEX sponsorship_public_visibility_latest ON sponsorship_public_visibility_observations(obligation_id,checked_at DESC,id);
CREATE INDEX sponsorship_public_visibility_interruption ON sponsorship_public_visibility_observations(obligation_id,start_observation_id)
  WHERE status IN ('changed','not_visible');
CREATE TRIGGER sponsorship_public_visibility_immutable BEFORE UPDATE OR DELETE ON sponsorship_public_visibility_observations
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();

-- Scheduler position is operational state, not an observation or a proof of continuity.
CREATE TABLE sponsorship_public_visibility_worker (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id IS TRUE),
  cursor_obligation_id UUID,
  last_claimed_at TIMESTAMPTZ
);
INSERT INTO sponsorship_public_visibility_worker(id) VALUES(TRUE);
