CREATE TABLE publication_feeds (
  id TEXT PRIMARY KEY CHECK (id IN ('openg7:facebook','openg7:linkedin','openg20:facebook','openg20:linkedin')),
  paused BOOLEAN NOT NULL DEFAULT TRUE,
  auto_prepare BOOLEAN NOT NULL DEFAULT FALSE,
  timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  weekdays INTEGER[] NOT NULL DEFAULT '{2,4}',
  local_time TIME NOT NULL DEFAULT '10:00',
  capacity INTEGER NOT NULL DEFAULT 5 CHECK (capacity BETWEEN 1 AND 10),
  horizon_days INTEGER NOT NULL DEFAULT 14 CHECK (horizon_days BETWEEN 1 AND 28),
  connection TEXT NOT NULL DEFAULT 'unchecked' CHECK (connection IN ('unchecked','ready','expired','error')),
  checked_at TIMESTAMPTZ,
  account_fingerprint TEXT,
  last_prepared_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO publication_feeds (id) VALUES ('openg7:facebook'),('openg7:linkedin'),('openg20:facebook'),('openg20:linkedin');

CREATE TABLE publication_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id TEXT NOT NULL REFERENCES publication_feeds(id),
  kind TEXT NOT NULL CHECK (kind IN ('sponsorship','news','achievement','campaign')),
  batch_id UUID REFERENCES sponsor_publication_batches(id),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2900),
  scheduled_at TIMESTAMPTZ NOT NULL,
  media_id UUID REFERENCES sponsor_media_assets(id),
  media_snapshot JSONB,
  source_snapshot JSONB NOT NULL DEFAULT '[]',
  account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('mock','live')),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','publishing','published','blocked','uncertain','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  error_code TEXT,
  external_post_id TEXT,
  external_post_url TEXT,
  provider_media_id TEXT,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'sponsorship') = (batch_id IS NOT NULL)),
  CHECK ((media_id IS NULL) = (media_snapshot IS NULL))
);
CREATE UNIQUE INDEX publication_delivery_batch ON publication_deliveries(batch_id) WHERE status <> 'cancelled';
CREATE INDEX publication_delivery_due ON publication_deliveries(scheduled_at) WHERE status = 'approved';
CREATE UNIQUE INDEX publication_delivery_remote ON publication_deliveries(feed_id,external_post_id) WHERE external_post_id IS NOT NULL;

CREATE TABLE publication_recurrences (
  feed_id TEXT NOT NULL REFERENCES publication_feeds(id),
  starts_at TIMESTAMPTZ NOT NULL,
  batch_id UUID NOT NULL UNIQUE REFERENCES sponsor_publication_batches(id),
  PRIMARY KEY(feed_id, starts_at)
);

-- Existing admin routes must not alter a batch underneath an authorized send.
-- Editing/cancelling the delivery revokes its authorization and releases this guard.
CREATE FUNCTION guard_authorized_publication_batch() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM publication_deliveries d
    WHERE d.batch_id=OLD.id AND d.status IN ('approved','publishing','uncertain')
      AND (NEW.channel IS DISTINCT FROM OLD.channel
        OR NEW.capacity IS DISTINCT FROM OLD.capacity
        OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
        OR NEW.scheduled_at IS DISTINCT FROM d.scheduled_at
        OR NEW.status NOT IN ('open','scheduled'))
  ) THEN RAISE EXCEPTION 'Revoke publication authorization before changing this batch' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_authorized_publication_batch BEFORE UPDATE ON sponsor_publication_batches
  FOR EACH ROW EXECUTE FUNCTION guard_authorized_publication_batch();

CREATE FUNCTION guard_authorized_publication_draft() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM publication_deliveries WHERE batch_id=OLD.batch_id AND status IN ('approved','publishing','uncertain'))
      THEN RAISE EXCEPTION 'Revoke publication authorization before removing a draft' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM publication_deliveries WHERE batch_id=NEW.batch_id AND status IN ('approved','publishing','uncertain'))
      THEN RAISE EXCEPTION 'Revoke publication authorization before adding a draft' USING ERRCODE='55000'; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM publication_deliveries WHERE batch_id IN (OLD.batch_id,NEW.batch_id) AND status IN ('approved','publishing','uncertain'))
      AND (NEW.batch_id IS DISTINCT FROM OLD.batch_id
        OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
        OR NEW.disclosure_text IS DISTINCT FROM OLD.disclosure_text
        OR NEW.feed_target IS DISTINCT FROM OLD.feed_target OR NEW.channel IS DISTINCT FROM OLD.channel
        OR NEW.contribution_id IS DISTINCT FROM OLD.contribution_id
        OR NEW.status NOT IN ('approved','scheduled'))
      THEN RAISE EXCEPTION 'Revoke publication authorization before changing a draft' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_authorized_publication_draft BEFORE INSERT OR UPDATE OR DELETE ON sponsor_publication_drafts
  FOR EACH ROW EXECUTE FUNCTION guard_authorized_publication_draft();
