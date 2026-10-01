-- Disabled until an independently configured worker reports its readiness.
CREATE TABLE database_backup_worker (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  ready BOOLEAN NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE database_backup_jobs (
  request_id UUID PRIMARY KEY,
  actor TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'daily')),
  scheduled_day DATE UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  bytes BIGINT CHECK (bytes > 0 AND bytes <= 2147483648),
  sha256 TEXT CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  retain_until TIMESTAMPTZ,
  CHECK ((source = 'daily') = (scheduled_day IS NOT NULL)),
  CHECK (status <> 'succeeded' OR (bytes IS NOT NULL AND sha256 IS NOT NULL AND retain_until IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX database_backup_one_active ON database_backup_jobs ((TRUE))
  WHERE status IN ('queued', 'running', 'unknown');
CREATE INDEX database_backup_history ON database_backup_jobs (created_at DESC);
