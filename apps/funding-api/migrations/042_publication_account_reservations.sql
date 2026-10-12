-- Coordination belongs to the provider account, independently of the OpenG7 feed.
-- Existing deliveries remain historical facts; approved legacy rows are qualified
-- conservatively at their next worker claim instead of inventing an approval.
CREATE TABLE publication_account_leases (
  provider TEXT NOT NULL CHECK (provider IN ('facebook','linkedin')),
  account_id TEXT NOT NULL CHECK (length(account_id) > 0),
  mode TEXT NOT NULL CHECK (mode IN ('live','mock')),
  fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
  delivery_id UUID REFERENCES publication_deliveries(id) ON DELETE RESTRICT,
  delivery_version INTEGER,
  lease_until TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  uncertain BOOLEAN NOT NULL DEFAULT FALSE,
  next_dispatch_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(provider,account_id,mode),
  CHECK ((delivery_id IS NULL) = (delivery_version IS NULL)),
  CHECK ((delivery_id IS NULL) = (lease_until IS NULL)),
  CHECK (NOT uncertain OR delivery_id IS NOT NULL)
);

CREATE TABLE publication_account_reservations (
  delivery_id UUID PRIMARY KEY REFERENCES publication_deliveries(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  approval_version INTEGER NOT NULL CHECK (approval_version > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved','publishing','uncertain','released','published')),
  claim_version INTEGER,
  claim_fence INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(provider,account_id,mode)
    REFERENCES publication_account_leases(provider,account_id,mode),
  CHECK ((claim_version IS NULL) = (claim_fence IS NULL))
);
CREATE UNIQUE INDEX publication_account_reserved_instant
  ON publication_account_reservations(provider,account_id,mode,scheduled_at)
  WHERE mode='live' AND status IN ('reserved','publishing','uncertain');
CREATE INDEX publication_account_reservation_window
  ON publication_account_reservations(provider,account_id,mode,scheduled_at)
  WHERE status IN ('reserved','publishing','uncertain');
